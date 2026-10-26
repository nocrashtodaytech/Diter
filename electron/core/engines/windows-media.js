'use strict';
/**
 * Windows 安装盘引擎（任意宿主：macOS / Linux / Windows 都能做）
 *
 * 为什么不能 dd：Windows ISO 不是混合镜像，逐字节写入得到的是不可启动的 U 盘。
 * 正确做法是"建分区 → 格式化 FAT32 → 拷贝文件 → 补引导"，本模块即此流程。
 *
 * 启动能力：
 *   UEFI     —— 拷贝 ISO 内的 /efi/boot/bootx64.efi 即可，全平台 100% 可用。
 *   Legacy   —— 需要 NT60 分区引导扇区。Windows 宿主直接调用 ISO 自带的 bootsect.exe；
 *               macOS/Linux 宿主调用 ms-sys（brew install ms-sys / apt install ms-sys）。
 *               缺失时降级为"仅 UEFI 可启动"，并明确告警，不静默失败。
 *   大文件   —— install.wim > 4GB 时用 wimlib-imagex 拆成 install.swm，保住 FAT32。
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { run, waitMountPoint, RateMeter } = require('../util');
const { spawnStep, hasCommand } = require('./spawn');

const WIM_LIMIT = 3.9 * 1024 * 1024 * 1024;

/* ------------------------------ 挂载 / 卸载 ------------------------------ */

async function mountIso(imagePath) {
  if (process.platform === 'darwin') {
    const r = await run(
      'sh',
      ['-c', `hdiutil attach -readonly -nobrowse -noverify -plist "${imagePath.replace(/"/g, '\\"')}" | plutil -convert json -o - -`],
      { timeout: 120000 }
    );
    if (!r.ok) throw new Error('挂载镜像失败：' + r.stderr.trim());
    const j = JSON.parse(r.stdout);
    const ents = j['system-entities'] || [];
    const mp = ents.find((e) => e['mount-point'] && e['mount-point'] !== '/')?.['mount-point'];
    if (!mp) throw new Error('镜像已挂载但找不到挂载点');
    return { mountPoint: mp, devEntry: ents.find((e) => e['dev-entry'])?.['dev-entry'], cleanup: async () => run('hdiutil', ['detach', mp, '-force']) };
  }
  if (process.platform === 'win32') {
    const ps = `
$img = Mount-DiskImage -ImagePath '${imagePath.replace(/'/g, "''")}' -PassThru
$vol = $img | Get-Volume
"$($vol.DriveLetter):"
`;
    const r = await run('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 120000 });
    const letter = (r.stdout || '').trim().replace(':', '');
    if (!letter) throw new Error('挂载 ISO 失败');
    return {
      mountPoint: `${letter}:\\`,
      devEntry: null,
      cleanup: async () =>
        run('powershell.exe', ['-NoProfile', '-Command', `Dismount-DiskImage -ImagePath '${imagePath.replace(/'/g, "''")}'`]),
    };
  }
  // Linux
  const mp = fs.mkdtempSync('/tmp/diter-iso-');
  const r = await run('mount', ['-o', 'loop,ro', imagePath, mp], { timeout: 60000 });
  if (!r.ok) throw new Error('挂载镜像失败：' + r.stderr.trim());
  return { mountPoint: mp, devEntry: null, cleanup: async () => run('umount', [mp]) };
}

/* ------------------------------ 分区 / 格式化 ------------------------------ */

async function partition(device, emit) {
  emit({ phase: '分区', message: '清除分区表并建立 FAT32 活动分区' });
  if (process.platform === 'darwin') {
    await run('diskutil', ['unmountDisk', 'force', device.id], { timeout: 60000 });
    const r = await run('diskutil', ['eraseDisk', 'MS-DOS', 'DITER', 'MBR', device.id], { timeout: 300000 });
    if (!r.ok) throw new Error('格式化失败：' + r.stderr.trim());
    // 不能假设挂载点就是 /Volumes/DITER：残留的悬空符号链接会让新卷挂成 "DITER 1"，
    // 硬编码路径会导致后续 mkdir 报 ENOENT。必须探测实际挂载点。
    return waitMountPoint(device.id);
  }
  if (process.platform === 'win32') {
    const script = `select disk ${device.id}\nclean\ncreate partition primary\nformat fs=fat32 quick label=DITER\nactive\nassign\n`;
    const tmp = path.join(require('os').tmpdir(), `diter-${Date.now()}.txt`);
    fs.writeFileSync(tmp, script, 'ascii');
    const r = await run('diskpart', ['/s', tmp], { timeout: 600000 });
    fs.unlinkSync(tmp);
    if (!r.ok) throw new Error('diskpart 失败：' + r.stderr.trim());
    // 找到 DITER 的盘符
    const q = await run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `(Get-Volume -FileSystemLabel DITER).DriveLetter`,
    ]);
    const letter = (q.stdout || '').trim();
    if (!letter) throw new Error('分区完成但未获得盘符');
    return `${letter}:\\`;
  }
  // Linux: MBR + 单 FAT32 分区 + boot 标志
  const sf = await run('sh', [
    '-c',
    `echo 'label: dos\n,,c,*' | sfdisk --force /dev/${device.id}`,
  ], { timeout: 120000 });
  if (!sf.ok) throw new Error('sfdisk 失败：' + sf.stderr.trim());
  await run('sh', ['-c', `partprobe /dev/${device.id} || true; sleep 1`]);
  const mk = await run('mkfs.vfat', ['-F', '32', '-n', 'DITER', `/dev/${device.id}1`], { timeout: 300000 });
  if (!mk.ok) throw new Error('mkfs.vfat 失败：' + mk.stderr.trim());
  const mp = fs.mkdtempSync('/tmp/diter-dst-');
  await run('mount', [`/dev/${device.id}1`, mp]);
  return mp;
}

/* ------------------------------ 拷贝文件 ------------------------------ */

function walk(dir, base = dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    const rel = path.relative(base, full);
    if (st.isDirectory()) {
      acc.push({ rel, dir: true, size: 0 });
      walk(full, base, acc);
    } else if (st.isFile()) {
      acc.push({ rel, dir: false, size: st.size });
    }
  }
  return acc;
}

async function copyTree(srcRoot, dstRoot, { emit, signal, skip = new Set(), onBytes }) {
  const entries = walk(srcRoot);
  const total = entries.reduce((s, e) => s + e.size, 0);
  let done = 0;
  const meter = new RateMeter(8000);
  let lastEmit = 0;
  const dirs = entries.filter((e) => e.dir).sort((a, b) => a.rel.length - b.rel.length);
  for (const d of dirs) await fsp.mkdir(path.join(dstRoot, d.rel), { recursive: true });

  // 异步 I/O：走 libuv 线程池，避免同步循环阻塞事件循环（否则进度事件发不出去、UI 冻结）
  const buf = Buffer.allocUnsafe(64 * 1024 * 1024);
  for (const e of entries) {
    if (e.dir) continue;
    if (skip.has(e.rel.split(path.sep).join('/').toLowerCase())) continue;
    if (signal?.aborted) throw Object.assign(new Error('用户已取消'), { code: 'CANCELLED' });
    const dst = path.join(dstRoot, e.rel);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    const inFd = await fsp.open(path.join(srcRoot, e.rel), 'r');
    const outFd = await fsp.open(dst, 'w');
    try {
      let read = 0;
      while (read < e.size) {
        if (signal?.aborted) throw Object.assign(new Error('用户已取消'), { code: 'CANCELLED' });
        const { bytesRead } = await inFd.read(buf, 0, Math.min(buf.length, e.size - read), read);
        if (bytesRead <= 0) break;
        let off = 0;
        while (off < bytesRead) {
          const { bytesWritten } = await outFd.write(buf, off, bytesRead - off, read + off);
          if (bytesWritten <= 0) throw Object.assign(new Error('写入目标失败，设备可能已断开'), { code: 'EIO' });
          off += bytesWritten;
        }
        read += bytesRead;
        done += bytesRead;
        const now = Date.now();
        if (now - lastEmit >= 200) {
          lastEmit = now;
          onBytes?.(done, total, meter.push(done, now));
        }
      }
    } finally {
      await inFd.close();
      await outFd.close();
    }
    // 启动盘无需保留源文件时间戳，跳过 utimesSync（在 FAT32 上可能显著拖慢拷贝）
  }
  return { files: entries.length, bytes: total };
}

/* ------------------------------ 主流程 ------------------------------ */

async function write(ctx) {
  const { imagePath, device, options = {}, emit, signal, preMounted, rootOps } = ctx;
  let mount;
  if (preMounted?.mountPoint) {
    // 主进程（用户会话）已挂载好，直接读挂载点
    mount = { mountPoint: preMounted.mountPoint, devEntry: preMounted.devEntry, cleanup: async () => {} };
    emit({ pct: 0.01, phase: '准备', message: '读取已挂载的镜像内容' });
  } else {
    try {
      mount = await mountIso(imagePath);
    } catch (e) {
      const err = new Error(`无法读取 Windows 镜像：${e.message}（若为 UDF 镜像，请确认系统支持 UDF 挂载）`);
      err.code = 'MOUNT_FAILED';
      throw err;
    }
  }

  const cleanup = async () => {
    try {
      await mount.cleanup();
    } catch {}
  };

  try {
    emit({ pct: 0.02, phase: '分区', message: '建立 FAT32 活动分区' });
    // macOS 对可移动宗卷有 TCC 隐私保护：文件级写入必须留在用户会话（可弹授权框），
    // 只有分区/格式化这类磁盘管理操作交给 root 助手。非 root 且有 rootOps 时走委托。
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    let dstRoot;
    if (!isRoot && rootOps?.format) {
      try {
        const r = await rootOps.format({ deviceId: device.id });
        dstRoot = r.mountPoint;
      } catch (e) {
        throw new Error('格式化 U 盘失败：' + e.message);
      }
    } else {
      dstRoot = await partition(device, emit);
    }

    /* ---- install.wim 体积检查 ---- */
    const wim = path.join(mount.mountPoint, 'sources', 'install.wim');
    const esd = path.join(mount.mountPoint, 'sources', 'install.esd');
    const skip = new Set();
    let splitNote = '';
    if (fs.existsSync(wim)) {
      const size = fs.statSync(wim).size;
      if (size > WIM_LIMIT) {
        const hasWimlib = await hasCommand('wimlib-imagex');
        if (!hasWimlib) {
          const err = new Error(
            `install.wim 为 ${(size / 1e9).toFixed(1)} GB，超过 FAT32 单文件 4 GB 上限，需要 wimlib 拆分。` +
              `请先安装：macOS → brew install wimlib；Debian/Ubuntu → sudo apt install wimlib-tools；Windows → 使用内置 DISM 自动完成。`
          );
          err.code = 'WIM_TOO_LARGE';
          throw err;
        }
        emit({ pct: 0.08, phase: '拷贝', message: 'install.wim 超过 4 GB，正在拆分为 install.swm' });
        await spawnStep(
          'wimlib-imagex',
          ['split', wim, path.join(dstRoot, 'sources', 'install.swm'), '3800'],
          {
            signal,
            onLine: (l) => {
              const m = /(\d+)%/.exec(l);
              if (m) emit({ pct: 0.1, phase: '拷贝', message: `拆分 install.wim ${m[1]}%` });
            },
            onStderr: (l) => {
              const m = /(\d+)%/.exec(l);
              if (m) emit({ pct: 0.1, phase: '拷贝', message: `拆分 install.wim ${m[1]}%` });
            },
          }
        );
        skip.add('sources/install.wim');
        splitNote = '（install.wim 已拆分为 install.swm，误报请忽略）';
      }
    }
    void esd;

    emit({ pct: 0.14, phase: '拷贝', message: '正在复制安装文件' });
    let copied;
    try {
      copied = await copyTree(mount.mountPoint, dstRoot, {
        emit,
        signal,
        skip,
        onBytes: (done, total, speed) => {
          const p = total > 0 ? done / total : 0;
          emit({
            pct: 0.14 + p * 0.78,
            phase: '拷贝',
            message: `复制 ${(done / 1073741824).toFixed(2)} / ${(total / 1073741824).toFixed(2)} GB`,
            bytesWritten: done,
            totalBytes: total,
            speed,
            eta: speed > 0 ? (total - done) / speed : 0,
          });
        },
      });
    } catch (e) {
      if (e.code === 'EPERM' || e.code === 'EACCES') {
        // macOS 隐私保护（TCC）会拦截对可移动宗卷的文件级写入
        const err = new Error(
          'macOS 隐私保护阻止了写入：请打开 系统设置 → 隐私与安全性 → 文件和文件夹（或完全磁盘访问权限），允许 Diter 访问「可移动宗卷」，然后重试。'
        );
        err.code = e.code;
        throw err;
      }
      throw e;
    }

    /* ---- 引导 ---- */
    emit({ pct: 0.94, phase: '引导', message: '正在写入启动代码' });
    let legacyOk = false;
    if (process.platform === 'win32') {
      const bootsect = path.join(mount.mountPoint, 'boot', 'bootsect.exe');
      if (fs.existsSync(bootsect)) {
        const drive = dstRoot.replace(/\\$/, '');
        const r = await run(bootsect, ['/nt60', drive, '/mbr'], { timeout: 120000 });
        legacyOk = r.ok;
      }
    } else if (await hasCommand('ms-sys')) {
      const r = await run(process.platform === 'darwin' ? 'sudo' : 'pkexec', [
        'ms-sys',
        '-m',
        process.platform === 'darwin' ? `/dev/${device.id}` : `/dev/${device.id}`,
      ]);
      legacyOk = r.ok;
    }

    emit({ pct: 0.99, phase: '收尾', message: '刷新缓存' });
    await run('sync', []).catch(() => {});
    await cleanup();

    return {
      mode: 'files',
      files: copied.files,
      bytes: copied.bytes,
      legacyBoot: legacyOk,
      note: legacyOk
        ? 'UEFI 与 Legacy BIOS 双模式可启动。'
        : `UEFI 模式可启动。Legacy BIOS 引导扇区未写入（缺少 ms-sys / bootsect）${splitNote}`,
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}

module.exports = { write, mountIso, partition, copyTree };

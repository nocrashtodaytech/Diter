'use strict';
/**
 * macOS 启动盘引擎 —— 三级策略，覆盖 10.10 → 最新（含 26/27）
 *
 * A. createinstallmedia：镜像里若含 "Install macOS *.app"，直接用该 app **自带**的
 *    createinstallmedia。这一个程序从 10.8 到最新版本都存在且由 Apple 随版本更新，
 *    因此天然覆盖全部版本，不需要我们猜 BaseSystem/Packages 布局。
 * B. asr restore：老式 InstallESD / BaseSystem.dmg 镜像，走 Apple 的 asr 整卷恢复。
 * C. raw：已经是"可启动成品"的 ISO/DMG（自带 GPT + HFS/APFS），逐字节写入。
 *
 * 选择顺序为 A → B → C，判定依据是挂载后的实际内容，而不是文件名。
 */
const fs = require('fs');
const path = require('path');
const { run, waitMountPoint } = require('../util');
const { spawnStep, pctFrom } = require('./spawn');
const raw = require('./raw');

async function mountImage(imagePath) {
  const r = await run(
    'sh',
    ['-c', `hdiutil attach -readonly -nobrowse -noverify -plist "${imagePath.replace(/"/g, '\\"')}" | plutil -convert json -o - -`],
    { timeout: 120000 }
  );
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.stdout);
    const entities = j['system-entities'] || [];
    const mounted = entities.filter((e) => e['mount-point']).map((e) => e['mount-point']);
    const devEntry = entities.find((e) => e['dev-entry']);
    return { mountPoints: mounted, devEntry: devEntry ? devEntry['dev-entry'] : null, raw: j };
  } catch {
    return null;
  }
}

async function findInstallerApp(mountPoint) {
  try {
    const items = fs.readdirSync(mountPoint);
    const app = items.find((n) => /^Install (macOS|OS X).*\.app$/.test(n));
    if (!app) return null;
    const full = path.join(mountPoint, app);
    const cic = path.join(full, 'Contents/Resources/createinstallmedia');
    return fs.existsSync(cic) ? { appPath: full, createinstallmedia: cic } : null;
  } catch {
    return null;
  }
}

/** 判定该用哪种模式；preMounted 为主进程预挂载的镜像信息（root 助手无法自行挂载） */
async function plan(imagePath, imageInfo, preMounted) {
  const ext = path.extname(imagePath).toLowerCase();

  if (ext === '.app') {
    const cic = path.join(imagePath, 'Contents/Resources/createinstallmedia');
    if (fs.existsSync(cic)) return { mode: 'createinstallmedia', createinstallmedia: cic, appPath: imagePath };
  }

  if (ext === '.dmg' || ext === '.iso' || ext === '.img' || ext === '.cdr') {
    const m =
      preMounted?.mountPoints?.length
        ? { mountPoints: preMounted.mountPoints, devEntry: preMounted.devEntry || null, raw: null }
        : await mountImage(imagePath);
    if (m && m.mountPoints.length) {
      for (const mp of m.mountPoints) {
        const found = await findInstallerApp(mp);
        if (found) return { mode: 'createinstallmedia', ...found, mount: m };
      }
      // 老式布局：根目录有 BaseSystem.dmg / InstallESD.dmg
      for (const mp of m.mountPoints) {
        const bs = path.join(mp, 'BaseSystem.dmg');
        const iesd = path.join(mp, 'InstallESD.dmg');
        const pkgs = path.join(mp, 'Packages');
        if (fs.existsSync(bs)) return { mode: 'asr', source: bs, packages: fs.existsSync(pkgs) ? pkgs : null, mount: m, mountPoint: mp };
        if (fs.existsSync(iesd)) return { mode: 'asr', source: iesd, packages: null, mount: m, mountPoint: mp };
      }
      return { mode: 'raw', mount: m, mountPoint: m.mountPoints[0] };
    }
    if (imageInfo?.structures?.hfs || imageInfo?.structures?.apfs) {
      return { mode: 'asr', source: imagePath, packages: null, mount: null };
    }
    return { mode: 'raw', mount: null };
  }

  return { mode: 'raw', mount: null };
}

/** createinstallmedia 的输出解析：Erasing → Copying → Making bootable */
function cicProgress(emit, base, span) {
  let stage = 0.02;
  let phase = '准备';
  return (line) => {
    const low = line.toLowerCase();
    if (low.includes('erasing disk')) {
      phase = '格式化目标盘';
      stage = 0.02;
      span = 0.12;
    } else if (low.includes('copying to disk')) {
      phase = '复制系统文件';
      stage = 0.14;
      span = 0.78;
    } else if (low.includes('making disk bootable') || low.includes('setting up the boot')) {
      phase = '写入引导信息';
      stage = 0.93;
      span = 0.06;
    } else if (low.includes('copying booter') || low.includes('creating')) {
      phase = '收尾';
      stage = 0.96;
      span = 0.03;
    }
    const p = pctFrom(line);
    emit({
      pct: Math.min(0.999, stage + (p === null ? 0 : (p / 100) * span)),
      message: p === null ? phase : `${phase} ${Math.round(p)}%`,
    });
  };
}

/**
 * 执行 macOS 镜像写入
 * @param {object} ctx { imagePath, imageInfo, device, options, emit, signal }
 */
async function write(ctx) {
  const { imagePath, imageInfo, device, options = {}, emit, signal, preMounted } = ctx;
  const p = await plan(imagePath, imageInfo, preMounted);

  /* ---------------- A. createinstallmedia ---------------- */
  if (p.mode === 'createinstallmedia') {
    emit({ phase: '准备', message: '清除目标磁盘分区表', pct: 0.01 });
    const name = 'DITER';
    await run('diskutil', ['unmountDisk', 'force', device.id], { timeout: 60000 });
    // createinstallmedia 需要目标为已挂载卷，因此先格式化为 HFS+ 再写入
    await run('diskutil', ['eraseDisk', 'JHFS+', name, 'GPT', device.id], { timeout: 300000 });

    // 探测实际挂载点：残留的 /Volumes/DITER 悬空符号链接会让新卷挂成 "DITER 1"
    const mountPoint = await waitMountPoint(device.id);
    emit({ phase: '准备', message: `调用 ${path.basename(p.appPath || imagePath)} 自带安装工具`, pct: 0.03 });
    const parse = cicProgress(emit, 0.03, 0.95);
    await spawnStep(p.createinstallmedia, ['--volume', mountPoint, '--nointeraction'], {
      signal,
      onLine: parse,
      onStderr: parse,
    });
    emit({ pct: 0.97, phase: '收尾', message: '刷新卷信息' });
    return { mode: 'createinstallmedia', note: '已由 Apple 官方 createinstallmedia 生成，原生支持安装与恢复启动。' };
  }

  /* ---------------- B. asr 恢复 ---------------- */
  if (p.mode === 'asr') {
    emit({ phase: '准备', message: '卸载目标磁盘', pct: 0.01 });
    await run('diskutil', ['unmountDisk', 'force', device.id], { timeout: 60000 });
    emit({ phase: '格式化', message: '建立 GPT + HFS+ 分区', pct: 0.03 });
    await run('diskutil', ['eraseDisk', 'JHFS+', 'DITER', 'GPT', device.id], { timeout: 300000 });

    emit({ phase: '恢复镜像', message: '正在还原 BaseSystem', pct: 0.06 });
    await spawnStep(
      'asr',
      ['restore', '--source', p.source, '--target', `/dev/${device.id}`, '--erase', '--noverify', '--noprompt'],
      {
        signal,
        onLine: (line) => {
          const v = pctFrom(line);
          if (v !== null) emit({ pct: 0.06 + (v / 100) * 0.8, message: `恢复镜像 ${Math.round(v)}%` });
        },
        onStderr: (line) => {
          const v = pctFrom(line);
          if (v !== null) emit({ pct: 0.06 + (v / 100) * 0.8, message: `恢复镜像 ${Math.round(v)}%` });
        },
      }
    );

    if (p.packages) {
      emit({ phase: '复制安装包', message: '复制 Packages（老版本布局必需）', pct: 0.9 });
      await run('sh', ['-c', `ditto "${p.packages}" "/Volumes/DITER/Packages"`], { timeout: 3600000 });
    }
    emit({ phase: '收尾', message: '设置启动磁盘', pct: 0.99 });
    await run('bless', ['--setBoot', '--legacy', `/dev/${device.id}`], { timeout: 60000 });
    return { mode: 'asr', note: '老版本 InstallESD 布局，已用 asr 整卷恢复并 bless 引导。' };
  }

  /* ---------------- C. raw ---------------- */
  emit({ phase: '准备', message: '卸载目标磁盘', pct: 0.01 });
  await run('diskutil', ['unmountDisk', 'force', device.id], { timeout: 60000 });

  const total = imageInfo?.size || fs.statSync(imagePath).size;
  const res = await raw.writeRaw({
    sourcePath: imagePath,
    targetNode: `/dev/r${device.id}`,
    totalBytes: total,
    signal,
    onProgress: (pr) =>
      emit({
        pct: 0.03 + (pr.bytesWritten / pr.totalBytes) * 0.95,
        message: `写入 ${(pr.bytesWritten / 1073741824).toFixed(2)} / ${(pr.totalBytes / 1073741824).toFixed(2)} GB`,
        speed: pr.speed,
        eta: pr.eta,
        bytesWritten: pr.bytesWritten,
        totalBytes: pr.totalBytes,
      }),
  });
  return { mode: 'raw', note: '镜像自带分区与引导，已逐字节写入。', bytesWritten: res.bytesWritten };
}

async function detach(mount) {
  if (!mount?.devEntry) return;
  await run('hdiutil', ['detach', mount.devEntry, '-force'], { timeout: 60000 });
}

module.exports = { write, plan, detach, mountImage };

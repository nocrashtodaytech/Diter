'use strict';
/**
 * 镜像探测：不挂载、不依赖第三方库，只读文件头 + ISO9660 目录树。
 * 目标：在写入前就告诉用户"这是什么系统、什么架构、能不能写、写哪里"。
 */
const fs = require('fs');

const SECTOR = 2048;

function readAt(fd, offset, length) {
  const buf = Buffer.alloc(length);
  let got = 0;
  try {
    got = fs.readSync(fd, buf, 0, length, offset);
  } catch {
    return Buffer.alloc(0);
  }
  return buf.subarray(0, got);
}

/* ------------------------------------------------------------------ *
 * ISO9660
 * ------------------------------------------------------------------ */

function parsePvd(fd) {
  const buf = readAt(fd, 16 * SECTOR, SECTOR);
  if (buf.length < 2048) return null;
  if (buf[0] !== 1) return null;
  if (buf.subarray(1, 6).toString('latin1') !== 'CD001') return null;

  const label = buf.subarray(40, 72).toString('latin1').replace(/\0.*$/, '').trim();
  const rootRec = buf.subarray(156, 156 + 34);
  const rootLba = rootRec.readUInt32LE(2);
  const rootSize = rootRec.readUInt32LE(10);
  // El Torito boot catalog pointer，位于 PVD 偏移 0x47
  const elTorito = buf[0x47] === 0x00 && buf.readUInt32LE(0x47 + 1) > 0;
  return { label, rootLba, rootSize, elTorito };
}

function walkIsoDir(fd, lba, size, depth = 0, out = [], budget = { n: 0 }) {
  if (depth > 2 || budget.n > 400) return out;
  const data = readAt(fd, lba * SECTOR, Math.min(size, 64 * SECTOR));
  let p = 0;
  while (p + 33 < data.length) {
    const len = data[p];
    if (len === 0) {
      // 扇区剩余部分为填充，跳到下一个扇区边界
      p = (Math.floor(p / SECTOR) + 1) * SECTOR;
      if (p >= data.length) break;
      continue;
    }
    const extLba = data.readUInt32LE(p + 2);
    const extSize = data.readUInt32LE(p + 10);
    const flags = data[p + 25];
    const nameLen = data[p + 32];
    let name = data.subarray(p + 33, p + 33 + nameLen).toString('latin1');
    p += len;

    if (name === '\u0000' || name === '\u0001') continue; // '.' 与 '..'
    name = name.replace(/;1$/, '');
    if (!name) continue;

    budget.n++;
    const isDir = (flags & 0x02) !== 0;
    out.push({ name: name.toLowerCase(), isDir, size: extSize });
    if (isDir) walkIsoDir(fd, extLba, extSize, depth + 1, out, budget);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 分区表 / 文件系统签名
 * ------------------------------------------------------------------ */

function sniffStructures(fd, fileSize) {
  const head = readAt(fd, 0, 1024 * 1024);
  const mbr = head.length >= 512 && head[510] === 0x55 && head[511] === 0xaa;
  const gpt = head.length >= 520 && head.subarray(512, 520).toString('latin1') === 'EFI PART';
  const apm = head.length >= 2 && head[0] === 0x45 && head[1] === 0x52; // 'ER'
  let mbrType = null;
  let bootFlag = false;
  if (mbr) {
    bootFlag = head[446] === 0x80;
    mbrType = head[446 + 4];
  }
  // HFS+ / HFSX 卷头位于偏移 1024
  const vh = readAt(fd, 1024, 512);
  const hfsSig = vh.length >= 2 ? vh.subarray(0, 2).toString('latin1') : '';
  const hfs = hfsSig === 'H+' || hfsSig === 'HX';
  // APFS 容器超级块：块 0 偏移 32 处为 'NXSB'
  const apfs = head.length >= 36 && head.subarray(32, 36).toString('latin1') === 'NXSB';
  // UDF 卷识别序列（VRS）：sector 16 起为 'BEA01'，随后 NSR 描述符（纯 UDF 光盘 / 部分 Windows ISO）
  const vrs = readAt(fd, 16 * SECTOR, SECTOR);
  const udf = vrs.length >= 6 && vrs[0] === 0x00 && vrs.subarray(1, 6).toString('latin1') === 'BEA01';
  // DMG（UDIF）格式：文件尾部 512 字节为 koly 块，签名 'koly'
  let dmg = false;
  if (fileSize > 512) {
    const tail = readAt(fd, fileSize - 512, 512);
    dmg = tail.length >= 4 && tail.subarray(0, 4).toString('latin1') === 'koly';
  }
  // 纯 dd 型 raw 镜像（无文件系统头部，例如某些路由器/树莓派精简镜像）
  const isRaw = !mbr && !hfs && !apfs && !udf && !dmg && fileSize > 0;

  return {
    mbr,
    gpt,
    apm,
    mbrType,
    bootFlag,
    hfs,
    hfsVariant: hfsSig === 'HX' ? 'HFSX' : hfs ? 'HFS+' : null,
    apfs,
    udf,
    dmg,
    isRaw,
  };
}

/* ------------------------------------------------------------------ *
 * 版本知识库
 * ------------------------------------------------------------------ */

const MACOS_NAMES = [
  { major: '10.10', name: 'Yosemite' },
  { major: '10.11', name: 'El Capitan' },
  { major: '10.12', name: 'Sierra' },
  { major: '10.13', name: 'High Sierra' },
  { major: '10.14', name: 'Mojave' },
  { major: '10.15', name: 'Catalina' },
  { major: '11', name: 'Big Sur' },
  { major: '12', name: 'Monterey' },
  { major: '13', name: 'Ventura' },
  { major: '14', name: 'Sonoma' },
  { major: '15', name: 'Sequoia' },
  { major: '26', name: 'Tahoe' },
  { major: '27', name: '' }, // 预留：最新版本，代号以官方发布为准
];

const WINDOWS_NAMES = [
  { build: 7600, name: 'Windows 7', code: '7' },
  { build: 7601, name: 'Windows 7 SP1', code: '7' },
  { build: 9200, name: 'Windows 8', code: '8' },
  { build: 9600, name: 'Windows 8.1', code: '8.1' },
  { build: 10240, name: 'Windows 10 1507', code: '10' },
  { build: 19041, name: 'Windows 10 2004', code: '10' },
  { build: 19044, name: 'Windows 10 21H2', code: '10' },
  { build: 19045, name: 'Windows 10 22H2', code: '10' },
  { build: 22000, name: 'Windows 11 21H2', code: '11' },
  { build: 22621, name: 'Windows 11 22H2', code: '11' },
  { build: 22631, name: 'Windows 11 23H2', code: '11' },
  { build: 26100, name: 'Windows 11 24H2', code: '11' },
];

function guessMacosVersion(text) {
  const t = text.toLowerCase();
  for (const v of MACOS_NAMES) {
    const raw = v.major;
    const major = raw.includes('.') ? raw.split('.')[0] : raw;
    const minor = raw.includes('.') ? raw.split('.')[1] : null;
    const re = new RegExp(`(?:^|[^0-9])${major}[._](?:${minor ? minor : '[0-9]+'})(?:[^0-9]|$)`);
    if (minor) {
      if (re.test(t)) return { version: raw, name: v.name, confidence: 0.92 };
    } else {
      if (new RegExp(`(?:^|[^0-9])${major}[._][0-9]+`).test(t)) return { version: raw, name: v.name, confidence: 0.9 };
    }
    if (v.name && t.includes(v.name.toLowerCase())) {
      return { version: raw, name: v.name, confidence: 0.85 };
    }
  }
  return null;
}

function guessArch(text) {
  const t = text.toLowerCase();
  if (/(arm64|aarch64|apple.?silicon)/.test(t)) return { arch: 'arm64', label: 'ARM64 / Apple Silicon' };
  if (/(x86_64|amd64|x64)/.test(t)) return { arch: 'x64', label: 'x86_64' };
  if (/(i386|i686|x86|ia32|32.?bit)/.test(t)) return { arch: 'x86', label: 'x86 (32 位)' };
  return null;
}

const LINUX_HINTS = [
  { re: /ubuntu|kubuntu|xubuntu|lubuntu/, distro: 'Ubuntu' },
  { re: /debian/, distro: 'Debian' },
  { re: /fedora/, distro: 'Fedora' },
  { re: /centos/, distro: 'CentOS' },
  { re: /rocky/, distro: 'Rocky Linux' },
  { re: /alma/, distro: 'AlmaLinux' },
  { re: /arch/, distro: 'Arch Linux' },
  { re: /manjaro/, distro: 'Manjaro' },
  { re: /opensuse|suse/, distro: 'openSUSE' },
  { re: /linuxmint|mint/, distro: 'Linux Mint' },
  { re: /kali/, distro: 'Kali Linux' },
  { re: /rasp|raspberry/, distro: 'Raspberry Pi OS' },
  { re: /alpine/, distro: 'Alpine' },
  { re: /gentoo/, distro: 'Gentoo' },
  { re: /pop.?os/, distro: 'Pop!_OS' },
  { re: /deepin|uos/, distro: 'Deepin' },
  { re: /kylin/, distro: 'Kylin' },
];

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

/**
 * @param {string} imagePath
 * @returns {object} 镜像描述
 */
function probeImage(imagePath) {
  const stat = fs.statSync(imagePath);
  const fd = fs.openSync(imagePath, 'r');
  let pvd = null;
  let entries = [];
  let structures = { mbr: false, gpt: false, apm: false, hfs: false, apfs: false, isRaw: false };

  try {
    structures = sniffStructures(fd, stat.size);
    pvd = parsePvd(fd);
    if (pvd) {
      entries = walkIsoDir(fd, pvd.rootLba, pvd.rootSize);
    } else if (structures.hfs || structures.apfs) {
      // HFS/APFS 镜像：无法轻量解析目录树，退化为头部字符串扫描
      const scanLen = Math.min(stat.size, 8 * 1024 * 1024);
      const scan = readAt(fd, 0, scanLen).toString('latin1');
      const names = ['BaseSystem.dmg', 'InstallESD.dmg', 'Install macOS', 'Packages', 'boot.efi', 'com.apple.recovery.boot'];
      for (const n of names) {
        if (scan.includes(n)) entries.push({ name: n.toLowerCase(), isDir: false, size: 0 });
      }
    } else if (structures.udf) {
      // 纯 UDF 光盘：目录项为 dstring，退化为头部扫描关键文件名（ASCII 文件名在 UDF 中常为单字节）
      const scanLen = Math.min(stat.size, 8 * 1024 * 1024);
      const scan = readAt(fd, 0, scanLen).toString('latin1');
      const udfMarkers = ['install.wim', 'install.esd', 'sources', 'bootmgr', 'setup.exe', 'casper', 'isolinux', 'vmlinuz', 'liveos', 'boot'];
      for (const n of udfMarkers) {
        if (scan.includes(n)) entries.push({ name: n.toLowerCase(), isDir: false, size: 0 });
      }
    } else if (structures.dmg) {
      // DMG（UDIF）容器：内部为压缩/加密数据，无法轻量解析，仅记录签名与关键字符串
      const scanLen = Math.min(stat.size, 8 * 1024 * 1024);
      const scan = readAt(fd, 0, scanLen).toString('latin1');
      const dmgMarkers = ['BaseSystem.dmg', 'Install macOS', 'InstallESD.dmg', 'com.apple.recovery.boot'];
      for (const n of dmgMarkers) {
        if (scan.includes(n)) entries.push({ name: n.toLowerCase(), isDir: false, size: 0 });
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  const names = new Set(entries.map((e) => e.name));
  const dirs = new Set(entries.filter((e) => e.isDir).map((e) => e.name));
  const has = (n) => names.has(n) || dirs.has(n);
  const hasPrefix = (p) => entries.some((e) => e.name.startsWith(p));

  const label = pvd ? pvd.label : '';
  const stem = imagePath.split('/').pop();
  const haystack = `${stem} ${label}`.toLowerCase();
  const evidence = [];
  if (label) evidence.push(`卷标 ${label}`);
  if (pvd) evidence.push('ISO9660 文件系统');
  if (structures.gpt) evidence.push('GPT 分区表');
  else if (structures.mbr) evidence.push(`MBR 分区表 (type 0x${(structures.mbrType || 0).toString(16).padStart(2, '0')})`);
  if (structures.hfs) evidence.push(structures.hfsVariant || 'HFS+');
  if (structures.apfs) evidence.push('APFS 容器');
  if (structures.udf) evidence.push('UDF 文件系统');
  if (structures.dmg) evidence.push('DMG (UDIF) 镜像');

  /* ---------- Windows 安装镜像 ---------- */
  const hasInstallImage = ['install.wim', 'install.esd', 'install.swm'].some((n) => names.has(n));
  const winMarkers = has('sources') && (hasInstallImage || has('bootmgr') || has('setup.exe'));
  const winLabel = /(win(dows)?|ccco|grmc|fpp|_dv9|x{1,2}f?re)/i.test(label) && !/^win(dows)?\s?(pe|re)/i.test(label);

  if (winMarkers || (winLabel && has('sources'))) {
    const wimEntry = entries.find((e) => /^install\.(wim|esd)$/.test(e.name));
    const wimSize = wimEntry ? wimEntry.size : 0;
    let version = null;
    const buildMatch = haystack.match(/(?:build[ _-]?)?(19\d{3}|2\d{4}|9\d{3}|7[0-9]{3})\b/);
    if (buildMatch) {
      const build = parseInt(buildMatch[1], 10);
      const hit = [...WINDOWS_NAMES].reverse().find((w) => build >= w.build);
      if (hit) version = hit.name;
    }
    if (!version) {
      if (/win(dows)?[ _-]?11/.test(haystack)) version = 'Windows 11';
      else if (/win(dows)?[ _-]?10/.test(haystack)) version = 'Windows 10';
      else if (/win(dows)?[ _-]?8[._]?1/.test(haystack)) version = 'Windows 8.1';
      else if (/win(dows)?[ _-]?8/.test(haystack)) version = 'Windows 8';
      else if (/win(dows)?[ _-]?7/.test(haystack)) version = 'Windows 7';
    }
    const arch = guessArch(haystack) || { arch: 'x64', label: 'x86_64' };
    if (hasInstallImage) evidence.push('sources/install.' + (wimEntry ? wimEntry.name.split('.').pop() : 'wim'));
    if (wimSize > 4 * 1024 * 1024 * 1024 * 0.98) evidence.push('install.wim 超过 4 GB');

    return {
      ok: true,
      path: imagePath,
      fileName: stem,
      size: stat.size,
      label,
      kind: 'iso9660',
      structures,
      target: {
        os: 'windows',
        osLabel: 'Windows',
        version: version || '未识别版本',
        arch: arch.arch,
        archLabel: arch.label,
        confidence: winMarkers ? 0.97 : 0.7,
        evidence,
      },
      needsFat32Split: wimSize > 4 * 1024 * 1024 * 1024 * 0.98,
      wimSize,
      hasUefiBoot: hasPrefix('efi') || has('bootmgr.efi'),
      hasBiosBoot: has('bootmgr') || hasPrefix('boot'),
      recommended: {
        scheme: 'gpt',
        filesystem: 'fat32',
        bootMode: 'hybrid',
        note: 'UEFI + Legacy 双引导，install.wim 超限时自动拆分',
      },
    };
  }

  /* ---------- macOS 安装镜像 ---------- */
  const macMarkers =
    structures.hfs ||
    structures.apfs ||
    structures.dmg ||
    /install (mac )?os|macos|os ?x|base ?system|installesd/.test(haystack) ||
    names.has('basesystem.dmg') ||
    names.has('installesd.dmg');

  if (macMarkers && !/windows|ubuntu|debian|fedora/i.test(haystack)) {
    const v = guessMacosVersion(haystack);
    const arch = guessArch(haystack) || { arch: 'x64', label: 'x86_64' };
    if (names.has('basesystem.dmg')) evidence.push('BaseSystem.dmg（10.13+ 布局）');
    if (names.has('installesd.dmg')) evidence.push('InstallESD.dmg（10.12 及更早布局）');
    if (names.has('packages')) evidence.push('Packages 目录');
    return {
      ok: true,
      path: imagePath,
      fileName: stem,
      size: stat.size,
      label,
      kind: structures.apfs ? 'apfs' : structures.hfs ? 'hfs+' : structures.dmg ? 'dmg' : 'iso9660',
      structures,
      target: {
        os: 'macos',
        osLabel: 'macOS',
        version: v ? `macOS ${v.version}${v.name ? ' ' + v.name : ''}` : '未识别版本',
        arch: arch.arch,
        archLabel: arch.label,
        confidence: v ? v.confidence : 0.72,
        evidence,
      },
      hasUefiBoot: true,
      hasBiosBoot: false,
      recommended: {
        scheme: 'gpt',
        filesystem: structures.apfs ? 'apfs' : 'hfs+',
        bootMode: 'mac',
        note: 'GPT + 原生 macOS 分区，恢复后自动设置启动 bless',
      },
    };
  }

  /* ---------- Linux ---------- */
  const linuxMarkers =
    has('casper') ||
    has('isolinux') ||
    has('liveos') ||
    has('isofs') ||
    has('squashfs.img') ||
    has('vmlinuz') ||
    has('initrd.img') ||
    has('.disk') ||
    hasPrefix('arch') ||
    /linux|ubuntu|debian|fedora|centos|arch|mint|kali|suse|alpine|manjaro|rocky|alma/.test(haystack);

  if (linuxMarkers) {
    let distro = null;
    for (const h of LINUX_HINTS) {
      if (h.re.test(haystack)) {
        distro = h.distro;
        break;
      }
    }
    if (!distro && has('casper')) distro = 'Ubuntu 系';
    if (!distro && has('isolinux')) distro = '通用 Linux (ISOLINUX)';
    const arch = guessArch(haystack) || { arch: 'x64', label: 'x86_64' };
    if (has('casper')) evidence.push('casper/ 目录');
    if (has('isolinux')) evidence.push('isolinux/ 目录');
    if (has('squashfs.img') || has('liveos')) evidence.push('LiveOS 结构');
    if (has('.disk')) evidence.push('.disk/info');
    const verMatch = stem.match(/(\d+\.\d+(?:\.\d+)?)/);
    return {
      ok: true,
      path: imagePath,
      fileName: stem,
      size: stat.size,
      label,
      kind: pvd ? 'iso9660' : 'raw',
      structures,
      target: {
        os: 'linux',
        osLabel: distro || 'Linux',
        version: verMatch ? `${distro || 'Linux'} ${verMatch[1]}` : distro || 'Linux',
        arch: arch.arch,
        archLabel: arch.label,
        confidence: pvd ? 0.95 : 0.75,
        evidence,
      },
      supportsPersistence: has('casper') || has('liveos'),
      hasUefiBoot: hasPrefix('efi'),
      hasBiosBoot: has('isolinux') || has('boot'),
      recommended: {
        scheme: structures.gpt ? 'gpt' : 'mbr',
        filesystem: 'raw',
        bootMode: structures.gpt ? 'uefi' : 'hybrid',
        note: '混合 ISO 直接整盘写入，保留原有分区与引导',
      },
    };
  }

  /* ---------- 兜底：未知镜像 ---------- */
  const ext = (stem.split('.').pop() || '').toLowerCase();
  const extHint = /^iso$/i.test(ext)
    ? '光盘镜像（ISO）'
    : /^dmg$/i.test(ext)
      ? 'macOS 磁盘映像（DMG）'
      : /^(img|raw|dd|bin)$/i.test(ext)
        ? '原始磁盘映像（RAW）'
        : /^cdr$/i.test(ext)
          ? 'Mac 光盘映像（CDR）'
          : '';
  return {
    ok: true,
    path: imagePath,
    fileName: stem,
    size: stat.size,
    label,
    kind: structures.apfs
      ? 'apfs'
      : structures.hfs
        ? 'hfs+'
        : pvd || structures.udf
          ? 'iso9660'
          : structures.dmg
            ? 'dmg'
            : 'raw',
    structures,
    target: {
      os: 'unknown',
      osLabel: '未知镜像',
      version: extHint ? `识别为：${extHint}` : '请手动选择目标系统',
      arch: guessArch(haystack)?.arch || 'x64',
      archLabel: guessArch(haystack)?.label || '未知',
      confidence: 0.3,
      evidence,
    },
    hasUefiBoot: structures.gpt || hasPrefix('efi'),
    hasBiosBoot: structures.mbr,
    recommended: {
      scheme: structures.gpt ? 'gpt' : 'mbr',
      filesystem: 'raw',
      bootMode: 'hybrid',
      note: '按原始镜像逐字节写入',
    },
  };
}

module.exports = { probeImage, MACOS_NAMES, WINDOWS_NAMES };

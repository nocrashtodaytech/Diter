'use strict';
/**
 * Linux 磁盘枚举（/sys + /proc，无需 root 即有只读信息）
 *
 * 设备身份判定：
 *   removable=1 且挂在 USB/MMC 总线上 → 可写
 *   nvme / sata 内建盘 → 锁定
 *   /proc/mounts 反查根分区（含 LVM / mdraid / dm-crypt 还原）→ 系统盘锁定
 */
const fs = require('fs');

const SYS_BLOCK = '/sys/block';
const SKIP = /^(loop|ram|zram|dm-|md|sr|nbd|fd|drbd)/;

const rd = (p) => {
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
};
const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

/** 分区名 → 整盘名（sda1→sda, nvme0n1p2→nvme0n1, mmcblk0p1→mmcblk0） */
function wholeDiskOfName(name) {
  const sys = `/sys/class/block/${name}`;
  if (!exists(sys)) return null;
  const link = (() => {
    try {
      return fs.readlinkSync(sys);
    } catch {
      return '';
    }
  })();
  // ../../devices/pci.../block/sda/sda1 → 父目录名即整盘
  const dir = link.split('/').filter(Boolean);
  if (dir.length >= 2) {
    const parent = dir[dir.length - 2];
    if (parent && exists(`/sys/block/${parent}`)) return parent;
  }
  if (exists(`${sys}/partition`)) {
    const base = name.replace(/p?\d+$/, '');
    if (exists(`/sys/block/${base}`)) return base;
  }
  return exists(`/sys/block/${name}`) ? name : null;
}

/** 解析 /dev/mapper/*、/dev/md* 到最底层整盘集合 */
function resolveToWholeDisks(devicePath, depth = 0, acc = new Set()) {
  if (!devicePath || depth > 6) return acc;
  let real = devicePath;
  try {
    real = fs.realpathSync(devicePath);
  } catch {
    /* 使用原路径 */
  }
  const base = real.split('/').pop();
  const slavesDir = `/sys/class/block/${base}/slaves`;
  if (exists(slavesDir)) {
    for (const s of fs.readdirSync(slavesDir)) {
      const w = wholeDiskOfName(s);
      if (w) acc.add(w);
      else resolveToWholeDisks(`/dev/${s}`, depth + 1, acc);
    }
    return acc;
  }
  const w = wholeDiskOfName(base);
  if (w) acc.add(w);
  return acc;
}

function readMounts() {
  const out = [];
  let text = '';
  try {
    text = fs.readFileSync('/proc/mounts', 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const [dev, mount, fstype] = line.split(' ');
    if (!dev || !dev.startsWith('/dev/')) continue;
    out.push({ dev, mount: mount.replace(/\\040/g, ' '), fstype });
  }
  return out;
}

function listSync() {
  const mounts = readMounts();
  const protectedDisks = new Set();
  for (const m of mounts) {
    if (['/', '/boot', '/boot/efi', '/boot/efi/', '/usr', '/var'].includes(m.mount)) {
      resolveToWholeDisks(m.dev).forEach((d) => protectedDisks.add(d));
    }
  }
  // 兜底：任何挂着 swap 的设备
  try {
    const swaps = fs.readFileSync('/proc/swaps', 'utf8').split('\n').slice(1);
    for (const s of swaps) {
      const dev = s.split(/\s+/)[0];
      if (dev && dev.startsWith('/dev/')) resolveToWholeDisks(dev).forEach((d) => protectedDisks.add(d));
    }
  } catch {}

  let entries = [];
  try {
    entries = fs.readdirSync(SYS_BLOCK);
  } catch {
    return { ok: false, error: '无法读取 /sys/block', devices: [] };
  }

  const devices = [];
  for (const name of entries) {
    if (SKIP.test(name)) continue;
    const dir = `${SYS_BLOCK}/${name}`;
    if (!exists(`${dir}/device`)) continue; // 虚拟设备无 device 链接

    const sectors = parseInt(rd(`${dir}/size`) || '0', 10);
    const size = sectors * 512;
    if (size <= 0) continue;

    const removable = rd(`${dir}/removable`) === '1';
    const model = rd(`${dir}/device/model`) || rd(`${dir}/device/name`) || name;
    const vendor = rd(`${dir}/device/vendor`) || '';
    let deviceLink = '';
    try {
      deviceLink = fs.readlinkSync(`${dir}/device`);
    } catch {}
    const isUsb = /\/usb\d*\//.test(deviceLink) || /usb/.test(rd(`${dir}/device/uevent`));
    const isMmc = /mmc/.test(name) || /mmc/.test(deviceLink);
    const isNvme = /^nvme/.test(name);

    const busKind = isUsb ? 'usb' : isMmc ? 'sd' : isNvme || /ata|sata|scsi|virtio/i.test(deviceLink) ? 'internal' : 'unknown';

    // 分区与挂载点
    const volumes = [];
    let partitionScheme = '—';
    try {
      const parts = fs.readdirSync(dir).filter((f) => exists(`${dir}/${f}/partition`));
      for (const p of parts) {
        const mp = mounts.find((m) => m.dev === `/dev/${p}`);
        const label = rd(`/sys/class/block/${p}/uevent`)
          .split('\n')
          .find((l) => l.startsWith('DEVNAME='));
        volumes.push({
          name: label ? label.split('=')[1] : p,
          mount: mp ? mp.mount : '',
          fs: mp ? mp.fstype : '',
        });
      }
      if (parts.length && exists(`${dir}/${parts[0]}/partition`)) {
        const p1 = rd(`${dir}/${parts[0]}/partition`);
        const partType = rd(`/sys/class/block/${parts[0]}/uevent`);
        partitionScheme = /EFI|PARTITION_TYPE/.test(partType) ? 'GPT' : 'MBR';
        void p1;
      }
    } catch {}

    devices.push({
      id: name,
      node: `/dev/${name}`,
      rawNode: `/dev/${name}`,
      name: `${vendor ? vendor + ' ' : ''}${model}`.replace(/\s+/g, ' ').trim() || name,
      size,
      bus: isUsb ? 'USB' : isMmc ? 'MMC / SD' : isNvme ? 'NVMe' : 'SATA / SCSI',
      busKind,
      removable,
      internal: busKind === 'internal',
      virtual: false,
      isSystemDisk: protectedDisks.has(name),
      mountPoints: volumes.filter((v) => v.mount).map((v) => v.mount),
      volumes,
      partitionScheme,
      writable: !/^1$/.test(rd(`${dir}/ro`)),
      detail: `${isUsb ? 'USB' : isMmc ? 'MMC/SD' : '内建'} · ${removable ? '可移动' : '固定'}`,
      platform: 'linux',
      serial: rd(`${dir}/device/serial`) || '',
    });
  }

  devices.sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, devices };
}

async function list() {
  return listSync();
}

async function unmount(deviceId) {
  const { run } = require('../util');
  const r = await run('sh', [
    '-c',
    `for m in $(awk '$1 ~ /^\\/dev\\/${deviceId}/ { print $2 }' /proc/mounts); do umount "$m" || exit 1; done`,
  ], { timeout: 30000 });
  return { ok: r.ok, stderr: r.stderr.trim() };
}

async function eject(deviceId) {
  const { run } = require('../util');
  await run('udisksctl', ['unmount', '-b', `/dev/${deviceId}`]);
  const r = await run('udisksctl', ['power-off', '-b', `/dev/${deviceId}`]);
  return { ok: r.ok, stderr: r.stderr.trim() };
}

async function partition() {
  return { ok: false, stderr: 'Linux 分区由 engines/linux.js 通过 sfdisk/mkfs 完成' };
}

module.exports = { list, unmount, eject, partition, platform: 'linux', resolveToWholeDisks, wholeDiskOfName };

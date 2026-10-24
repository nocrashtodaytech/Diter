'use strict';
/**
 * macOS 磁盘枚举
 *
 * 关键点（已在本机实测验证）：
 * 1. `diskutil list -plist` 里的 OSInternal 字段不可靠（内建 SSD 也返回 false），
 *    必须用 `diskutil info -plist diskN` 的 Internal / BusProtocol / Removable。
 * 2. 根卷 `/` 的 ParentWholeDisk 是 **合成盘** disk1（APFS 容器），
 *    真实物理盘需要通过 APFSPhysicalStores 追溯到 disk0s2 → disk0。
 *    只比对 disk1 会导致"系统盘漏判"，必须做整条链解析。
 */
const { run } = require('../util');

const RAW = (id) => `/dev/r${id}`;
const NODE = (id) => `/dev/${id}`;

async function plistJson(shellCmd) {
  const r = await run('sh', ['-c', `${shellCmd} | plutil -convert json -o - -`], { timeout: 20000 });
  if (!r.ok || !r.stdout.trim()) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

/** disk1s4s1 → disk1s4 → disk1 */
function wholeDiskOf(identifier) {
  const m = /^(disk\d+)/.exec(identifier || '');
  return m ? m[1] : null;
}

async function list() {
  const tree = await plistJson('diskutil list -plist');
  if (!tree || !Array.isArray(tree.AllDisksAndPartitions)) {
    return { ok: false, error: '无法读取磁盘列表（diskutil 未返回有效数据）', devices: [] };
  }

  const byId = new Map();
  for (const d of tree.AllDisksAndPartitions) byId.set(d.DeviceIdentifier, d);

  /* ---------- 构建 "子盘 → 物理父盘" 关系 ---------- */
  const physicalParents = new Map(); // disk1 -> Set('disk0')
  const addEdge = (child, parent) => {
    if (!child || !parent) return;
    if (!physicalParents.has(child)) physicalParents.set(child, new Set());
    physicalParents.get(child).add(parent);
  };
  for (const d of tree.AllDisksAndPartitions) {
    if (Array.isArray(d.APFSPhysicalStores)) {
      for (const ps of d.APFSPhysicalStores) {
        const p = wholeDiskOf(ps.DeviceIdentifier);
        if (p && p !== d.DeviceIdentifier) addEdge(d.DeviceIdentifier, p);
      }
    }
  }

  /** 递归展开到最底层物理盘 */
  const resolveLeaf = (id, seen = new Set()) => {
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const parents = physicalParents.get(id);
    if (!parents || parents.size === 0) return [id];
    const out = [];
    for (const p of parents) out.push(...resolveLeaf(p, seen));
    return out;
  };

  /* ---------- 找出系统盘链：根卷 + 所有内建关键挂载点 ---------- */
  const protectedIds = new Set();
  const rootInfo = await plistJson('diskutil info -plist /');
  if (rootInfo && rootInfo.ParentWholeDisk) {
    const chain = [rootInfo.ParentWholeDisk, ...resolveLeaf(rootInfo.ParentWholeDisk)];
    chain.forEach((id) => protectedIds.add(id));
  }
  for (const d of tree.AllDisksAndPartitions) {
    const mounts = [];
    for (const v of d.APFSVolumes || []) if (v.MountPoint) mounts.push(v.MountPoint);
    for (const p of d.Partitions || []) if (p.MountPoint) mounts.push(p.MountPoint);
    if (mounts.includes('/')) {
      protectedIds.add(d.DeviceIdentifier);
      resolveLeaf(d.DeviceIdentifier).forEach((id) => protectedIds.add(id));
      if (physicalParents.get(d.DeviceIdentifier)) {
        protectedIds.add(d.DeviceIdentifier);
      }
      // 反向：容器保护后，其物理盘也必须保护
      for (const [child, parents] of physicalParents) {
        if (child === d.DeviceIdentifier) parents.forEach((p) => protectedIds.add(p));
      }
    }
  }

  /* ---------- 逐盘取详情 ---------- */
  const candidates = tree.AllDisksAndPartitions.filter((d) => /^disk\d+$/.test(d.DeviceIdentifier));
  const infos = await Promise.all(
    candidates.map((d) => plistJson(`diskutil info -plist ${d.DeviceIdentifier}`))
  );

  const devices = candidates.map((d, i) => {
    const info = infos[i] || {};
    const id = d.DeviceIdentifier;
    const isVirtual =
      info.VirtualOrPhysical === 'Virtual' ||
      /Apple_APFS_Container/.test(d.Content || '') ||
      /disk image/i.test(info.MediaName || '');
    const volumes = [];
    for (const v of d.APFSVolumes || []) {
      if (v.VolumeName || v.MountPoint)
        volumes.push({ name: v.VolumeName || '', mount: v.MountPoint || '', fs: 'APFS' });
    }
    for (const p of d.Partitions || []) {
      if (p.Content === 'EFI') continue;
      volumes.push({
        name: p.VolumeName || '',
        mount: p.MountPoint || '',
        fs: p.Content || '',
      });
    }

    const busRaw = (info.BusProtocol || '').trim();
    const busKind = /USB/i.test(busRaw)
      ? 'usb'
      : /Secure Digital|SD/i.test(busRaw)
      ? 'sd'
      : /SATA|PCI-Express|Apple Fabric|NVMe/i.test(busRaw)
      ? 'internal'
      : /Virtual/i.test(busRaw) || isVirtual
      ? 'virtual'
      : 'unknown';

    let name = (info.MediaName || '').trim() || `磁盘 ${id}`;
    name = name.replace(/\s*(USB|Media|Device|Disk)\s*$/i, '').trim() || name;
    if (!/usb|sd|card/i.test(name)) {
      const usbVolume = volumes.find((v) => v.name);
      if (usbVolume) name = `${name} · ${usbVolume.name}`;
    }

    return {
      id,
      node: NODE(id),
      rawNode: RAW(id),
      name,
      size: d.Size || info.MediaSize || 0,
      bus: busRaw || '未知接口',
      busKind,
      removable: info.Removable === true,
      internal: info.Internal === true,
      virtual: isVirtual,
      isSystemDisk: protectedIds.has(id),
      plannedOrProtected: protectedIds.has(id),
      mountPoints: volumes.filter((v) => v.mount).map((v) => v.mount),
      volumes,
      partitionScheme: /GUID/i.test(d.Content || '')
        ? 'GPT'
        : /FDisk|MBR/i.test(d.Content || '')
        ? 'MBR'
        : /Apple_partition/i.test(d.Content || '')
        ? 'APM'
        : '—',
      writable: true,
      detail: `${busRaw || '未知'} · ${info.Removable ? '可移动' : '固定'}`,
      platform: 'darwin',
    };
  });

  return { ok: true, devices };
}

/** 卸载磁盘上所有卷（写入前必须），失败不抛异常 */
async function unmount(deviceId) {
  const r = await run('diskutil', ['unmountDisk', 'force', deviceId], { timeout: 30000 });
  return { ok: r.ok, stderr: r.stderr.trim() };
}

/** 安全弹出 */
async function eject(deviceId) {
  const r = await run('diskutil', ['eject', deviceId], { timeout: 30000 });
  if (!r.ok) {
    const r2 = await run('diskutil', ['unmountDisk', 'force', deviceId], { timeout: 30000 });
    return { ok: r2.ok, stderr: r2.stderr.trim() };
  }
  return { ok: true };
}

/** 分区 / 格式化能力（macOS 原生） */
async function partition(deviceId, plan) {
  // plan: { scheme:'gpt'|'mbr', partitions:[{name,fs,size}] }
  const scheme = plan.scheme === 'mbr' ? 'MBRFormat' : 'GPTFormat';
  const args = ['eraseDisk', plan.filesystem === 'apfs' ? 'APFS' : plan.filesystem === 'fat32' ? 'MS-DOS' : 'JHFS+', plan.name || 'VULCAN', scheme, deviceId];
  const r = await run('diskutil', args, { timeout: 180000 });
  return { ok: r.ok, stderr: r.stderr.trim(), stdout: r.stdout.trim() };
}

async function getReadSource(imagePath, isDmg) {
  // dmg 需要一个挂载点或 asr 直接读源；ISO 走文件读
  return { path: imagePath, isDmg: !!isDmg };
}

module.exports = { list, unmount, eject, partition, getReadSource, platform: 'darwin' };

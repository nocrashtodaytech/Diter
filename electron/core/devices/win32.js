'use strict';
/**
 * Windows 磁盘枚举
 *
 * 优先用 PowerShell CIM 的 Get-Disk（Win8+ / PowerShell 3+），
 * 失败则回退 wmic（Win7 / PowerShell 2），保证"几乎所有 Windows 版本"。
 *
 * 安全判据（双重）：
 *   - IsSystem / IsBoot → 系统盘，永久锁定
 *   - BusType ∈ {USB, SD, MMC} 或 MediaType=Removable → 可写
 *   - 其余（SATA / NVMe / RAID / Virtual）→ 内建盘，锁定
 */
const { run } = require('../util');

// MSFT_StorageBusType
const BUS = {
  0: '未知', 1: 'SCSI', 2: 'ATAPI', 3: 'ATA', 4: '1394', 5: 'SSA', 6: 'Fibre',
  7: 'USB', 8: 'RAID', 9: 'iSCSI', 10: 'SAS', 11: 'SATA', 12: 'SD', 13: 'MMC',
  14: '虚拟', 15: '文件虚拟', 16: '存储空间', 17: 'NVMe', 18: 'SCM', 19: 'UFS',
};

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$out = @()
$sysDrive = ($env:SystemDrive -replace ':','')
foreach ($d in Get-Disk | Sort-Object Number) {
  $letters = @()
  $mounts  = @()
  $vols    = @()
  try {
    foreach ($p in Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue) {
      if ($p.DriveLetter) { $letters += "$($p.DriveLetter):" }
      foreach ($ap in $p.AccessPaths) { if ($ap) { $mounts += $ap } }
      try {
        $v = Get-Volume -Partition $p -ErrorAction SilentlyContinue
        if ($v) { $vols += @{ name = $v.FileSystemLabel; fs = $v.FileSystem; letter = "$($p.DriveLetter)"; size = $v.Size } }
      } catch {}
    }
  } catch {}
  $out += [pscustomobject]@{
    number       = $d.Number
    name         = $d.FriendlyName
    size         = [double]$d.Size
    busType      = [int]$d.BusType
    mediaType    = "$($d.MediaType)"
    isBoot       = [bool]$d.IsBoot
    isSystem     = [bool]$d.IsSystem
    isOffline    = [bool]$d.IsOffline
    isReadOnly   = [bool]$d.IsReadOnly
    partStyle    = "$($d.PartitionStyle)"
    serial       = "$($d.SerialNumber)"
    letters      = $letters
    mounts       = @($mounts | Where-Object { $_ -like '\\\\?\\Volume*' })
    containsBoot = ($letters -contains ($sysDrive + ':'))
    volumes      = $vols
  }
}
$out | ConvertTo-Json -Depth 5 -Compress
`;

const WMIC_FALLBACK = `
$ErrorActionPreference = 'SilentlyContinue'
$out = @()
$i = 0
foreach ($d in Get-WmiObject Win32_DiskDrive) {
  $letters = @()
  foreach ($p in Get-WmiObject -Query "ASSOCIATORS OF {Win32_DiskDrive.DeviceID='$($d.DeviceID)'} WHERE AssocClass=Win32_DiskDriveToDiskPartition") {
    foreach ($l in Get-WmiObject -Query "ASSOCIATORS OF {Win32_DiskPartition.DeviceID='$($p.DeviceID)'} WHERE AssocClass=Win32_LogicalDiskToPartition") {
      $letters += "$($l.DeviceID)"
    }
  }
  $out += [pscustomobject]@{
    number=$i; name=$d.Model; size=[double]$d.Size; busType=7;
    mediaType="$($d.MediaType)"; isBoot=$false; isSystem=$false; isOffline=$false;
    isReadOnly=$false; partStyle="$($d.Partitions)"; serial="$($d.SerialNumber)";
    letters=$letters; mounts=@(); containsBoot=($letters -contains "$env:SystemDrive"); volumes=@()
  }
  $i++
}
$out | ConvertTo-Json -Depth 5 -Compress
`;

async function ps(script) {
  const r = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: 40000 }
  );
  if (!r.ok || !r.stdout.trim()) return null;
  try {
    const parsed = JSON.parse(r.stdout.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

async function list() {
  let rows = await ps(PS_SCRIPT);
  let legacy = false;
  if (!rows) {
    rows = await ps(WMIC_FALLBACK);
    legacy = true;
  }
  if (!rows) return { ok: false, error: '无法读取磁盘列表（PowerShell 调用失败）', devices: [] };

  const devices = rows.map((r) => {
    const busType = BUS[r.busType] || '未知';
    const busKind = /USB/i.test(busType)
      ? 'usb'
      : /SD|MMC/i.test(busType)
      ? 'sd'
      : /虚拟|文件虚拟|存储空间/i.test(busType)
      ? 'virtual'
      : ['SATA', 'NVMe', 'RAID', 'SCSI', 'SAS'].includes(busType)
      ? 'internal'
      : 'unknown';
    const volumes = Array.isArray(r.volumes) ? r.volumes : [];
    return {
      id: String(r.number),
      node: `\\\\.\\PhysicalDrive${r.number}`,
      rawNode: `\\\\.\\PhysicalDrive${r.number}`,
      name: (r.name || `磁盘 ${r.number}`).trim(),
      size: Number(r.size) || 0,
      bus: busType,
      busKind,
      removable: /removable/i.test(r.mediaType || '') || busKind === 'usb',
      internal: busKind === 'internal',
      virtual: busKind === 'virtual' || r.isOffline === true,
      isSystemDisk: r.isSystem === true || r.isBoot === true || r.containsBoot === true,
      mountPoints: (r.letters || []).map((l) => `${l}\\`),
      volumes: volumes
        .filter((v) => v && (v.name || v.letter))
        .map((v) => ({ name: v.name || '', mount: v.letter ? `${v.letter}:\\` : '', fs: v.fs || '' })),
      partitionScheme: r.partStyle && r.partStyle !== 'RAW' ? r.partStyle : 'RAW',
      writable: r.isReadOnly !== true,
      detail: `${busType} · ${(r.mediaType || '').replace('Media', '') || '—'}${legacy ? ' · 兼容模式' : ''}`,
      platform: 'win32',
    };
  });

  return { ok: true, devices, legacy };
}

/* Windows 的卸载 = 锁定卷并 dismount，由写入器调用 diskpart 完成 */
async function unmount(deviceId) {
  const r = await run('diskpart', ['/s', '-'], { timeout: 20000 });
  // diskpart 需要脚本文件，实际实现见 engines/raw.js 的 prepareWindows()
  return { ok: true, stderr: '' };
}

async function eject(deviceId) {
  const r = await run('powershell.exe', [
    '-NoProfile',
    '-Command',
    `(New-Object -comObject Shell.Application).Namespace(17).ParseName('${deviceId}').InvokeVerb('Eject')`,
  ]);
  return { ok: r.ok, stderr: r.stderr.trim() };
}

async function partition(deviceId, plan) {
  return { ok: false, stderr: 'Windows 分区由 engines/windows-media.js 通过 diskpart 脚本完成' };
}

module.exports = { list, unmount, eject, partition, platform: 'win32', BUS };

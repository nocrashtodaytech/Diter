'use strict';
/**
 * Linux 启动盘引擎：混合 ISO 整盘写入 + 可选持久化分区。
 * 主流发行版（Ubuntu/Debian/Fedora/Arch/Manjaro/Kali…）的 ISO 都是 isohybrid，
 * 逐字节写入即可 UEFI + Legacy 双启动，这也是 dd 在 Linux 上一直有效的原因。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run } = require('../util');
const { spawnStep } = require('./spawn');
const raw = require('./raw');
const { t } = require('../i18n');

/** 在剩余空间追加持久化分区（casper / LiveOS 用） */
async function addPersistence(device, imageSize, emit, signal) {
  const free = device.size - imageSize;
  if (free < 512 * 1024 * 1024) {
    emit({ message: t('msgPersistenceNoSpace') });
    return { created: false, reason: 'no-space' };
  }

  emit({ message: t('msgCreatingPersistence') });
  const hasSgdisk = await run('sh', ['-c', 'command -v sgdisk || true']);
  if (hasSgdisk.stdout.trim()) {
    await run('sgdisk', ['-n', '0:0:0', '-t', '0:8300', '-c', `0:casper-rw`, `/dev/${device.id}`], { timeout: 120000 });
  } else {
    await run('sh', ['-c', `echo ',+,L' | sfdisk -a /dev/${device.id}`], { timeout: 120000 });
  }
  await run('sh', ['-c', `partprobe /dev/${device.id} || true; sleep 1`]);

  // 取最后一个分区
  const ls = await run('sh', ['-c', `lsblk -lnpo NAME /dev/${device.id} | tail -1`]);
  const part = ls.stdout.trim();
  if (!part) return { created: false, reason: 'no-partition' };

  await spawnStep('mkfs.ext4', ['-F', '-L', 'casper-rw', part], { signal, onLine: () => {}, onStderr: () => {} });
  return { created: true, partition: part, size: free };
}

async function write(ctx) {
  const { imagePath, imageInfo, device, options = {}, emit, signal } = ctx;
  const total = imageInfo?.size || fs.statSync(imagePath).size;
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';

  emit({ phase: t('phasePrepare'), message: t('msgUnmounting'), pct: 0.01 });
  if (isMac) {
    // macOS：写盘前必须用 diskutil 强制卸载，否则 /dev/rdiskN 会因 EBUSY 打开/写入失败
    const u = await run('diskutil', ['unmountDisk', 'force', device.id], { timeout: 60000 });
    if (!u.ok) {
      emit({ message: t('msgUnmountHint', { msg: (u.stderr || '').trim().slice(-160) || t('errBusy') }) });
    }
  } else if (!isWin) {
    await run('sh', [
      '-c',
      `for m in $(awk '$1 ~ /^\\/dev\\/${device.id}/ { print $2 }' /proc/mounts); do umount "$m" || umount -l "$m" || true; done`,
    ]);
  } else {
    // Windows：写 \\.\PhysicalDriveN 前必须卸载卷，否则磁盘仍挂载时直接写会报 EIO。
    // diskpart clean 会 dismount 所有卷（raw 写入本就会覆盖整盘分区表，clean 无副作用）。
    const tmp = path.join(os.tmpdir(), `diter-clear-${Date.now()}.txt`);
    fs.writeFileSync(tmp, `select disk ${device.id}\nattributes disk clear readonly\nclean\n`, 'ascii');
    try {
      const r = await run('diskpart', ['/s', tmp], { timeout: 120000 });
      if (!r.ok) {
        emit({ message: t('msgUnmountHint', { msg: (r.stderr || r.stdout || '').trim().slice(-160) || t('errBusy') }) });
      }
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
  }

  // macOS 写 /dev/rdiskN（字符设备），Linux 写 /dev/sdX，Windows 写 \\.\PhysicalDriveN
  const targetNode = isWin ? device.rawNode : isMac ? `/dev/r${device.id}` : `/dev/${device.id}`;
  emit({ phase: t('phaseWrite'), message: t('msgStartWrite', { size: (total / 1073741824).toFixed(2) }), pct: 0.02 });
  const res = await raw.writeRaw({
    sourcePath: imagePath,
    targetNode,
    totalBytes: total,
    signal,
    threads: options.threads,
    onProgress: (pr) =>
      emit({
        pct: 0.02 + (pr.bytesWritten / pr.totalBytes) * 0.9,
        phase: t('phaseWrite'),
        message: t('msgWriting', { done: (pr.bytesWritten / 1073741824).toFixed(2), total: (pr.totalBytes / 1073741824).toFixed(2) }),
        speed: pr.speed,
        eta: pr.eta,
        bytesWritten: pr.bytesWritten,
        totalBytes: pr.totalBytes,
      }),
  });

  // 持久化分区仅 Linux 宿主支持（依赖 sgdisk/sfdisk/lsblk/mkfs.ext4）
  let persistence = { created: false };
  if (!isMac && !isWin && options.persistence && (imageInfo?.supportsPersistence || true)) {
    try {
      persistence = await addPersistence(device, total, emit, signal);
    } catch (e) {
      emit({ message: t('msgPersistenceFailed', { msg: e.message }) });
    }
  }

  return {
    mode: 'raw',
    bytesWritten: res.bytesWritten,
    persistence,
    note: persistence.created
      ? t('notePersistence')
      : t('noteRaw'),
  };
}

module.exports = { write, addPersistence };

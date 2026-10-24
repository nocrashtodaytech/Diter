'use strict';
/**
 * Linux 启动盘引擎：混合 ISO 整盘写入 + 可选持久化分区。
 * 主流发行版（Ubuntu/Debian/Fedora/Arch/Manjaro/Kali…）的 ISO 都是 isohybrid，
 * 逐字节写入即可 UEFI + Legacy 双启动，这也是 dd 在 Linux 上一直有效的原因。
 */
const fs = require('fs');
const { run } = require('../util');
const { spawnStep } = require('./spawn');
const raw = require('./raw');

/** 在剩余空间追加持久化分区（casper / LiveOS 用） */
async function addPersistence(device, imageSize, emit, signal) {
  const free = device.size - imageSize;
  if (free < 512 * 1024 * 1024) {
    emit({ message: '剩余空间不足 512 MB，跳过持久化分区' });
    return { created: false, reason: 'no-space' };
  }

  emit({ message: '在剩余空间创建持久化分区 casper-rw' });
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

  emit({ phase: '准备', message: '卸载目标磁盘', pct: 0.01 });
  if (isMac) {
    // macOS：写盘前必须用 diskutil 强制卸载，否则 /dev/rdiskN 会因 EBUSY 打开/写入失败
    const u = await run('diskutil', ['unmountDisk', 'force', device.id], { timeout: 60000 });
    if (!u.ok) {
      emit({ message: `卸载提示：${(u.stderr || '').trim().slice(-160) || '目标设备可能仍被占用'}` });
    }
  } else {
    await run('sh', [
      '-c',
      `for m in $(awk '$1 ~ /^\\/dev\\/${device.id}/ { print $2 }' /proc/mounts); do umount "$m" || umount -l "$m" || true; done`,
    ]);
  }

  // macOS 写原始字符设备 /dev/rdiskN（绕过块缓存），Linux 写 /dev/sdX
  const targetNode = isMac ? `/dev/r${device.id}` : `/dev/${device.id}`;
  emit({ phase: '写入', message: `开始写入 ${(total / 1073741824).toFixed(2)} GB`, pct: 0.02 });
  const res = await raw.writeRaw({
    sourcePath: imagePath,
    targetNode,
    totalBytes: total,
    signal,
    onProgress: (pr) =>
      emit({
        pct: 0.02 + (pr.bytesWritten / pr.totalBytes) * 0.9,
        phase: '写入',
        message: `写入 ${(pr.bytesWritten / 1073741824).toFixed(2)} / ${(pr.totalBytes / 1073741824).toFixed(2)} GB`,
        speed: pr.speed,
        eta: pr.eta,
        bytesWritten: pr.bytesWritten,
        totalBytes: pr.totalBytes,
      }),
  });

  // 持久化分区仅 Linux 宿主支持（依赖 sgdisk/sfdisk/lsblk/mkfs.ext4）
  let persistence = { created: false };
  if (!isMac && options.persistence && (imageInfo?.supportsPersistence || true)) {
    try {
      persistence = await addPersistence(device, total, emit, signal);
    } catch (e) {
      emit({ message: `持久化分区创建失败（不影响启动）：${e.message}` });
    }
  }

  return {
    mode: 'raw',
    bytesWritten: res.bytesWritten,
    persistence,
    note: persistence.created
      ? '整盘写入完成，已创建 casper-rw 持久化分区（需在内核参数中启用 persistent）。'
      : '整盘写入完成，保留 ISO 原有分区与引导。',
  };
}

module.exports = { write, addPersistence };

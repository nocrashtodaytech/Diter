'use strict';
/**
 * 写入编排器：唯一的写入入口。
 *
 * 职责链：安全层复核 → 选择引擎 → 执行 → 校验 → 弹出。
 * 任何一步失败都会把阶段、错误、系统原始输出一起上报，便于用户自查。
 */
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const devices = require('./devices');
const safety = require('./safety');
const rawEngine = require('./engines/raw');
const darwinEngine = require('./engines/darwin');
const winMediaEngine = require('./engines/windows-media');
const linuxEngine = require('./engines/linux');

const jobs = new Map();

/** 解析写入线程数：'auto'/未指定 → 按 CPU 核数取 2~4；显式数字 → 钳制到 1~8 */
function resolveThreads(threads) {
  if (threads === 'auto' || threads == null) {
    const cpu = os.cpus().length || 4;
    return Math.max(2, Math.min(4, cpu));
  }
  const n = parseInt(threads, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.max(1, Math.min(8, n));
}

function engineFor(targetOs, imageInfo) {
  const host = process.platform;
  if (targetOs === 'macos') {
    if (host === 'darwin') return { engine: darwinEngine, label: 'macOS 原生（createinstallmedia / asr / raw）' };
    // 非 macOS 宿主：仅当镜像是自带分区表的整盘映像时才可能成功
    if (imageInfo?.structures?.apfs || imageInfo?.structures?.hfs || imageInfo?.structures?.gpt) {
      return { engine: linuxEngine, label: '整盘映像写入（非 macOS 宿主，无法设置 bless）', warn: '在非 macOS 系统上写入的 macOS 启动盘通常无法被 Apple 硬件引导，仅供实验。' };
    }
    return { engine: null, unsupported: 'macOS 安装镜像只能在 macOS 上制作（Apple 安装器依赖 createinstallmedia 与 HFS/APFS 原生写入）。' };
  }
  if (targetOs === 'windows') return { engine: winMediaEngine, label: '文件级安装盘（分区 + FAT32 + 引导）' };
  return { engine: linuxEngine, label: '整盘字节级写入' };
}

/**
 * @param {object} p
 * @param {string} p.imagePath
 * @param {object} p.imageInfo   probeImage 的结果
 * @param {object} p.device      选择时的设备快照
 * @param {object} p.options     {verify:boolean, persistence:boolean, allowUnknownBus:boolean}
 * @param {Function} p.emit      事件回调
 */
async function start({ imagePath, imageInfo, device, options = {}, emit, preMounted, rootOps }) {
  const jobId = crypto.randomUUID();
  const controller = new AbortController();
  jobs.set(jobId, { controller, startedAt: Date.now() });

  // 解析写入线程数（'auto' / 数字），供各引擎读取
  options = { ...options, threads: resolveThreads(options.threads) };

  const total = imageInfo?.size || fs.statSync(imagePath).size;
  const scale = options.verify ? 0.92 : 1;

  const send = (e) => {
    try {
      emit({ jobId, threads: options.threads, ...e });
    } catch {}
  };

  // 异步执行，立即返回 jobId 供 UI 显示
  (async () => {
    try {
      /* ---------- 1. 安全复核（不可跳过） ---------- */
      send({ kind: 'phase', phase: '安全检查', pct: 0.005, message: '正在复核目标设备身份' });
      const mod = devices.impl();
      const fresh = await safety.revalidate(mod, device.id, device);
      safety.assertWritable(fresh, total, options);

      const pick = engineFor(imageInfo?.target?.os || 'linux', imageInfo);
      if (!pick.engine) {
        const err = new Error(pick.unsupported);
        err.code = 'UNSUPPORTED';
        throw err;
      }
      if (pick.warn) send({ kind: 'log', message: pick.warn });

      send({ kind: 'phase', phase: '准备', pct: 0.01, message: pick.label });

      /* ---------- 2. 执行引擎 ---------- */
      const result = await pick.engine.write({
        imagePath,
        imageInfo,
        device: { ...device, ...fresh },
        options,
        preMounted,
        rootOps,
        signal: controller.signal,
        emit: (e) => {
          const pct = typeof e.pct === 'number' ? Math.min(0.99, e.pct) : undefined;
          send({
            kind: 'progress',
            phase: e.phase || '写入',
            message: e.message || '',
            pct: pct === undefined ? undefined : pct * scale,
            speed: e.speed,
            eta: e.eta,
            bytesWritten: e.bytesWritten,
            totalBytes: e.totalBytes,
          });
        },
      });

      /* ---------- 3. 校验 ---------- */
      let verification = null;
      if (options.verify && result.mode === 'raw') {
        send({ kind: 'phase', phase: '校验', pct: 0.93, message: '回读设备并比对 SHA-256' });
        try {
          const v = await rawEngine.verifyRaw({
            sourcePath: imagePath,
            targetNode: process.platform === 'darwin' ? `/dev/r${device.id}` : device.rawNode,
            totalBytes: total,
            signal: controller.signal,
            threads: options.threads,
            onProgress: (p) =>
              send({
                kind: 'progress',
                phase: '校验',
                pct: 0.93 + (p.read / Math.max(1, p.total)) * 0.06,
                message: `校验数据 ${Math.round((p.read / Math.max(1, p.total)) * 100)}%`,
              }),
          });
          verification = v;
        } catch (e) {
          verification = { ok: false, error: e.message };
        }
      }

      /* ---------- 4. 收尾 ---------- */
      send({ kind: 'phase', phase: '完成', pct: 1, message: '写入完成' });
      send({
        kind: 'done',
        pct: 1,
        result: { ...result, verification, engine: pick.label },
      });
    } catch (e) {
      const cancelled = e.code === 'CANCELLED' || controller.signal.aborted;
      send({
        kind: cancelled ? 'cancelled' : 'error',
        error: {
          code: e.code || 'UNKNOWN',
          message: e.message,
          detail: (e.stderr || '').slice(-1200),
        },
      });
    } finally {
      jobs.delete(jobId);
    }
  })();

  return { jobId };
}

function cancel(jobId) {
  const j = jobs.get(jobId);
  if (!j) return false;
  j.controller.abort();
  return true;
}

/* ------------------------------------------------------------------ *
 * 磁盘擦除：整盘覆盖写零 / 随机数据（复用 raw 引擎与提权链路）
 * ------------------------------------------------------------------ */
async function erase({ device, options = {}, emit }) {
  const jobId = crypto.randomUUID();
  const controller = new AbortController();
  jobs.set(jobId, { controller, startedAt: Date.now() });
  options = { ...options, threads: resolveThreads(options.threads) };

  const total = device.size;
  const send = (e) => {
    try {
      emit({ jobId, threads: options.threads, ...e });
    } catch {}
  };

  (async () => {
    try {
      send({ kind: 'phase', phase: '安全检查', pct: 0.01, message: '正在复核目标设备身份' });
      const mod = devices.impl();
      const fresh = await safety.revalidate(mod, device.id, device);
      safety.assertWritable(fresh, 0, options);

      const targetNode = process.platform === 'darwin' ? `/dev/r${device.id}` : device.rawNode;
      send({ kind: 'phase', phase: '擦除', pct: 0.02, message: options.method === 'random' ? '随机数据覆盖写入' : '零覆盖写入' });
      const result = await rawEngine.eraseRaw({
        targetNode,
        totalBytes: total,
        signal: controller.signal,
        threads: options.threads,
        random: options.method === 'random',
        onProgress: (pr) =>
          send({
            kind: 'progress',
            phase: '擦除',
            pct: 0.02 + (pr.bytesWritten / Math.max(1, pr.totalBytes)) * 0.97,
            message: `擦除 ${(pr.bytesWritten / 1073741824).toFixed(2)} / ${(pr.totalBytes / 1073741824).toFixed(2)} GB`,
            speed: pr.speed,
            eta: pr.eta,
            bytesWritten: pr.bytesWritten,
            totalBytes: pr.totalBytes,
          }),
      });
      send({ kind: 'done', pct: 1, result: { mode: 'erase', method: options.method || 'zero', bytesWritten: result.bytesWritten } });
    } catch (e) {
      const cancelled = e.code === 'CANCELLED' || controller.signal.aborted;
      send({
        kind: cancelled ? 'cancelled' : 'error',
        error: { code: e.code || 'UNKNOWN', message: e.message, detail: (e.stderr || '').slice(-1200) },
      });
    } finally {
      jobs.delete(jobId);
    }
  })();

  return { jobId };
}

/* ------------------------------------------------------------------ *
 * 磁盘 → 镜像备份：把整盘读出来写成一个 .img 文件（反向 raw）
 * ------------------------------------------------------------------ */
async function backup({ device, targetPath, options = {}, emit }) {
  const jobId = crypto.randomUUID();
  const controller = new AbortController();
  jobs.set(jobId, { controller, startedAt: Date.now() });
  options = { ...options, threads: resolveThreads(options.threads) };

  const total = device.size;
  const send = (e) => {
    try {
      emit({ jobId, threads: options.threads, ...e });
    } catch {}
  };

  (async () => {
    try {
      send({ kind: 'phase', phase: '安全检查', pct: 0.01, message: '正在复核目标设备身份' });
      const mod = devices.impl();
      const fresh = await safety.revalidate(mod, device.id, device);
      safety.assertWritable(fresh, 0, options);

      const sourceNode = process.platform === 'darwin' ? `/dev/r${device.id}` : device.rawNode;
      send({ kind: 'phase', phase: '备份', pct: 0.02, message: '正在读取设备并写入镜像文件' });
      const result = await rawEngine.backupRaw({
        sourceNode,
        targetPath,
        totalBytes: total,
        signal: controller.signal,
        threads: options.threads,
        onProgress: (pr) =>
          send({
            kind: 'progress',
            phase: '备份',
            pct: 0.02 + (pr.bytesWritten / Math.max(1, pr.totalBytes)) * 0.97,
            message: `备份 ${(pr.bytesWritten / 1073741824).toFixed(2)} / ${(pr.totalBytes / 1073741824).toFixed(2)} GB`,
            speed: pr.speed,
            eta: pr.eta,
            bytesWritten: pr.bytesWritten,
            totalBytes: pr.totalBytes,
          }),
      });
      send({ kind: 'done', pct: 1, result: { mode: 'backup', bytesWritten: result.bytesWritten, targetPath } });
    } catch (e) {
      const cancelled = e.code === 'CANCELLED' || controller.signal.aborted;
      send({
        kind: cancelled ? 'cancelled' : 'error',
        error: { code: e.code || 'UNKNOWN', message: e.message, detail: (e.stderr || '').slice(-1200) },
      });
    } finally {
      jobs.delete(jobId);
    }
  })();

  return { jobId };
}

async function eject(deviceId) {
  return devices.eject(deviceId);
}

module.exports = { start, cancel, eject, erase, backup, engineFor };

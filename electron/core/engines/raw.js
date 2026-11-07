'use strict';
/**
 * 整盘写入引擎（raw / dd 语义）
 * 不调用 dd，直接以 Node 读写设备节点 —— 这样才有精确进度、可取消、可限速。
 *
 * macOS 用 /dev/rdiskN（字符设备，绕过缓冲区），Linux 用 /dev/sdX。
 *
 * 关键：写入循环使用异步 I/O（fs.promises，走 libuv 线程池）。若用同步
 * readSync/writeSync，整段循环会阻塞事件循环 —— 在 root 助手进程里会导致进度事件
 * 无法经 socket 发出（前端速率一直 0、进度卡死），主进程里则会冻结 UI。
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { RateMeter } = require('../util');

const CHUNK = 64 * 1024 * 1024;
// 原始设备按 4096 字节块对齐（macOS rdisk / 现代 SSD 的物理块大小）
const ALIGN = 4096;
// 多线程模式下每个线程的读写块大小
const PAR_CHUNK = 8 * 1024 * 1024;

/** 把底层 fs 错误映射成用户可读的中文提示，避免只看到 errno */
function writeErr(e, written) {
  if (!e || e.code === 'CANCELLED' || e.code === 'OPEN_FAILED') return e;
  const map = {
    EBUSY: '目标设备仍被系统占用（未卸载成功），请拔插 U 盘后重试',
    EACCES: '权限不足：需要管理员授权才能写入磁盘，请先点击右上角「需要授权」',
    EPERM: '权限不足：需要管理员授权才能写入磁盘',
    EROFS: '设备为只读（可能开启了物理写保护开关）',
    EINVAL: '目标设备不接受该写入方式，请确认设备未被占用',
    ENOSPC: '目标设备容量不足，请更换更大的 U 盘',
    EIO: '写入时发生 I/O 错误，U 盘可能存在坏块或已损坏',
  };
  const hint = e.code ? map[e.code] : null;
  if (hint) {
    e.message = hint;
  } else if (e.code && (!e.message || /^[A-Z]+:/.test(e.message))) {
    e.message = `写入 ${Math.floor(written / 1048576)} MB 后失败（${e.code}）：${e.message || '未知错误'}`;
  }
  return e;
}

/**
 * @param {{sourcePath:string,targetNode:string,totalBytes:number,onProgress:Function,signal:AbortSignal,threads?:number}} o
 */
async function writeRaw(o) {
  const { sourcePath, targetNode, onProgress, signal } = o;
  const total = o.totalBytes || fs.statSync(sourcePath).size;
  const threads = Math.max(1, Math.floor(o.threads || 1));
  // 多线程：镜像足够大时才分段并行，否则退回单线程（避免小镜像的开销）
  if (threads > 1 && total >= ALIGN * 2) {
    return writeRawParallel({ sourcePath, targetNode, total, onProgress, signal, threads });
  }
  const src = await fsp.open(sourcePath, 'r');
  let dst;
  try {
    // 用 r+ 而非 w，避免部分平台对块设备 O_TRUNC 的额外副作用
    dst = await fsp.open(targetNode, 'r+');
  } catch (e) {
    await src.close();
    const hint =
      e.code === 'EACCES' || e.code === 'EPERM'
        ? '权限不足，需要管理员权限'
        : e.code === 'EBUSY'
          ? '设备仍被占用（未卸载成功），请拔插 U 盘后重试'
          : e.message;
    const err = new Error(`无法打开目标设备 ${targetNode}：${hint}`);
    err.code = 'OPEN_FAILED';
    throw err;
  }

  const meter = new RateMeter(8000);
  const started = Date.now();
  const buf = Buffer.allocUnsafe(CHUNK);
  let written = 0;
  let lastEmit = 0;

  const emit = (force) => {
    const now = Date.now();
    if (!force && now - lastEmit < 120) return;
    lastEmit = now;
    const speed = meter.push(written, now);
    const elapsed = (now - started) / 1000;
    // 用平滑后的 ETA，避免速率抖动导致「剩余 1 分钟 → 3000 小时」跳变
    const eta = meter.eta(total - written, now);
    onProgress?.({ bytesWritten: written, totalBytes: total, speed, eta, elapsed });
  };

  try {
    while (written < total) {
      if (signal?.aborted) {
        const err = new Error('用户已取消');
        err.code = 'CANCELLED';
        throw err;
      }
      const want = Math.min(CHUNK, total - written);
      // 顺序读源文件（不传 position）：源文件从头到尾只读一次，让内核维护偏移，
      // 避免每次 pread 的额外系统调用开销。
      const { bytesRead } = await src.read(buf, 0, want);
      if (bytesRead <= 0) break;

      // 最后一块若不足 4096 字节，补齐到块边界再写（原始设备不接受非对齐写入）
      let data = buf;
      let toWrite = bytesRead;
      if (written + bytesRead >= total && bytesRead % ALIGN !== 0) {
        const padded = Buffer.alloc(Math.ceil(bytesRead / ALIGN) * ALIGN);
        buf.copy(padded, 0, 0, bytesRead);
        data = padded;
        toWrite = padded.length;
      }

      let off = 0;
      while (off < toWrite) {
        // 顺序写目标设备（不传 position）：对 /dev/rdiskN 这类字符设备，
        // 带 position 的写会走 pwrite，部分 macOS 版本对 raw device 的 pwrite
        // 会退化为 seek+write 或产生额外开销；顺序 write 是 rdisk 的标准用法。
        const { bytesWritten } = await dst.write(data, off, toWrite - off);
        if (bytesWritten <= 0) {
          const err = new Error('写入返回 0 字节，设备可能已断开');
          err.code = 'EIO';
          throw err;
        }
        off += bytesWritten;
      }
      written += bytesRead;
      emit(false);
    }
    await dst.sync();
    emit(true);
    return { bytesWritten: written, elapsedSec: (Date.now() - started) / 1000 };
  } catch (e) {
    throw writeErr(e, written);
  } finally {
    try {
      await dst.close();
    } catch {}
    try {
      await src.close();
    } catch {}
  }
}

/* ------------------------------------------------------------------ *
 * 多线程并行写入：把镜像按 4096 对齐切成 N 段，每段用一个 worker 以
 * 独立 fd + 显式 position（pread/pwrite）读写自己那一段，段间并行以
 * 充分利用多核与设备多通道；进度用一个共享计数器聚合。
 * ------------------------------------------------------------------ */

async function writeRawParallel({ sourcePath, targetNode, total, onProgress, signal, threads }) {
  const aligned = Math.ceil(total / ALIGN) * ALIGN;
  const segLen = Math.max(ALIGN, Math.ceil(aligned / threads / ALIGN) * ALIGN);
  const segments = [];
  for (let start = 0; start < aligned; start += segLen) {
    segments.push({ start, end: Math.min(aligned, start + segLen) });
  }

  const meter = new RateMeter(8000);
  const started = Date.now();
  let written = 0;
  let lastEmit = 0;

  const emit = (force) => {
    const now = Date.now();
    if (!force && now - lastEmit < 120) return;
    lastEmit = now;
    const speed = meter.push(written, now);
    const eta = meter.eta(Math.max(0, total - written), now);
    onProgress?.({ bytesWritten: written, totalBytes: total, speed, eta, elapsed: (now - started) / 1000 });
  };

  const worker = async (seg) => {
    const buf = Buffer.allocUnsafe(PAR_CHUNK);
    const src = await fsp.open(sourcePath, 'r');
    const dst = await fsp.open(targetNode, 'r+');
    try {
      let pos = seg.start;
      while (pos < seg.end) {
        if (signal?.aborted) throw Object.assign(new Error('用户已取消'), { code: 'CANCELLED' });
        const want = Math.min(PAR_CHUNK, seg.end - pos);
        const { bytesRead } = await src.read(buf, 0, want, pos);
        if (bytesRead <= 0) break;
        // 最后一段读不满时补零到对齐边界（原始设备不接受非对齐写入）
        let data = buf;
        let toWrite = bytesRead;
        if (bytesRead < want) {
          const padded = Buffer.alloc(want);
          buf.copy(padded, 0, 0, bytesRead);
          data = padded;
          toWrite = want;
        }
        let off = 0;
        while (off < toWrite) {
          if (signal?.aborted) throw Object.assign(new Error('用户已取消'), { code: 'CANCELLED' });
          const { bytesWritten: bw } = await dst.write(data, off, toWrite - off, pos + off);
          if (bw <= 0) throw Object.assign(new Error('写入返回 0 字节，设备可能已断开'), { code: 'EIO' });
          off += bw;
        }
        written += bytesRead;
        pos += toWrite;
        emit(false);
      }
    } finally {
      await dst.close().catch(() => {});
      await src.close().catch(() => {});
    }
  };

  try {
    await Promise.all(segments.map((s) => worker(s)));
    emit(true);
    return { bytesWritten: written, elapsedSec: (Date.now() - started) / 1000 };
  } catch (e) {
    throw writeErr(e, written);
  }
}

/* ------------------------------------------------------------------ *
 * 校验：源文件与设备回读的分段并行 SHA-256 比对
 * 提速手段（沿用多线程写入的思路）：
 *   1. 源文件哈希与设备回读哈希并行进行（原实现串行，慢一倍）；
 *   2. 每一边再按 4096 对齐分段、多线程并行 pread + 分段 SHA-256，
 *      最后对「各段哈希的拼接」再哈希一次得到组合指纹。
 * 源与设备采用完全相同的分段方式，组合指纹可直接比对（SHA-256 抗碰撞）。
 * ------------------------------------------------------------------ */

const cacheDir = path.join(os.tmpdir(), 'diter-hash-cache');
// 组合指纹算法版本：与旧的顺序哈希缓存区分，避免读到旧格式结果
const HASH_VER = 'v2';

function cacheKey(p) {
  const st = fs.statSync(p);
  return crypto
    .createHash('sha1')
    .update(`${HASH_VER}:${p}:${st.size}:${st.mtimeMs}`)
    .digest('hex');
}

/**
 * 对 path 指向的文件/设备做分段并行 SHA-256，返回组合指纹（hex）。
 * 每个 worker 用独立 fd + 显式 position（pread），互不干扰。
 */
async function hashPathParallel(p, total, { signal, threads = 1, onProgress } = {}) {
  const n = Math.max(1, Math.floor(threads || 1));
  const aligned = Math.ceil(total / ALIGN) * ALIGN;
  const segLen = Math.max(ALIGN, Math.ceil(aligned / n / ALIGN) * ALIGN);
  const segments = [];
  for (let start = 0; start < aligned; start += segLen) {
    segments.push({ start, end: Math.min(aligned, start + segLen) });
  }

  let read = 0;
  const worker = async (seg) => {
    const fd = await fsp.open(p, 'r');
    try {
      const h = crypto.createHash('sha256');
      const buf = Buffer.allocUnsafe(PAR_CHUNK);
      let pos = seg.start;
      while (pos < seg.end) {
        if (signal?.aborted) throw Object.assign(new Error('用户已取消'), { code: 'CANCELLED' });
        // 只读到 total，不读末尾对齐补零区
        const upTo = Math.min(PAR_CHUNK, seg.end - pos, Math.max(0, total - pos));
        if (upTo <= 0) break;
        const { bytesRead } = await fd.read(buf, 0, upTo, pos);
        if (bytesRead <= 0) break;
        h.update(buf.subarray(0, bytesRead));
        pos += bytesRead;
        read += bytesRead;
        onProgress?.(read);
      }
      return h.digest();
    } finally {
      await fd.close().catch(() => {});
    }
  };

  const digests = await Promise.all(segments.map((s) => worker(s)));
  const combined = crypto.createHash('sha256');
  for (const d of digests) combined.update(d);
  return combined.digest('hex');
}

async function sha256File(filePath, { signal, threads = 1, onProgress } = {}) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {}
  const key = cacheKey(filePath);
  const cacheFile = path.join(cacheDir, key);
  try {
    return fs.readFileSync(cacheFile, 'utf8').trim();
  } catch {}

  const total = fs.statSync(filePath).size;
  const hash = await hashPathParallel(filePath, total, { signal, threads, onProgress });
  try {
    fs.writeFileSync(cacheFile, hash);
  } catch {}
  return hash;
}

async function verifyRaw({ sourcePath, targetNode, totalBytes, signal, onProgress, threads = 1 }) {
  const total = totalBytes || fs.statSync(sourcePath).size;
  const n = Math.max(1, Math.floor(threads || 1));
  // 源与设备并行回读：聚合进度 = (源已读 + 设备已读) / (2 * total)，单调递增
  let srcRead = 0;
  let devRead = 0;
  const report = () => onProgress?.({ read: srcRead + devRead, total: total * 2 });
  report();

  const [srcHash, devHash] = await Promise.all([
    sha256File(sourcePath, {
      signal,
      threads: n,
      onProgress: (r) => {
        srcRead = r;
        report();
      },
    }),
    hashPathParallel(targetNode, total, {
      signal,
      threads: n,
      onProgress: (r) => {
        devRead = r;
        report();
      },
    }),
  ]);
  return { ok: srcHash === devHash, srcHash, devHash };
}

/* ------------------------------------------------------------------ *
 * 磁盘擦除：整盘覆盖写零 / 随机数据（复用分段并行写入框架）
 * ------------------------------------------------------------------ */

async function eraseRaw({ targetNode, totalBytes, signal, onProgress, threads = 1, random = false }) {
  const total = totalBytes;
  const n = Math.max(1, Math.floor(threads || 1));
  const aligned = Math.ceil(total / ALIGN) * ALIGN;
  const segLen = Math.max(ALIGN, Math.ceil(aligned / n / ALIGN) * ALIGN);
  const segments = [];
  for (let start = 0; start < aligned; start += segLen) {
    segments.push({ start, end: Math.min(aligned, start + segLen) });
  }

  // 覆盖数据：写零用一个零块；写随机则用随机块循环填充
  const fillBuf = random ? crypto.randomBytes(PAR_CHUNK) : Buffer.alloc(PAR_CHUNK);

  const meter = new RateMeter(8000);
  const started = Date.now();
  let written = 0;
  let lastEmit = 0;

  const emit = (force) => {
    const now = Date.now();
    if (!force && now - lastEmit < 120) return;
    lastEmit = now;
    const speed = meter.push(written, now);
    const eta = meter.eta(Math.max(0, total - written), now);
    onProgress?.({ bytesWritten: written, totalBytes: total, speed, eta, elapsed: (now - started) / 1000 });
  };

  const worker = async (seg) => {
    const dst = await fsp.open(targetNode, 'r+');
    try {
      let pos = seg.start;
      while (pos < seg.end) {
        if (signal?.aborted) throw Object.assign(new Error('用户已取消'), { code: 'CANCELLED' });
        const want = Math.min(PAR_CHUNK, seg.end - pos);
        let off = 0;
        while (off < want) {
          const { bytesWritten: bw } = await dst.write(fillBuf, 0, want - off, pos + off);
          if (bw <= 0) throw Object.assign(new Error('写入返回 0 字节，设备可能已断开'), { code: 'EIO' });
          off += bw;
        }
        written += want;
        pos += want;
        emit(false);
      }
    } finally {
      await dst.close().catch(() => {});
    }
  };

  try {
    await Promise.all(segments.map((s) => worker(s)));
    emit(true);
    return { bytesWritten: written, elapsedSec: (Date.now() - started) / 1000 };
  } catch (e) {
    throw writeErr(e, written);
  }
}

/* ------------------------------------------------------------------ *
 * 磁盘 → 镜像备份：读设备写文件（反向 raw，复用分段并行框架）
 * ------------------------------------------------------------------ */

async function backupRaw({ sourceNode, targetPath, totalBytes, signal, onProgress, threads = 1 }) {
  const total = totalBytes;
  const n = Math.max(1, Math.floor(threads || 1));
  const aligned = Math.ceil(total / ALIGN) * ALIGN;
  const segLen = Math.max(ALIGN, Math.ceil(aligned / n / ALIGN) * ALIGN);
  const segments = [];
  for (let start = 0; start < aligned; start += segLen) {
    segments.push({ start, end: Math.min(aligned, start + segLen) });
  }

  const meter = new RateMeter(8000);
  const started = Date.now();
  let written = 0;
  let lastEmit = 0;

  const emit = (force) => {
    const now = Date.now();
    if (!force && now - lastEmit < 120) return;
    lastEmit = now;
    const speed = meter.push(written, now);
    const eta = meter.eta(Math.max(0, total - written), now);
    onProgress?.({ bytesWritten: written, totalBytes: total, speed, eta, elapsed: (now - started) / 1000 });
  };

  const worker = async (seg) => {
    const src = await fsp.open(sourceNode, 'r');
    const dst = await fsp.open(targetPath, 'r+');
    try {
      const buf = Buffer.allocUnsafe(PAR_CHUNK);
      let pos = seg.start;
      while (pos < seg.end) {
        if (signal?.aborted) throw Object.assign(new Error('用户已取消'), { code: 'CANCELLED' });
        const want = Math.min(PAR_CHUNK, seg.end - pos);
        // 只读真实数据，不读末尾对齐补零区
        const upTo = Math.min(want, Math.max(0, total - pos));
        if (upTo <= 0) break;
        const { bytesRead } = await src.read(buf, 0, upTo, pos);
        if (bytesRead <= 0) break;
        let off = 0;
        while (off < bytesRead) {
          const { bytesWritten: bw } = await dst.write(buf, off, bytesRead - off, pos + off);
          if (bw <= 0) throw Object.assign(new Error('写入返回 0 字节'), { code: 'EIO' });
          off += bw;
        }
        written += bytesRead;
        pos += bytesRead;
        emit(false);
      }
    } finally {
      await dst.close().catch(() => {});
      await src.close().catch(() => {});
    }
  };

  try {
    await Promise.all(segments.map((s) => worker(s)));
    emit(true);
    return { bytesWritten: written, elapsedSec: (Date.now() - started) / 1000 };
  } catch (e) {
    throw writeErr(e, written);
  }
}

module.exports = { writeRaw, verifyRaw, sha256File, eraseRaw, backupRaw, CHUNK };

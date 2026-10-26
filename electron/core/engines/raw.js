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

/**
 * @param {{sourcePath:string,targetNode:string,totalBytes:number,onProgress:Function,signal:AbortSignal}} o
 */
async function writeRaw(o) {
  const { sourcePath, targetNode, onProgress, signal } = o;
  const total = o.totalBytes || fs.statSync(sourcePath).size;
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
    const eta = speed > 0 ? (total - written) / speed : 0;
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
      const { bytesRead } = await src.read(buf, 0, want, written);
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
        const { bytesWritten } = await dst.write(data, off, toWrite - off, written + off);
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
    // 把底层 fs 错误转成可读信息，避免用户只看到 "写入未完成" 或英文 errno
    const map = {
      EBUSY: '目标设备仍被系统占用（未卸载成功），请拔插 U 盘后重试',
      EACCES: '权限不足：需要管理员授权才能写入磁盘，请先点击右上角「需要授权」',
      EPERM: '权限不足：需要管理员授权才能写入磁盘',
      EROFS: '设备为只读（可能开启了物理写保护开关）',
      EINVAL: '目标设备不接受该写入方式，请确认设备未被占用',
      ENOSPC: '目标设备容量不足，请更换更大的 U 盘',
      EIO: '写入时发生 I/O 错误，U 盘可能存在坏块或已损坏',
    };
    if (e.code && e.code !== 'CANCELLED' && e.code !== 'OPEN_FAILED') {
      const hint = map[e.code];
      if (hint) {
        e.message = hint;
      } else if (!e.message || /^[A-Z]+:/.test(e.message)) {
        e.message = `写入 ${Math.floor(written / 1048576)} MB 后失败（${e.code}）：${e.message || '未知错误'}`;
      }
    }
    throw e;
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
 * 校验：源文件与设备回读的 SHA-256 比对
 * ------------------------------------------------------------------ */

const cacheDir = path.join(os.tmpdir(), 'diter-hash-cache');

function cacheKey(p) {
  const st = fs.statSync(p);
  return crypto
    .createHash('sha1')
    .update(`${p}:${st.size}:${st.mtimeMs}`)
    .digest('hex');
}

async function hashFd(fd, total, offset, signal, onTick) {
  const h = crypto.createHash('sha256');
  const buf = Buffer.allocUnsafe(CHUNK);
  let read = 0;
  while (read < total) {
    if (signal?.aborted) throw Object.assign(new Error('用户已取消'), { code: 'CANCELLED' });
    const want = Math.min(CHUNK, total - read);
    const { bytesRead } = await fd.read(buf, 0, want, offset + read);
    if (bytesRead <= 0) break;
    h.update(buf.subarray(0, bytesRead));
    read += bytesRead;
    onTick?.(read);
  }
  return h.digest('hex');
}

async function sha256File(filePath, { signal, onProgress } = {}) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {}
  const key = cacheKey(filePath);
  const cacheFile = path.join(cacheDir, key);
  try {
    return fs.readFileSync(cacheFile, 'utf8').trim();
  } catch {}

  const total = fs.statSync(filePath).size;
  const fd = await fsp.open(filePath, 'r');
  try {
    const hash = await hashFd(fd, total, 0, signal, (n) => onProgress?.(n, total));
    try {
      fs.writeFileSync(cacheFile, hash);
    } catch {}
    return hash;
  } finally {
    await fd.close();
  }
}

async function verifyRaw({ sourcePath, targetNode, totalBytes, signal, onProgress }) {
  const total = totalBytes || fs.statSync(sourcePath).size;
  onProgress?.({ stage: 'source', read: 0, total });
  const srcHash = await sha256File(sourcePath, {
    signal,
    onProgress: (n) => onProgress?.({ stage: 'source', read: n, total }),
  });
  const fd = await fsp.open(targetNode, 'r');
  try {
    const devHash = await hashFd(fd, total, 0, signal, (n) => onProgress?.({ stage: 'device', read: n, total }));
    return { ok: srcHash === devHash, srcHash, devHash };
  } finally {
    await fd.close();
  }
}

module.exports = { writeRaw, verifyRaw, sha256File, CHUNK };

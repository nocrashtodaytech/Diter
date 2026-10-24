'use strict';
/**
 * 整盘写入引擎（raw / dd 语义）
 * 不调用 dd，直接以 Node 读写设备节点 —— 这样才有精确进度、可取消、可限速。
 *
 * macOS 用 /dev/rdiskN（字符设备，绕过缓冲区），Linux 用 /dev/sdX。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { RateMeter, throttle } = require('../util');

const CHUNK = 8 * 1024 * 1024;
// 原始设备按 4096 字节块对齐（macOS rdisk / 现代 SSD 的物理块大小）
const ALIGN = 4096;

function openTarget(node) {
  // 用 r+ 而非 w，避免部分平台对块设备 O_TRUNC 的额外副作用
  return fs.openSync(node, 'r+');
}

/**
 * @param {{sourcePath:string,targetNode:string,totalBytes:number,onProgress:Function,signal:AbortSignal}} o
 */
async function writeRaw(o) {
  const { sourcePath, targetNode, onProgress, signal } = o;
  const total = o.totalBytes || fs.statSync(sourcePath).size;
  const src = fs.openSync(sourcePath, 'r');
  let dst;
  try {
    dst = openTarget(targetNode);
  } catch (e) {
    fs.closeSync(src);
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

  const meter = new RateMeter(3000);
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
      const got = fs.readSync(src, buf, 0, want, written);
      if (got <= 0) break;

      // 最后一块若不足 4096 字节，补齐到块边界再写（原始设备不接受非对齐写入）
      const isLast = written + got >= total;
      let data = buf;
      let toWrite = got;
      if (isLast && got % ALIGN !== 0) {
        const padded = Buffer.alloc(Math.ceil(got / ALIGN) * ALIGN);
        buf.copy(padded, 0, 0, got);
        data = padded;
        toWrite = padded.length;
      }

      let off = 0;
      while (off < toWrite) {
        off += fs.writeSync(dst, data, off, toWrite - off, written + off);
      }
      written += got;
      emit(false);
    }
    fs.fsyncSync(dst);
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
        // 未匹配到的 errno / 空消息，附上已写进度与原始信息便于定位
        e.message = `写入 ${Math.floor(written / 1048576)} MB 后失败（${e.code}）：${e.message || '未知错误'}`;
      }
    }
    throw e;
  } finally {
    try {
      fs.closeSync(dst);
    } catch {}
    try {
      fs.closeSync(src);
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

function hashFd(fd, total, offset, signal, onTick) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const buf = Buffer.allocUnsafe(CHUNK);
    let read = 0;
    const step = () => {
      try {
        while (read < total) {
          if (signal?.aborted) return reject(Object.assign(new Error('用户已取消'), { code: 'CANCELLED' }));
          const want = Math.min(CHUNK, total - read);
          const got = fs.readSync(fd, buf, 0, want, offset + read);
          if (got <= 0) break;
          h.update(buf.subarray(0, got));
          read += got;
          if (read % (256 * 1024 * 1024) < CHUNK) onTick?.(read);
        }
        resolve(h.digest('hex'));
      } catch (e) {
        reject(e);
      }
    };
    // 让出事件循环，避免阻塞主进程
    setTimeout(step, 0);
  });
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
  const fd = fs.openSync(filePath, 'r');
  try {
    const hash = await hashFd(fd, total, 0, signal, (n) => onProgress?.(n, total));
    try {
      fs.writeFileSync(cacheFile, hash);
    } catch {}
    return hash;
  } finally {
    fs.closeSync(fd);
  }
}

async function verifyRaw({ sourcePath, targetNode, totalBytes, signal, onProgress }) {
  const total = totalBytes || fs.statSync(sourcePath).size;
  onProgress?.({ stage: 'source', read: 0, total });
  const srcHash = await sha256File(sourcePath, {
    signal,
    onProgress: (n) => onProgress?.({ stage: 'source', read: n, total }),
  });
  const fd = fs.openSync(targetNode, 'r');
  try {
    const devHash = await hashFd(fd, total, 0, signal, (n) => onProgress?.({ stage: 'device', read: n, total }));
    return { ok: srcHash === devHash, srcHash, devHash };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { writeRaw, verifyRaw, sha256File, CHUNK };

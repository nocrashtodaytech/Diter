'use strict';
/**
 * 提权助手客户端（在主窗口进程内运行）。
 *
 * 连接 root 助手进程的 Unix socket，把写盘任务委托出去，
 * 并把助手回传的进度事件分发给主窗口。
 */
const net = require('net');

const SOCK = process.platform === 'win32' ? '\\\\.\\pipe\\diter-helper' : '/tmp/diter-helper.sock';

let socket = null;
let seq = 0;
let pending = new Map(); // id -> resolve(msg)
let onEvent = null; // (event) => void，由 main.js 注入广播函数

function setEventHandler(fn) {
  onEvent = fn;
}

function connect() {
  return new Promise((resolve, reject) => {
    const s = net.connect(SOCK);
    const onErr = (e) => reject(e);
    s.once('error', onErr);
    s.once('connect', () => {
      s.removeListener('error', onErr);
      s.setTimeout(0); // 关闭空闲超时，保持长连接
      resolve(s);
    });
    s.setTimeout(2500, () => {
      s.destroy();
      reject(new Error('助手连接超时'));
    });
  });
}

async function ensure() {
  if (socket && !socket.destroyed) return socket;
  socket = await connect();
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.t === 'event') {
        if (onEvent) {
          try {
            onEvent(m.event);
          } catch {}
        }
      } else {
        const p = pending.get(m.id);
        if (p) {
          pending.delete(m.id);
          p(m);
        }
      }
    }
  });
  socket.on('close', () => {
    socket = null;
  });
  socket.on('error', () => {
    socket = null;
  });
  return socket;
}

async function request(msg, timeoutMs = 8000) {
  const s = await ensure();
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    s.write(JSON.stringify({ ...msg, id }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ t: 'error', message: '助手无响应' });
      }
    }, timeoutMs);
  });
}

/** 探测助手是否可用（Unix 上还要求是 root，避免非 root 助手误判可用导致写盘 EACCES） */
async function ping() {
  try {
    const r = await request({ t: 'ping' }, 2500);
    if (r.t !== 'pong') return false;
    if (process.platform !== 'win32') return r.uid === 0;
    return true;
  } catch {
    return false;
  }
}

/** 委托写盘任务，返回 { jobId }，进度经 setEventHandler 广播 */
async function start(payload) {
  const r = await request({ t: 'start', payload }, 10000);
  if (r.t === 'error') throw new Error(r.message);
  return { jobId: r.jobId };
}

/** 取消任务 */
async function cancel(jobId) {
  try {
    const s = await ensure();
    s.write(JSON.stringify({ t: 'cancel', jobId }) + '\n');
  } catch {}
  return true;
}

/** 委托 root 助手格式化磁盘（分区 + eraseDisk），返回实际挂载点。
 *  macOS 对可移动宗卷有 TCC 隐私保护：文件级写入必须留在用户会话（可弹授权框），
 *  只有磁盘管理类操作（分区/格式化/原始字节写入）交给 root。 */
async function format({ deviceId }) {
  const r = await request({ t: 'format', deviceId }, 320000);
  if (r.t === 'error') throw new Error(r.message);
  return { mountPoint: r.mountPoint };
}

/** 弹出设备 */
async function eject(deviceId) {
  try {
    const r = await request({ t: 'eject', deviceId }, 8000);
    return r.r || { ok: false };
  } catch {
    return { ok: false };
  }
}

/** 主窗口退出时通知助手退出 */
async function shutdown() {
  try {
    const s = await ensure();
    s.write(JSON.stringify({ t: 'shutdown' }) + '\n');
  } catch {}
}

module.exports = { setEventHandler, ping, start, cancel, eject, format, shutdown, SOCK };

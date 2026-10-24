'use strict';
/**
 * 通用小工具：进程调用、单位换算、字节比较、限流。
 */
const { execFile } = require('child_process');

/** 执行外部命令，永不抛异常，统一返回 { ok, code, stdout, stderr } */
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        timeout: opts.timeout || 30000,
        maxBuffer: 16 * 1024 * 1024,
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' },
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
          stdout: stdout || '',
          stderr: stderr || '',
        });
      }
    );
  });
}

/** 人类可读字节数，二进制单位 */
function human(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1);
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/** 人类可读速率 */
function humanRate(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '—';
  return `${human(bytesPerSec)}/s`;
}

/** 秒 → 4分12秒 */
function humanDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0 || sec > 86400 * 2) return '—';
  const s = Math.round(sec);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m} 分 ${r} 秒` : `${m} 分`;
  const h = Math.floor(m / 60);
  return `${h} 时 ${m % 60} 分`;
}

/**
 * 从 mount 输出解析指定分区的实际挂载点（如 disk3s1 → /Volumes/DITER）。
 * 不能假设卷一定挂成 /Volumes/<卷标>：macOS 在多次卸载/挂载后常把
 * /Volumes/<卷标> 留成悬空符号链接，此时新卷会挂成 "/Volumes/<卷标> 1"，
 * 跟着硬编码路径写文件会得到 ENOENT。
 */
async function mountPointOf(partId) {
  const r = await run('mount', []);
  if (!r.ok) return null;
  const prefix = `/dev/${partId} on `;
  const line = (r.stdout || '').split('\n').find((l) => l.startsWith(prefix));
  if (!line) return null;
  let mp = line.slice(prefix.length);
  const paren = mp.lastIndexOf(' (');
  if (paren >= 0) mp = mp.slice(0, paren);
  // mount 对特殊字符做八进制转义：\040 空格、\011 Tab、\134 反斜杠
  return mp.replace(/\\040/g, ' ').replace(/\\011/g, '\t').replace(/\\134/g, '\\');
}

/**
 * 等待格式化后的分区出现挂载点（系统自动挂载有延迟）。
 * 依次探测 s1/s2（MBR 单分区是 s1，GPT 数据分区是 s2），
 * 首轮找不到时会主动 diskutil mount 兜底。
 */
async function waitMountPoint(deviceId, { timeoutMs = 30000 } = {}) {
  const parts = [`${deviceId}s1`, `${deviceId}s2`];
  const deadline = Date.now() + timeoutMs;
  let triedMount = false;
  while (Date.now() < deadline) {
    for (const p of parts) {
      const mp = await mountPointOf(p);
      if (mp) return mp;
    }
    if (!triedMount) {
      triedMount = true;
      await run('diskutil', ['mount', parts[0]]);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('格式化完成，但系统未能挂载 U 盘分区，请拔插 U 盘后重试');
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** 简单滑动平均，用于速率显示不抖 */
class RateMeter {
  constructor(windowMs = 3000) {
    this.windowMs = windowMs;
    this.samples = [];
  }
  push(bytes, now = Date.now()) {
    this.samples.push({ bytes, t: now });
    const cutoff = now - this.windowMs;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
    return this.rate(now);
  }
  rate(now = Date.now()) {
    const s = this.samples;
    if (s.length < 2) return 0;
    const first = s[0];
    const last = s[s.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0.05) return 0;
    return Math.max(0, (last.bytes - first.bytes) / dt);
  }
  reset() {
    this.samples = [];
  }
}

/** 把一段毫秒级异步工作量做节流，避免 IPC 风暴 */
function throttle(fn, ms = 100) {
  let last = 0;
  let timer = null;
  let pending = null;
  return (...args) => {
    pending = args;
    const now = Date.now();
    const wait = ms - (now - last);
    if (wait <= 0) {
      last = now;
      fn(...pending);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...pending);
      }, wait);
    }
  };
}

module.exports = { run, human, humanRate, humanDuration, clamp, RateMeter, throttle, mountPointOf, waitMountPoint };

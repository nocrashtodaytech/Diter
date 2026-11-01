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

/** 速率测量：用 EMA（指数移动平均）平滑瞬时速率，并给出稳定的 ETA。
 *
 *  为什么不用简单滑动窗口：
 *   1. 写入是「大块 + 突发」的 —— U 盘写入时内核周期性 flush，瞬时速率会在
 *      100 MB/s 与几 KB/s 之间剧烈摆动。窗口首尾差分会把这种抖动直接放大，
 *      导致「剩余 1 分钟」下一秒变成「3000 多小时」。
 *   2. 慢速写入时（一个 64MB 块耗时数秒），8 秒窗口内样本稀疏，窗口算法退化为
 *      累计平均，早期样本不足又会给出极小速率 → ETA 巨大。
 *
 *  EMA 相当于一个低通滤波器，时间常数约 2~3 秒，把高频抖动滤掉；ETA 再做一层
 *  低通平滑 + 单步涨幅钳制，保证只向真实值收敛、绝不瞬间跳变。 */
class RateMeter {
  constructor(windowMs = 8000) {
    this.windowMs = windowMs;
    this.started = 0;
    this.total = 0;
    this._ema = 0; // EMA 平滑速率 (B/s)
    this._lastBytes = 0;
    this._lastT = 0;
    this._eta = 0; // 平滑后的 ETA（秒）
  }
  push(bytes, now = Date.now()) {
    if (!this.started) {
      this.started = now;
      this._lastT = now;
      this._lastBytes = bytes;
      this.total = bytes;
      return 0;
    }
    const dt = (now - this._lastT) / 1000;
    const db = bytes - this._lastBytes;
    this._lastT = now;
    this._lastBytes = bytes;
    this.total = bytes;
    if (dt > 0.05 && db > 0) {
      const inst = db / dt;
      // alpha 随采样间隔自适应：间隔越短越信任新样本，整体时间常数 ~4s，
      // 足够滤掉 U 盘周期性 flush 造成的瞬时速率骤降/骤升。
      const alpha = Math.min(0.3, dt / (dt + 4));
      this._ema = this._ema > 0 ? this._ema + alpha * (inst - this._ema) : inst;
    }
    return this.rate(now);
  }
  rate(now = Date.now()) {
    if (this._ema > 0) return this._ema;
    // 兜底：累计平均（样本仍稀疏时给出非零值，而非显示 0 B/s）
    const dtTotal = (now - this.started) / 1000;
    if (dtTotal > 2 && this.total > 0) return this.total / dtTotal;
    return 0;
  }
  /** 用平滑速率计算剩余时间，再做一层低通，消除「1 分钟 → 3000 小时」的跳变。
   *  速率本身已 EMA 平滑，ETA 只需轻量低通即可稳定；不加涨幅上限，保证持续
   *  变慢时 ETA 仍能逐步收敛到真实值，而非被钳制在偏低的假值上。 */
  eta(remaining, now = Date.now()) {
    const speed = this.rate(now);
    if (speed <= 0 || remaining <= 0) return this._eta || 0;
    const raw = remaining / speed;
    if (!Number.isFinite(raw) || raw <= 0) return this._eta || 0;
    if (!this._eta) this._eta = raw;
    else this._eta = this._eta * 0.75 + raw * 0.25;
    return this._eta;
  }
  reset() {
    this.started = 0;
    this.total = 0;
    this._ema = 0;
    this._lastBytes = 0;
    this._lastT = 0;
    this._eta = 0;
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

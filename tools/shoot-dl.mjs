/**
 * 用 CDP 驱动预览页，验证「软件内下载镜像」流程并截图。
 * 用法：Chrome --remote-debugging-port=9226 启动后，node tools/shoot-dl.mjs 9226
 */
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.argv[2] || '9226';
const OUT = path.resolve('preview');
const URL_ = `file://${path.resolve('preview/diter-preview.html')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res);
  ws.addEventListener('error', rej);
});

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});

let sessionId = null;
function send(method, params = {}) {
  const id = ++seq;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(OUT, name);
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  console.log('  📸', name, (fs.statSync(p).size / 1024).toFixed(0) + 'KB');
}

const { targetId } = await send('Target.createTarget', { url: URL_ });
const att = await send('Target.attachToTarget', { targetId, flatten: true });
sessionId = att.sessionId;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1160, height: 780, deviceScaleFactor: 2, mobile: false });
await sleep(1600);

// 1. 打开下载面板
await evaluate(`
  [...document.querySelectorAll('.section-head .btn')]
    .find((b) => b.textContent.includes('下载镜像'))?.click()
`);
await sleep(900);
await shot('dl-1-catalog.png');

// 2. 点击 Ubuntu（direct 直链）的「下载」
const clicked = await evaluate(`
  (() => {
    const rows = [...document.querySelectorAll('.dl-row')];
    const target = rows.find((r) => r.textContent.includes('Ubuntu'));
    if (!target) return 'no-row';
    const btn = [...target.querySelectorAll('.dl-actions .btn')].find((b) => b.textContent.includes('下载'));
    if (!btn) return 'no-btn';
    btn.click();
    return 'clicked';
  })()
`);
console.log('点击下载结果:', clicked);
await sleep(1800);
await shot('dl-2-downloading.png');

// 3. 等待下载完成（mock 约 6-10 秒），出现「使用此镜像」
let done = false;
for (let i = 0; i < 25; i++) {
  await sleep(800);
  done = await evaluate(`!![...document.querySelectorAll('.dl-row')].some(r => r.textContent.includes('使用此镜像'))`);
  if (done) break;
}
await shot('dl-3-done.png');

const stats = await evaluate(`JSON.stringify({
  rows: document.querySelectorAll('.dl-row').length,
  tabs: document.querySelectorAll('.dl-tab').length,
  officialButtons: [...document.querySelectorAll('.dl-row')].filter(r => r.textContent.includes('官方下载')).length,
  doneButtons: [...document.querySelectorAll('.dl-row')].filter(r => r.textContent.includes('使用此镜像')).length,
  brand: document.querySelector('.brand-name')?.textContent,
  title: document.title
})`);
console.log('DOM:', stats);

await send('Target.closeTarget', { targetId });
ws.close();

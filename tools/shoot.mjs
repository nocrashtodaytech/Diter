/**
 * 用 Chrome DevTools Protocol 驱动预览页，抓取各状态截图。
 * 走 browser 级 endpoint + Target.createTarget，避免无头模式下找不到 page target。
 * 用法：Chrome --remote-debugging-port=9225 启动后，node tools/shoot.mjs 9225
 */
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.argv[2] || '9225';
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
await send('Emulation.setDeviceMetricsOverride', { width: 1040, height: 700, deviceScaleFactor: 2, mobile: false });
await sleep(1800);

console.log('抓取状态：');
await shot('01-idle.png');

await evaluate(`document.querySelector('.dropzone')?.click()`);
await sleep(800);
await shot('02-image.png');

await evaluate(`document.querySelector('.device:not(.locked)')?.click()`);
await sleep(400);
await shot('03-selected.png');

await evaluate(`document.querySelector('.footer .btn.primary')?.click()`);
await sleep(500);
await shot('04-confirm.png');

await evaluate(`document.querySelector('.confirm-check')?.click()`);
await sleep(250);
await evaluate(`
  const b = document.querySelector('.hold-btn');
  if (b) {
    const r = b.getBoundingClientRect();
    const o = { bubbles: true, clientX: r.x + 8, clientY: r.y + 8 };
    b.dispatchEvent(new MouseEvent('mousedown', o));
  }
`);
await sleep(700);
await shot('05-holding.png');
await sleep(4600);
await shot('06-writing.png');

for (let i = 0; i < 45; i++) {
  await sleep(800);
  if (await evaluate(`!!document.querySelector('.result-orb.ok')`)) break;
}
await shot('07-done.png');

const stats = await evaluate(`JSON.stringify({
  devices: document.querySelectorAll('.device').length,
  locked: document.querySelectorAll('.device.locked').length,
  done: !!document.querySelector('.result-orb.ok'),
  errors: window.__errs || []
})`);
console.log('DOM:', stats);

await send('Target.closeTarget', { targetId });
ws.close();

'use strict';
/**
 * 提权助手的纯 Node 入口。
 *
 * 用 `ELECTRON_RUN_AS_NODE=1 <Electron二进制> <本文件>` 启动，
 * 完全绕过 Electron 的 GUI 初始化 —— 这很关键：
 * root 进程无法访问当前登录用户的 WindowServer（GUI 会话），
 * 若直接跑 Electron GUI 会在 app.whenReady() 之前就崩溃，socket server 根本起不来。
 *
 * 纯 Node 模式下只做一件事：起本地 socket，复用 writer.js 的完整写入逻辑。
 */
const fs = require('fs');
const LOG = '/tmp/diter-helper.log';

try {
  fs.writeFileSync(
    LOG,
    `started pid=${process.pid} uid=${typeof process.getuid === 'function' ? process.getuid() : 'n/a'}\n`
  );
} catch {}

try {
  require('./helper-server').startServer();
} catch (e) {
  try {
    fs.appendFileSync(LOG, `FATAL: ${e && e.stack ? e.stack : e}\n`);
  } catch {}
  process.exit(1);
}

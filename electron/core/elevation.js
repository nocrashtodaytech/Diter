'use strict';
/**
 * 权限提升
 *
 * 写盘必须 root/Administrator。策略：以 root 启动一个「无窗口助手进程」，
 * 主窗口保持不动，写盘任务通过本地 socket 委托给助手执行。
 *
 * macOS 关键点（踩过很多坑）：
 * 1) 助手必须是纯 Node 模式（ELECTRON_RUN_AS_NODE=1），否则 root 进程访问不到
 *    WindowServer（GUI 会话），Electron 在初始化阶段就崩溃，socket 起不来。
 * 2) 助手必须以前台方式运行在 `do shell script` 之下（绝不能 nohup + & 后台化）：
 *    `do shell script` 会一直等待这条命令结束，而助手是常驻 socket server 不退出，
 *    因此它能一直被 keep-alive；而后台化在 `with administrator privileges` 下会被系统回收。
 * 3) osascript 由主进程 spawn 且不 await，密码框弹出后主窗口事件循环继续跑。
 */
const path = require('path');
const { spawn } = require('child_process');
const { run } = require('./util');

let cached = null;
let lastError = ''; // 最近一次提权 osascript 的 stderr / 退出信息

/** 是否为提权助手进程（以 --elevated 启动的 headless 实例，Windows/Linux 用） */
function isHelper() {
  return process.argv.includes('--elevated');
}

async function isElevated() {
  if (cached !== null) return cached;
  if (process.platform === 'win32') {
    const r = await run('powershell.exe', [
      '-NoProfile',
      '-Command',
      '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
    ]);
    cached = /true/i.test(r.stdout);
  } else {
    cached = typeof process.getuid === 'function' && process.getuid() === 0;
  }
  return cached;
}

/** 返回上次提权的错误信息（供主进程在轮询失败时回传给前端） */
function lastElevationError() {
  return lastError;
}

/** 发起提权（fire-and-forget）。真实就绪状态由 main.js 轮询 helper.ping() 确认。 */
function relaunchElevated() {
  const execPath = process.execPath;
  const appPath = require('electron').app.getAppPath();

  if (process.platform === 'darwin') {
    const helperEntry = path.join(appPath, 'electron', 'core', 'helper-entry.js');
    // 前台运行助手（不加 nohup / &），见文件顶部注释
    const cmd = `ELECTRON_RUN_AS_NODE=1 ${quote(execPath)} ${quote(helperEntry)}`;
    const script = `do shell script ${JSON.stringify(cmd)} with administrator privileges`;
    lastError = '';
    try {
      const child = spawn('osascript', ['-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
      let errBuf = '';
      child.stderr.on('data', (d) => {
        errBuf += d.toString();
      });
      child.on('error', (e) => {
        lastError = e.message;
      });
      child.on('exit', (code) => {
        // 正常情况（助手长期存活）不会触发 exit；只有用户取消 / 助手退出才会走到这里
        if (code !== 0) {
          lastError = (errBuf || '').trim() || `osascript 退出码 ${code}`;
        }
      });
    } catch (e) {
      lastError = e.message;
    }
    return;
  }

  if (process.platform === 'win32') {
    const args = `--elevated`;
    run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Start-Process -FilePath '${execPath}' -ArgumentList '${args}' -Verb RunAs`,
    ], { timeout: 120000 }).then((r) => {
      if (!r.ok) lastError = (r.stderr || r.stdout || '提权失败').trim();
    });
    return;
  }

  // Linux
  run('pkexec', [execPath, '--elevated'], { timeout: 120000 }).then((r) => {
    if (!r.ok) lastError = (r.stderr || r.stdout || '提权失败').trim();
  });
}

function quote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

module.exports = { isElevated, relaunchElevated, isHelper, lastElevationError };

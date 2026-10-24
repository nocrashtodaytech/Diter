'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const devices = require('./core/devices');
const safety = require('./core/safety');
const { probeImage } = require('./core/detect');
const writer = require('./core/writer');
const elevation = require('./core/elevation');
const helperServer = require('./core/helper-server');
const helper = require('./core/helper-client');
const { run } = require('./core/util');
const pkg = require('../package.json');

let win = null;

/* ---------- 预挂载镜像（root 助手无 GUI 会话，hdiutil attach 会被拒） ---------- */
// jobId -> { devEntry, mountPoint, mountPoints }
const pendingMounts = new Map();

/** 是否需要为镜像文件预挂载（.app 安装器无需挂载） */
function needsMount(imagePath, imageInfo) {
  if (!imagePath || /\.app$/i.test(imagePath)) return false;
  const os = imageInfo?.target?.os;
  return os === 'windows' || os === 'macos';
}

/** 在主进程（用户 GUI 会话）挂载镜像，返回挂载信息 */
async function preMount(imagePath) {
  const darwin = require('./core/engines/darwin');
  const m = await darwin.mountImage(imagePath);
  if (!m || !m.mountPoints.length) {
    throw new Error('挂载镜像失败：系统未能提供挂载点，请确认镜像文件完整。');
  }
  return {
    mountPoint: m.mountPoints[m.mountPoints.length - 1],
    mountPoints: m.mountPoints,
    devEntry: m.devEntry,
  };
}

/** 任务结束后卸载预挂载的镜像 */
async function detachPreMounted(m) {
  if (!m) return;
  const target = m.devEntry || m.mountPoint;
  try {
    await run('hdiutil', ['detach', target, '-force'], { timeout: 60000 });
  } catch {
    // 静默失败：用户可手动推出
  }
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1040,
    height: 700,
    minWidth: 860,
    minHeight: 600,
  // macOS 毛玻璃：vibrancy('under-window') 让窗口透出桌面模糊。
  // 注意：transparent:true 会禁用 vibrancy（Electron 已知行为），所以这里不设 transparent，
  // 只用全透明 backgroundColor 让 vibrancy 层透出来。
  transparent: false,
  backgroundColor: isMac ? '#00000000' : '#f4f4f6',
  vibrancy: isMac ? 'under-window' : undefined,
  visualEffectState: 'active',
    show: false,
    title: 'Diter',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 15 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
  });

  // 禁止在应用内导航到外部页面，外链走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 阻止拖放文件触发页面导航（否则拖入镜像会导致 renderer 跳转到 file:// 并丢失状态）
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

/** 把事件广播给当前窗口（本地写入或助手回传的统一出口） */
function broadcast(e) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('diter:event', e);
  }
}

// 本地（主进程内）执行的写入任务 id —— cancel 时要区分走 writer 还是 helper
const localJobs = new Set();

/** 统一事件出口：任务终结时清理本地任务记录并卸载预挂载的镜像 */
function onAnyEvent(e) {
  if (e?.jobId && (e.kind === 'done' || e.kind === 'error' || e.kind === 'cancelled')) {
    localJobs.delete(e.jobId);
    const m = pendingMounts.get(e.jobId);
    if (m) {
      pendingMounts.delete(e.jobId);
      detachPreMounted(m);
    }
  }
  broadcast(e);
}

app.setName('Diter');

if (elevation.isHelper()) {
  /* ---------- 提权助手：headless，无窗口，只跑 socket server ---------- */
  app.whenReady().then(() => {
    if (app.dock) app.dock.hide();
    helperServer.startServer();
  });
  app.on('window-all-closed', () => {});
} else {
  /* ---------- 主窗口：普通用户态 UI ---------- */
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });

    app.whenReady().then(() => {
      nativeTheme.themeSource = 'light';
      createWindow();
      helper.setEventHandler(onAnyEvent);
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });

    app.on('before-quit', () => {
      // 退出前清掉预挂载的镜像
      for (const m of pendingMounts.values()) detachPreMounted(m);
      pendingMounts.clear();
      helper.shutdown();
    });
  }
}

/* ----------------------------- IPC ----------------------------- */

ipcMain.handle('diter:boot', async () => ({
  version: pkg.version,
  platform: process.platform,
  arch: process.arch,
  elevated: (await elevation.isElevated()) || (await helper.ping()),
  elevatedByArg: elevation.isHelper(),
  electron: process.versions.electron,
}));

ipcMain.handle('diter:devices', async (_e, opts = {}) => {
  return devices.list({ imageSize: opts.imageSize || 0, allowUnknownBus: !!opts.allowUnknownBus });
});

ipcMain.handle('diter:pick-image', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '选择系统镜像',
    properties: ['openFile'],
    filters: [
      { name: '系统镜像', extensions: ['iso', 'img', 'dmg', 'cdr', 'app'] },
      { name: '全部文件', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('diter:probe', async (_e, imagePath) => {
  try {
    const st = fs.statSync(imagePath);
    if (!st.isFile()) {
      // .app 安装器
      return {
        ok: true,
        path: imagePath,
        fileName: path.basename(imagePath),
        size: dirSize(imagePath),
        label: path.basename(imagePath).replace(/\.app$/, ''),
        kind: 'app',
        structures: {},
        target: { os: 'macos', osLabel: 'macOS', version: 'macOS 安装器', arch: 'universal', archLabel: '通用', confidence: 0.98, evidence: ['Install macOS.app'] },
        hasUefiBoot: true,
        hasBiosBoot: false,
        recommended: { scheme: 'gpt', filesystem: 'hfs+', bootMode: 'mac', note: '调用安装器自带 createinstallmedia' },
      };
    }
    return probeImage(imagePath);
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('diter:start', async (_e, payload) => {
  const hasHelper = await helper.ping();
  const isWindowsImage = payload?.imageInfo?.target?.os === 'windows';

  // 预挂载：root 助手无 GUI 会话，无法 hdiutil attach；需要挂载的镜像在主进程先挂好
  let pre = null;
  if (hasHelper && needsMount(payload.imagePath, payload.imageInfo)) {
    try {
      pre = await preMount(payload.imagePath);
    } catch (err) {
      throw new Error('无法读取镜像：' + err.message);
    }
  }

  /* Windows 镜像 → 混合执行：
   * macOS 对可移动宗卷有 TCC 隐私保护，root 后台进程无法弹授权框、文件级写入会被
   * 静默拒绝（EPERM）。因此：分区/格式化（磁盘管理操作）委托 root 助手，
   * 文件拷贝（读 ISO + 写 U 盘挂载点）留在主进程用户会话 —— TCC 需要时能正常弹框。 */
  if (hasHelper && isWindowsImage) {
    let started;
    try {
      started = await writer.start({
        ...payload,
        preMounted: pre,
        rootOps: { format: (args) => helper.format(args) },
        emit: onAnyEvent,
      });
    } catch (e) {
      if (pre) detachPreMounted(pre);
      throw e;
    }
    if (started?.jobId) {
      localJobs.add(started.jobId);
      if (pre) pendingMounts.set(started.jobId, pre);
    }
    return started;
  }

  // 其余镜像：整段委托给 root 助手执行
  if (hasHelper) {
    let started;
    try {
      started = await helper.start(pre ? { ...payload, preMounted: pre } : payload);
    } catch (e) {
      if (pre) detachPreMounted(pre);
      throw e;
    }
    if (pre && started?.jobId) pendingMounts.set(started.jobId, pre);
    return started;
  }

  // 无助手（未提权）：本地执行（无权限的操作会失败并给出明确提示）
  return writer.start({ ...payload, emit: onAnyEvent });
});

ipcMain.handle('diter:cancel', async (_e, jobId) => {
  // 本地（混合模式）任务在主进程的 writer 里，不走助手
  if (localJobs.has(jobId)) {
    return writer.cancel(jobId);
  }
  if (await helper.ping()) {
    return helper.cancel(jobId);
  }
  return writer.cancel(jobId);
});

ipcMain.handle('diter:eject', async (_e, deviceId) => {
  if (await helper.ping()) {
    return helper.eject(deviceId);
  }
  return writer.eject(deviceId);
});

ipcMain.handle('diter:elevate', async () => {
  // 若助手已在运行（例如上次授权残留），直接返回成功
  if (await helper.ping()) return { ok: true };

  // 发起提权（fire-and-forget），随后轮询确认助手就绪
  elevation.relaunchElevated();

  for (let i = 0; i < 120; i++) {
    if (await helper.ping()) return { ok: true };
    // osascript 已退出且报错（用户取消 / 启动失败）→ 立即回传原因
    const err = elevation.lastElevationError();
    if (err) return { ok: false, message: humanizeElevationError(err) };
    await new Promise((r) => setTimeout(r, 500));
  }
  // 超时：读取助手日志辅助排查
  const log = readHelperLog();
  return { ok: false, message: '授权超时，请重试' + (log ? `（${log}）` : '') };
});

ipcMain.handle('diter:assert-writable', async (_e, { device, imageSize, allowUnknownBus }) => {
  try {
    safety.assertWritable(device, imageSize, { allowUnknownBus });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message, verdict: e.verdict };
  }
});
ipcMain.handle('diter:reveal', async (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('diter:open-external', async (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

function dirSize(dir) {
  let total = 0;
  try {
    for (const n of fs.readdirSync(dir)) {
      const full = path.join(dir, n);
      const st = fs.statSync(full);
      total += st.isDirectory() ? dirSize(full) : st.size;
    }
  } catch {}
  return total;
}

/** 把 osascript 的报错翻译成可读中文 */
function humanizeElevationError(raw) {
  const s = String(raw || '');
  if (/-128\b|user cancel|canceled|cancelled/i.test(s)) return '已取消授权';
  if (/not authorized|denied|permission/i.test(s)) return '未获得管理员授权，请确认输入了正确的管理员密码';
  if (/execution error|error -/i.test(s)) return s.replace(/\s+/g, ' ').slice(0, 160);
  return s.slice(0, 160) || '授权失败，请重试';
}

/** 读取助手启动日志（诊断用） */
function readHelperLog() {
  try {
    const s = fs.readFileSync('/tmp/diter-helper.log', 'utf8').trim();
    return s.split('\n').pop() || '';
  } catch {
    return '';
  }
}

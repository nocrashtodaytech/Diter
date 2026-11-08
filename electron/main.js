'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const devices = require('./core/devices');
const safety = require('./core/safety');
const { probeImage } = require('./core/detect');
const writer = require('./core/writer');
const elevation = require('./core/elevation');
const helperServer = require('./core/helper-server');
const helper = require('./core/helper-client');
const updater = require('./core/updater');
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

/* ----------------------------- 菜单 / 语言 ----------------------------- */

const configPath = () => path.join(app.getPath('userData'), 'config.json');

const LANGS = ['zh', 'zh-TW', 'en', 'ko', 'ru', 'ar'];
const APPEARANCES = ['light', 'dark', 'system'];

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return c && typeof c === 'object' ? c : {};
  } catch {}
  return {};
}

function saveConfig(patch) {
  const c = loadConfig();
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete c[k];
    else c[k] = v;
  }
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(c, null, 2));
  } catch {}
}

function loadLanguage() {
  const c = loadConfig();
  return LANGS.includes(c.language) ? c.language : 'zh';
}

function loadAppearance() {
  const c = loadConfig();
  return APPEARANCES.includes(c.appearance) ? c.appearance : 'system';
}

function sendToWin(channel) {
  if (win && !win.isDestroyed()) win.webContents.send(channel);
}

/* ----------------------------- 菜单标签多语言 ----------------------------- */
const MENU = {
  aboutDiter: { zh: '关于 Diter', 'zh-TW': '關於 Diter', en: 'About Diter', ko: 'Diter 정보', ru: 'О Diter', ar: 'حول Diter' },
  checkUpdate: { zh: '检查更新…', 'zh-TW': '檢查更新…', en: 'Check for Updates…', ko: '업데이트 확인…', ru: 'Проверить обновления…', ar: 'التحقق من التحديثات…' },
  settings: { zh: '设置…', 'zh-TW': '設定…', en: 'Settings…', ko: '설정…', ru: 'Настройки…', ar: 'الإعدادات…' },
  hideDiter: { zh: '隐藏 Diter', 'zh-TW': '隱藏 Diter', en: 'Hide Diter', ko: 'Diter 숨기기', ru: 'Скрыть Diter', ar: 'إخفاء Diter' },
  hideOthers: { zh: '隐藏其他', 'zh-TW': '隱藏其他', en: 'Hide Others', ko: '기타 숨기기', ru: 'Скрыть остальные', ar: 'إخفاء الآخرين' },
  showAll: { zh: '全部显示', 'zh-TW': '全部顯示', en: 'Show All', ko: '모두 보기', ru: 'Показать все', ar: 'إظهار الكل' },
  quitDiter: { zh: '退出 Diter', 'zh-TW': '退出 Diter', en: 'Quit Diter', ko: 'Diter 종료', ru: 'Выйти из Diter', ar: 'الخروج من Diter' },
  file: { zh: '文件', 'zh-TW': '檔案', en: 'File', ko: '파일', ru: 'Файл', ar: 'ملف' },
  quit: { zh: '退出', 'zh-TW': '退出', en: 'Exit', ko: '종료', ru: 'Выход', ar: 'خروج' },
  help: { zh: '帮助', 'zh-TW': '說明', en: 'Help', ko: '도움말', ru: 'Справка', ar: 'تعليمات' },
  history: { zh: '历史记录…', 'zh-TW': '歷史記錄…', en: 'History…', ko: '기록…', ru: 'История…', ar: 'السجل…' },
};

const M = (key, lang) => (MENU[key] && (MENU[key][lang] || MENU[key].en)) || key;

/** 应用菜单：macOS 在系统菜单栏，Windows/Linux 在窗口顶部菜单栏 */
function buildMenu(lang) {
  const isMac = process.platform === 'darwin';
  const openSettings = () => sendToWin('diter:open-settings');
  const openAbout = () => sendToWin('diter:open-about');
  const openUpdate = () => sendToWin('diter:open-update');
  const openHistory = () => sendToWin('diter:open-history');

  const template = [
    ...(isMac
      ? [
          {
            label: 'Diter',
            submenu: [
              { label: M('aboutDiter', lang), click: openAbout },
              { label: M('checkUpdate', lang), click: openUpdate },
              { type: 'separator' },
              { label: M('settings', lang), accelerator: 'CmdOrCtrl+,', click: openSettings },
              { label: M('history', lang), click: openHistory },
              { type: 'separator' },
              { role: 'hide', label: M('hideDiter', lang) },
              { role: 'hideOthers', label: M('hideOthers', lang) },
              { role: 'unhide', label: M('showAll', lang) },
              { type: 'separator' },
              { role: 'quit', label: M('quitDiter', lang) },
            ],
          },
        ]
      : [
          {
            label: M('file', lang),
            submenu: [
              { label: M('settings', lang), accelerator: 'CmdOrCtrl+,', click: openSettings },
              { label: M('history', lang), click: openHistory },
              { type: 'separator' },
              { role: 'quit', label: M('quit', lang) },
            ],
          },
        ]),
    {
      label: M('help', lang),
      submenu: [
        { label: M('aboutDiter', lang), click: openAbout },
        { label: M('checkUpdate', lang), click: openUpdate },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 本地（主进程内）执行的写入任务 id —— cancel 时要区分走 writer 还是 helper
const localJobs = new Set();

/* ----------------------------- 任务历史 / 日志 ----------------------------- */

const jobLogs = new Map(); // jobId -> { lines: string[] }
const HISTORY_FILE = () => path.join(app.getPath('userData'), 'history.json');
const LOGS_DIR = () => path.join(app.getPath('userData'), 'logs');

function logLine(e) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  switch (e.kind) {
    case 'phase':
      return `${ts} [${e.phase || '阶段'}] ${e.message || ''}`;
    case 'progress':
      return `${ts} [${e.phase || '进度'}] ${Math.round((e.pct || 0) * 100)}% ${e.message || ''}`;
    case 'log':
      return `${ts} [信息] ${e.message || ''}`;
    case 'error':
      return `${ts} [错误] ${e.error?.code || 'UNKNOWN'} ${e.error?.message || ''}`;
    case 'done':
      return `${ts} [完成]`;
    case 'cancelled':
      return `${ts} [已取消]`;
    default:
      return '';
  }
}

function typeFromResult(e) {
  const m = e?.result?.mode;
  if (m === 'erase') return 'erase';
  if (m === 'backup') return 'backup';
  return 'write';
}

/** 任务终结时把完整日志落盘，并写入历史记录（最多保留 50 条） */
function saveHistory(e, rec) {
  try {
    fs.mkdirSync(LOGS_DIR(), { recursive: true });
    const logFile = path.join(LOGS_DIR(), `${Date.now()}-${(e.jobId || 'x').slice(0, 8)}.log`);
    fs.writeFileSync(logFile, rec.lines.join('\n') + '\n');

    let hist = [];
    try {
      hist = JSON.parse(fs.readFileSync(HISTORY_FILE(), 'utf8'));
      if (!Array.isArray(hist)) hist = [];
    } catch {}
    hist.unshift({
      id: e.jobId,
      time: Date.now(),
      type: typeFromResult(e),
      result: e.kind === 'done' ? 'success' : e.kind === 'cancelled' ? 'cancelled' : 'error',
      error: e.kind === 'error' ? e.error?.message || e.error?.code || '' : '',
      logFile,
    });
    fs.writeFileSync(HISTORY_FILE(), JSON.stringify(hist.slice(0, 50), null, 2));
  } catch {}
}

/** 统一事件出口：收集日志、任务终结时清理本地任务记录并卸载预挂载的镜像 */
function onAnyEvent(e) {
  if (e?.jobId) {
    let rec = jobLogs.get(e.jobId);
    if (!rec) {
      rec = { lines: [] };
      jobLogs.set(e.jobId, rec);
    }
    const line = logLine(e);
    if (line) rec.lines.push(line);
    if (e.kind === 'done' || e.kind === 'error' || e.kind === 'cancelled') {
      saveHistory(e, rec);
      jobLogs.delete(e.jobId);
    }
  }
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
      nativeTheme.themeSource = loadAppearance();
      buildMenu(loadLanguage());
      createWindow();
      helper.setEventHandler(onAnyEvent);

      // 启动后延迟自动检查更新：有新版本则通知前端弹出更新面板
      setTimeout(() => {
        updater
          .check()
          .then((info) => {
            if (info && info.hasUpdate && win && !win.isDestroyed()) {
              win.webContents.send('diter:update-available', info);
            }
          })
          .catch(() => {});
      }, 8000);

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
  language: loadLanguage(),
  appearance: loadAppearance(),
}));

ipcMain.handle('diter:get-language', () => loadLanguage());

ipcMain.handle('diter:set-language', (_e, lang, opts) => {
  const l = LANGS.includes(lang) ? lang : 'zh';
  const asDefault = !!(opts && opts.default === true);
  // 只有勾选「设为默认语言」才持久化；否则清除已存语言，下次启动回默认中文
  saveConfig({ language: asDefault ? l : undefined });
  buildMenu(l);
  return l;
});

ipcMain.handle('diter:get-appearance', () => loadAppearance());

ipcMain.handle('diter:set-appearance', (_e, a) => {
  const v = APPEARANCES.includes(a) ? a : 'system';
  nativeTheme.themeSource = v;
  saveConfig({ appearance: v });
  return v;
});

ipcMain.handle('diter:get-settings', () => {
  const c = loadConfig();
  return {
    appearance: loadAppearance(),
    defaultLanguage: typeof c.language === 'string' && LANGS.includes(c.language),
  };
});

ipcMain.handle('diter:devices', async (_e, opts = {}) => {
  return devices.list({ imageSize: opts.imageSize || 0, allowUnknownBus: !!opts.allowUnknownBus });
});

ipcMain.handle('diter:pick-image', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: '选择系统镜像',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '系统镜像', extensions: ['iso', 'img', 'dmg', 'cdr', 'app', 'raw', 'bin'] },
      { name: '全部文件', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return [];
  return res.filePaths;
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

/* ----------------------------- 磁盘工具：擦除 / 备份 ----------------------------- */

ipcMain.handle('diter:pick-save', async (_e, { defaultName } = {}) => {
  const res = await dialog.showSaveDialog(win, {
    title: '保存磁盘镜像',
    defaultPath: defaultName || 'disk-backup.img',
    filters: [
      { name: '磁盘镜像', extensions: ['img', 'raw', 'bin'] },
      { name: '全部文件', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePath) return null;
  return res.filePath;
});

ipcMain.handle('diter:erase', async (_e, payload) => {
  if (await helper.ping()) {
    return helper.erase(payload);
  }
  const started = await writer.erase({ ...payload, emit: onAnyEvent });
  if (started?.jobId) localJobs.add(started.jobId);
  return started;
});

ipcMain.handle('diter:backup', async (_e, payload) => {
  if (await helper.ping()) {
    return helper.backup(payload);
  }
  const started = await writer.backup({ ...payload, emit: onAnyEvent });
  if (started?.jobId) localJobs.add(started.jobId);
  return started;
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
ipcMain.handle('diter:get-history', () => {
  try {
    const hist = JSON.parse(fs.readFileSync(HISTORY_FILE(), 'utf8'));
    return Array.isArray(hist) ? hist : [];
  } catch {
    return [];
  }
});
ipcMain.handle('diter:open-external', async (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

/* ----------------------------- 检查更新 ----------------------------- */

ipcMain.handle('diter:check-update', async () => {
  try {
    return await updater.check();
  } catch (e) {
    return { ok: false, hasUpdate: false, error: e.message };
  }
});

ipcMain.handle('diter:download-update', async (_e, asset) => {
  if (!asset || !asset.url) return { ok: false, error: '未找到可下载的安装包' };
  // 后台静默下载 + 安装：不阻塞前端，用户可关闭更新面板继续工作
  (async () => {
    try {
      const r = await updater.downloadAndInstall(asset, (p) => {
        if (win && !win.isDestroyed()) win.webContents.send('diter:update-progress', p);
      });
      if (win && !win.isDestroyed()) win.webContents.send('diter:update-done', r);
      if (r.mode === 'restart') {
        // macOS：已复制到 /Applications，弹系统对话框提示重启（可稍后）
        const res = await dialog.showMessageBox(win, {
          type: 'info',
          title: '更新已就绪',
          message: '新版本已安装完成，重启 Diter 后生效。',
          detail: '你可以立即重启，或继续使用当前版本，下次启动即为新版本。',
          buttons: ['立即重启', '稍后'],
          defaultId: 0,
          cancelId: 1,
        });
        if (res.response === 0) {
          app.relaunch();
          app.quit();
        }
      } else if (r.mode === 'quit') {
        // Windows：新进程已启动，旧进程直接退出
        app.quit();
      }
    } catch (e) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('diter:update-error', { message: e.message });
      }
    }
  })();
  return { ok: true, started: true };
});

ipcMain.handle('diter:finish-update', (_e, mode) => {
  setTimeout(() => {
    if (mode === 'restart') app.relaunch();
    app.quit();
  }, 900);
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

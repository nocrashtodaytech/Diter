'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 尽早标记平台，避免 macOS 毛玻璃下首帧出现实色背景闪烁
if (process.platform === 'darwin') {
  const mark = () => document.body && document.body.classList.add('is-mac');
  if (document.body) mark();
  else document.addEventListener('DOMContentLoaded', mark);
}

const listeners = new Set();
ipcRenderer.on('diter:event', (_e, payload) => {
  listeners.forEach((fn) => {
    try {
      fn(payload);
    } catch {}
  });
});

// 菜单触发打开设置/关于/更新/历史面板
const panelListeners = { settings: new Set(), about: new Set(), update: new Set(), history: new Set() };
ipcRenderer.on('diter:open-settings', () => panelListeners.settings.forEach((fn) => { try { fn(); } catch {} }));
ipcRenderer.on('diter:open-about', () => panelListeners.about.forEach((fn) => { try { fn(); } catch {} }));
ipcRenderer.on('diter:open-update', () => panelListeners.update.forEach((fn) => { try { fn(); } catch {} }));
ipcRenderer.on('diter:open-history', () => panelListeners.history.forEach((fn) => { try { fn(); } catch {} }));

// 更新进度事件
const updateListeners = new Set();
ipcRenderer.on('diter:update-progress', (_e, p) => {
  updateListeners.forEach((fn) => { try { fn(p); } catch {} });
});

// 启动自动检查发现新版本
const updateAvailableListeners = new Set();
ipcRenderer.on('diter:update-available', (_e, info) => {
  updateAvailableListeners.forEach((fn) => { try { fn(info); } catch {} });
});

// 后台下载安装完成 / 失败
const updateDoneListeners = new Set();
ipcRenderer.on('diter:update-done', (_e, r) => {
  updateDoneListeners.forEach((fn) => { try { fn(r); } catch {} });
});
const updateErrorListeners = new Set();
ipcRenderer.on('diter:update-error', (_e, err) => {
  updateErrorListeners.forEach((fn) => { try { fn(err); } catch {} });
});

contextBridge.exposeInMainWorld('diter', {
  boot: () => ipcRenderer.invoke('diter:boot'),
  listDevices: (opts) => ipcRenderer.invoke('diter:devices', opts),
  pickImage: () => ipcRenderer.invoke('diter:pick-image'),
  probeImage: (p) => ipcRenderer.invoke('diter:probe', p),
  start: (payload) => ipcRenderer.invoke('diter:start', payload),
  cancel: (jobId) => ipcRenderer.invoke('diter:cancel', jobId),
  eject: (id) => ipcRenderer.invoke('diter:eject', id),
  erase: (payload) => ipcRenderer.invoke('diter:erase', payload),
  backup: (payload) => ipcRenderer.invoke('diter:backup', payload),
  pickSave: (opts) => ipcRenderer.invoke('diter:pick-save', opts),
  getHistory: () => ipcRenderer.invoke('diter:get-history'),
  requestElevation: () => ipcRenderer.invoke('diter:elevate'),
  assertWritable: (p) => ipcRenderer.invoke('diter:assert-writable', p),
  reveal: (p) => ipcRenderer.invoke('diter:reveal', p),
  openExternal: (url) => ipcRenderer.invoke('diter:open-external', url),
  getLanguage: () => ipcRenderer.invoke('diter:get-language'),
  setLanguage: (lang, opts) => ipcRenderer.invoke('diter:set-language', lang, opts),
  getAppearance: () => ipcRenderer.invoke('diter:get-appearance'),
  setAppearance: (a) => ipcRenderer.invoke('diter:set-appearance', a),
  getSettings: () => ipcRenderer.invoke('diter:get-settings'),
  checkUpdate: () => ipcRenderer.invoke('diter:check-update'),
  downloadUpdate: (asset) => ipcRenderer.invoke('diter:download-update', asset),
  finishUpdate: (mode) => ipcRenderer.invoke('diter:finish-update', mode),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  onEvent: (cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  onOpenSettings: (cb) => {
    panelListeners.settings.add(cb);
    return () => panelListeners.settings.delete(cb);
  },
  onOpenAbout: (cb) => {
    panelListeners.about.add(cb);
    return () => panelListeners.about.delete(cb);
  },
  onOpenUpdate: (cb) => {
    panelListeners.update.add(cb);
    return () => panelListeners.update.delete(cb);
  },
  onOpenHistory: (cb) => {
    panelListeners.history.add(cb);
    return () => panelListeners.history.delete(cb);
  },
  onUpdateProgress: (cb) => {
    updateListeners.add(cb);
    return () => updateListeners.delete(cb);
  },
  onUpdateAvailable: (cb) => {
    updateAvailableListeners.add(cb);
    return () => updateAvailableListeners.delete(cb);
  },
  onUpdateDone: (cb) => {
    updateDoneListeners.add(cb);
    return () => updateDoneListeners.delete(cb);
  },
  onUpdateError: (cb) => {
    updateErrorListeners.add(cb);
    return () => updateErrorListeners.delete(cb);
  },
  isDesktop: true,
});

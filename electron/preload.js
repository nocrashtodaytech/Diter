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

// 菜单触发打开设置/关于面板
const panelListeners = { settings: new Set(), about: new Set() };
ipcRenderer.on('diter:open-settings', () => panelListeners.settings.forEach((fn) => { try { fn(); } catch {} }));
ipcRenderer.on('diter:open-about', () => panelListeners.about.forEach((fn) => { try { fn(); } catch {} }));

contextBridge.exposeInMainWorld('diter', {
  boot: () => ipcRenderer.invoke('diter:boot'),
  listDevices: (opts) => ipcRenderer.invoke('diter:devices', opts),
  pickImage: () => ipcRenderer.invoke('diter:pick-image'),
  probeImage: (p) => ipcRenderer.invoke('diter:probe', p),
  start: (payload) => ipcRenderer.invoke('diter:start', payload),
  cancel: (jobId) => ipcRenderer.invoke('diter:cancel', jobId),
  eject: (id) => ipcRenderer.invoke('diter:eject', id),
  requestElevation: () => ipcRenderer.invoke('diter:elevate'),
  assertWritable: (p) => ipcRenderer.invoke('diter:assert-writable', p),
  reveal: (p) => ipcRenderer.invoke('diter:reveal', p),
  openExternal: (url) => ipcRenderer.invoke('diter:open-external', url),
  getLanguage: () => ipcRenderer.invoke('diter:get-language'),
  setLanguage: (lang) => ipcRenderer.invoke('diter:set-language', lang),
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
  isDesktop: true,
});

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
  isDesktop: true,
});

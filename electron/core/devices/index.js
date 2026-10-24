'use strict';
/**
 * 设备枚举统一入口：按平台分发，并把安全判定附加到每台设备上。
 */
const safety = require('../safety');

const IMPL = {
  darwin: () => require('./darwin'),
  win32: () => require('./win32'),
  linux: () => require('./linux'),
};

function impl() {
  const f = IMPL[process.platform];
  if (!f) throw new Error(`不支持的平台：${process.platform}`);
  return f();
}

/**
 * @param {{imageSize?:number, allowUnknownBus?:boolean}} opts
 */
async function list(opts = {}) {
  const mod = impl();
  let res;
  try {
    res = await mod.list(opts);
  } catch (e) {
    return { ok: false, error: e.message, devices: [], platform: process.platform };
  }

  const devices = (res.devices || []).map((d) => {
    const verdict = safety.evaluate(d, opts.imageSize || 0, opts);
    return {
      ...d,
      verdict,
      // UI 只读这两个字段，不自行推断安全结论
      selectable: verdict.level !== 'blocked',
      selectableReason: verdict.title,
    };
  });

  // 排序：可写设备置顶，其次容量升序；被锁定的排在后面
  devices.sort((a, b) => {
    if (a.selectable !== b.selectable) return a.selectable ? -1 : 1;
    if (a.selectable) return a.size - b.size;
    return a.size - b.size;
  });

  return {
    ok: res.ok !== false,
    error: res.error,
    platform: process.platform,
    devices,
    safeCount: devices.filter((d) => d.selectable).length,
    lockedCount: devices.filter((d) => !d.selectable).length,
  };
}

const unmount = (id) => impl().unmount(id);
const eject = (id) => impl().eject(id);
const partition = (id, plan) => impl().partition(id, plan);

module.exports = { list, unmount, eject, partition, impl, platform: process.platform };

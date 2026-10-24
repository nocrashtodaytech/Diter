'use strict';
/**
 * 安全层：唯一有权判定"能不能写"的模块。
 * 平台探测层只负责罗列事实（是否内建、是否可移动、是否系统盘），
 * 判定规则全部集中在这里 —— 便于审计、单元测试，且不可被 UI 绕过。
 */

const BLOCK_CODES = {
  SYSTEM: 'SYSTEM_DISK',
  INTERNAL: 'INTERNAL_DISK',
  VIRTUAL: 'VIRTUAL_DISK',
  READONLY: 'READ_ONLY',
  TOO_SMALL: 'TOO_SMALL',
  UNKNOWN_BUS: 'UNKNOWN_BUS',
};

/**
 * @param {object} device 平台探测出的设备事实
 * @param {number} imageSize 镜像字节数
 * @param {object} opts { allowUnknownBus?: boolean }
 * @returns {{level:'ok'|'warn'|'blocked', code:string|null, title:string, reason:string, advice:string}}
 */
function evaluate(device, imageSize, opts = {}) {
  const d = device;

  if (d.isSystemDisk) {
    return {
      level: 'blocked',
      code: BLOCK_CODES.SYSTEM,
      title: '系统盘 · 已锁定',
      reason: '该磁盘承载当前正在运行的操作系统，写入会立即导致系统崩溃且数据无法恢复。',
      advice: '请插入 U 盘或移动硬盘后重试。',
    };
  }

  if (d.virtual) {
    return {
      level: 'blocked',
      code: BLOCK_CODES.VIRTUAL,
      title: '虚拟磁盘 · 已锁定',
      reason: '这是一个磁盘映像或 APFS 容器等虚拟设备，不是真实物理介质。',
      advice: '请选择真实的 U 盘设备。',
    };
  }

  if (d.internal) {
    return {
      level: 'blocked',
      code: BLOCK_CODES.INTERNAL,
      title: '内建磁盘 · 已锁定',
      reason: `该磁盘通过 ${d.bus || '内建总线'} 连接，属于机器内部存储，Diter 永不写入。`,
      advice: '如需写入外置硬盘，请使用 USB 接口的移动硬盘。',
    };
  }

  if (d.busKind === 'unknown' && !opts.allowUnknownBus) {
    return {
      level: 'blocked',
      code: BLOCK_CODES.UNKNOWN_BUS,
      title: '接口未知 · 已锁定',
      reason: '无法确认该设备是外部可移动介质，出于安全考虑默认拒绝写入。',
      advice: '可在"高级设置"中显式允许未知总线设备。',
    };
  }

  if (!d.writable) {
    return {
      level: 'blocked',
      code: BLOCK_CODES.READONLY,
      title: '只读介质 · 已锁定',
      reason: '设备或写保护开关处于只读状态。',
      advice: '检查 U 盘上的物理写保护开关，或更换设备。',
    };
  }

  if (imageSize > 0) {
    const need = imageSize + 16 * 1024 * 1024;
    if (d.size < need) {
      return {
        level: 'blocked',
        code: BLOCK_CODES.TOO_SMALL,
        title: '容量不足 · 已锁定',
        reason: `镜像需要 ${fmt(imageSize)}，该设备仅 ${fmt(d.size)}。`,
        advice: '请更换容量更大的 U 盘（建议 ≥ 8 GB）。',
      };
    }
    if (d.size < imageSize * 1.12) {
      return {
        level: 'warn',
        code: null,
        title: '容量偏紧',
        reason: `可用空间 ${fmt(d.size)} 仅略大于镜像 ${fmt(imageSize)}。`,
        advice: '写入可以继续，但没有余量。',
      };
    }
  }

  return {
    level: 'ok',
    code: null,
    title: '可安全写入',
    reason: '外部可移动介质，且不承载任何系统卷。',
    advice: '',
  };
}

function fmt(bytes) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), u.length - 1);
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/**
 * 写入前最后一道闸门。写入器必须调用，并在调用前重新枚举一次设备，
 * 确认设备依然存在、依然是同一块可移动介质（防止用户中途换了盘）。
 */
function assertWritable(device, imageSize, opts = {}) {
  const v = evaluate(device, imageSize, opts);
  if (v.level === 'blocked') {
    const err = new Error(`写入被安全层拒绝：${v.title} — ${v.reason}`);
    err.code = 'SAFETY_BLOCKED';
    err.verdict = v;
    throw err;
  }
  return v;
}

/** 重新枚举并核对设备身份，返回最新事实；设备消失则抛错 */
async function revalidate(devicesModule, deviceId, expected) {
  const res = await devicesModule.list();
  const fresh = (res.devices || []).find((d) => d.id === deviceId);
  if (!fresh) {
    const err = new Error('目标设备已消失，请重新插拔后重试。');
    err.code = 'DEVICE_GONE';
    throw err;
  }
  if (expected && expected.size && Math.abs(fresh.size - expected.size) > 1024 * 1024 && fresh.size > 0) {
    const err = new Error('检测到的设备容量与选择时不一致，可能已更换磁盘。为安全起见已中止。');
    err.code = 'DEVICE_CHANGED';
    throw err;
  }
  return fresh;
}

module.exports = { evaluate, assertWritable, revalidate, BLOCK_CODES };

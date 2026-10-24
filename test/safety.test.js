'use strict';
/**
 * 安全层单元测试：本文件是"灾难防护"的验收标准。
 * 运行：node test/safety.test.js
 */
const assert = require('assert');
const { evaluate, assertWritable } = require('../electron/core/safety');

const GB = 1024 * 1024 * 1024;
const usb = (over = {}) => ({
  id: 'disk9',
  name: 'SanDisk Ultra',
  size: 32 * GB,
  busKind: 'usb',
  bus: 'USB',
  removable: true,
  internal: false,
  virtual: false,
  isSystemDisk: false,
  writable: true,
  ...over,
});

const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test('普通 U 盘 + 5GB 镜像 → 允许', () => {
  const v = evaluate(usb(), 5 * GB);
  assert.strictEqual(v.level, 'ok');
});

test('承载系统卷的磁盘 → 必须拦截', () => {
  const v = evaluate(usb({ isSystemDisk: true }), 5 * GB);
  assert.strictEqual(v.level, 'blocked');
  assert.strictEqual(v.code, 'SYSTEM_DISK');
});

test('内建 NVMe 即使可移动标记也拦截', () => {
  const v = evaluate(usb({ busKind: 'internal', bus: 'NVMe', removable: true, internal: true }), 5 * GB);
  assert.strictEqual(v.level, 'blocked');
  assert.strictEqual(v.code, 'INTERNAL_DISK');
});

test('虚拟磁盘 / 磁盘映像拦截', () => {
  const v = evaluate(usb({ virtual: true }), 5 * GB);
  assert.strictEqual(v.code, 'VIRTUAL_DISK');
});

test('容量不足拦截（宁可拦错，不可写错）', () => {
  const v = evaluate(usb({ size: 4 * GB }), 5 * GB);
  assert.strictEqual(v.code, 'TOO_SMALL');
});

test('容量临界 → 允许但告警', () => {
  const v = evaluate(usb({ size: 5.2 * GB }), 5 * GB);
  assert.strictEqual(v.level, 'warn');
});

test('未知总线默认拦截，显式允许后放行', () => {
  const d = usb({ busKind: 'unknown', bus: '未知' });
  assert.strictEqual(evaluate(d, 5 * GB).code, 'UNKNOWN_BUS');
  assert.strictEqual(evaluate(d, 5 * GB, { allowUnknownBus: true }).level, 'ok');
});

test('只读介质拦截', () => {
  assert.strictEqual(evaluate(usb({ writable: false }), 5 * GB).code, 'READ_ONLY');
});

test('assertWritable 对系统盘必须抛错', () => {
  assert.throws(() => assertWritable(usb({ isSystemDisk: true }), 5 * GB), /安全层拒绝/);
});

test('排查顺序：系统盘优先于容量不足', () => {
  const v = evaluate(usb({ isSystemDisk: true, size: 1 * GB }), 5 * GB);
  assert.strictEqual(v.code, 'SYSTEM_DISK');
});

let pass = 0;
for (const c of cases) {
  try {
    c.fn();
    pass++;
    console.log(`  ✓ ${c.name}`);
  } catch (e) {
    console.log(`  ✗ ${c.name}\n    ${e.message}`);
    process.exitCode = 1;
  }
}
console.log(`\n${pass}/${cases.length} 通过`);

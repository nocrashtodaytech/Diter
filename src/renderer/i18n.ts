import { useEffect, useReducer } from 'react';

export type Lang = 'zh' | 'en';

const zh = {
  // 顶栏
  brandSub: '跨平台启动盘写入工具',
  previewMode: '界面预览模式',
  admin: '管理员权限',
  authorizing: '正在授权…',
  needAuth: '需要授权',
  // 主界面
  sectionImage: '系统镜像',
  clear: '清除',
  scope: '支持范围',
  sectionDevice: '目标设备',
  writableCount: '{a} 台可写 · {b} 台已锁定',
  scanning: '扫描中…',
  footerWarn: '目标设备将被完全清空，系统盘已在硬件层锁定，无法被选中',
  persistence: '持久化分区',
  verify: '写入后校验',
  startWrite: '开始写入',
  selectDevice: '选择目标设备',
  selectImage: '请先选择镜像',
  dropVeil: '松开以识别镜像',
  // 镜像面板
  detecting: '正在解析镜像…',
  dropTitle: '拖入系统镜像，或点击选择',
  detectingSub: '正在读取镜像头、识别系统版本与引导方式',
  dropSub: 'Windows 安装盘、macOS 安装器、任意 Linux 发行版 —— 拖进来即可，Diter 会自动识别版本与引导方式。',
  confidence: '识别度',
  change: '更换',
  targetOs: '目标系统',
  arch: '架构',
  imageSize: '镜像大小',
  boot: '引导',
  partition: '分区',
  filesystem: '文件系统',
  rawNote: '按镜像原始结构写入',
  preflight: '写入前预检',
  imageDetect: '镜像识别',
  capacity: '容量余量',
  bootCap: '引导能力',
  sysProtect: '系统盘防护',
  waitDevice: '等待选择目标设备',
  sysProtectOn: '已启用 · 系统盘与内建盘无法被选中',
  // 设备列表
  noDisk: '未检测到磁盘',
  insertUsb: '请插入 U 盘后重试。',
  clickSelect: '点击选择该设备',
  systemDisk: '系统盘',
  locked: '已锁定',
  tightCapacity: '容量偏紧',
  writable: '可写入',
  // 确认弹窗
  needAdmin: '需要管理员权限',
  needAdminDesc: '写入原始磁盘、修改分区表必须由管理员执行。点击「授权」后会弹出系统密码框，输入密码后当前窗口原地获得管理员权限，无需重启。',
  waitingAuth: '正在等待授权…',
  authorize: '授权',
  cancel: '取消',
  confirmWipe: '确认清空这台设备',
  confirmWipeDesc: '接下来对以下设备的操作是不可恢复的：全部分区将被删除，原有数据无法通过任何软件找回。',
  willWrite: '将写入',
  confirmCheck: '我确认该设备的全部数据将被清除，且这不是系统盘。',
  holdToWrite: '按住 1.5 秒开始写入',
  checkFirst: '请先勾选确认',
  // 写入/结果
  writeRate: '写入速率',
  sampling: '采样中…',
  peak: '峰值',
  writing: '正在写入',
  writeSpeed: '写入速度',
  remaining: '剩余时间',
  written: '已写入',
  targetDevice: '目标设备',
  noRemove: '写入过程中请勿拔出设备或关闭窗口',
  abort: '中止写入',
  done: '写入完成',
  bootable: '已可启动',
  elapsed: '耗时',
  avgSpeed: '平均速率',
  verification: '数据校验',
  match: '一致',
  mismatch: '不一致',
  notEnabled: '未启用',
  verifyFailed: '校验阶段发现差异。可能是写入过程中设备被拔出或存在坏块，建议重新写入。',
  again: '再写一个',
  eject: '安全弹出',
  writeFailed: '写入未完成',
  incomplete: '目标设备 {name}（{node}）可能已处于不完整状态，请重新写入后再使用。',
  retry: '返回重试',
  shaOk: 'SHA-256 校验通过',
  shaMismatch: '校验不一致',
  legacyBoot: 'Legacy BIOS 可启动',
  persistenceCreated: '已创建持久化分区',
  filesCount: '{n} 个文件',
  startFailed: '无法启动写入任务',
  unknownError: '未知错误',
  parseFailed: '无法解析该镜像',
  dropPathFailed: '无法读取「{name}」的磁盘路径，请改用「选择镜像」按钮',
  // 设置 / 关于
  settings: '设置',
  language: '语言',
  about: '关于',
  version: '版本',
  close: '关闭',
  aboutDesc: '跨平台 USB 启动盘写入工具',
};

const en: Record<keyof typeof zh, string> = {
  brandSub: 'Cross-platform boot drive creator',
  previewMode: 'UI preview mode',
  admin: 'Administrator',
  authorizing: 'Authorizing…',
  needAuth: 'Authorize',
  sectionImage: 'System image',
  clear: 'Clear',
  scope: 'Supported',
  sectionDevice: 'Target device',
  writableCount: '{a} writable · {b} locked',
  scanning: 'Scanning…',
  footerWarn: 'The target device will be fully wiped; the system disk is hardware-locked and cannot be selected',
  persistence: 'Persistence partition',
  verify: 'Verify after write',
  startWrite: 'Start writing',
  selectDevice: 'Select target device',
  selectImage: 'Select an image first',
  dropVeil: 'Release to detect image',
  detecting: 'Detecting image…',
  dropTitle: 'Drop a system image, or click to choose',
  detectingSub: 'Reading image header, detecting OS version and boot mode',
  dropSub: 'Windows installers, macOS installers, any Linux distro — just drop it in and Diter detects the version and boot mode automatically.',
  confidence: 'Confidence',
  change: 'Change',
  targetOs: 'Target OS',
  arch: 'Architecture',
  imageSize: 'Image size',
  boot: 'Boot',
  partition: 'Partition',
  filesystem: 'Filesystem',
  rawNote: 'Write in original image structure',
  preflight: 'Pre-write check',
  imageDetect: 'Image detection',
  capacity: 'Capacity margin',
  bootCap: 'Boot capability',
  sysProtect: 'System disk protection',
  waitDevice: 'Waiting for target device',
  sysProtectOn: 'Enabled · system and internal disks cannot be selected',
  noDisk: 'No disk detected',
  insertUsb: 'Insert a USB drive and retry.',
  clickSelect: 'Click to select this device',
  systemDisk: 'System disk',
  locked: 'Locked',
  tightCapacity: 'Tight capacity',
  writable: 'Writable',
  needAdmin: 'Administrator required',
  needAdminDesc: 'Writing raw disks and modifying partition tables must be done as administrator. Click "Authorize" to open the system password prompt; the current window gains admin rights in place, no restart needed.',
  waitingAuth: 'Waiting for authorization…',
  authorize: 'Authorize',
  cancel: 'Cancel',
  confirmWipe: 'Confirm wiping this device',
  confirmWipeDesc: 'The following operation on this device is irreversible: all partitions will be deleted and existing data cannot be recovered by any software.',
  willWrite: 'Will write',
  confirmCheck: 'I confirm all data on this device will be erased, and this is not the system disk.',
  holdToWrite: 'Hold 1.5s to start',
  checkFirst: 'Check the box first',
  writeRate: 'Write speed',
  sampling: 'Sampling…',
  peak: 'peak',
  writing: 'Writing',
  writeSpeed: 'Write speed',
  remaining: 'Remaining',
  written: 'Written',
  targetDevice: 'Target device',
  noRemove: 'Do not unplug the device or close the window while writing',
  abort: 'Abort',
  done: 'Write complete',
  bootable: 'is ready to boot',
  elapsed: 'Elapsed',
  avgSpeed: 'Average speed',
  verification: 'Verification',
  match: 'Match',
  mismatch: 'Mismatch',
  notEnabled: 'Disabled',
  verifyFailed: 'Differences found during verification. The device may have been unplugged or has bad blocks; consider rewriting.',
  again: 'Write another',
  eject: 'Eject safely',
  writeFailed: 'Write incomplete',
  incomplete: 'Target device {name} ({node}) may be in an incomplete state. Rewrite before use.',
  retry: 'Back and retry',
  shaOk: 'SHA-256 verified',
  shaMismatch: 'Verification mismatch',
  legacyBoot: 'Legacy BIOS bootable',
  persistenceCreated: 'Persistence partition created',
  filesCount: '{n} files',
  startFailed: 'Failed to start write task',
  unknownError: 'Unknown error',
  parseFailed: 'Cannot parse this image',
  dropPathFailed: 'Cannot read the disk path of "{name}", use the "Select image" button instead',
  settings: 'Settings',
  language: 'Language',
  about: 'About',
  version: 'Version',
  close: 'Close',
  aboutDesc: 'Cross-platform USB boot drive creator',
};

const dict = { zh, en } as const;
type Key = keyof typeof zh;

let lang: Lang = 'zh';
const subs = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang) {
  if (lang === l) return;
  lang = l;
  subs.forEach((f) => f());
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  let s: string = (dict[lang] as Record<Key, string>)[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  }
  return s;
}

/** 语言名称显示（用于语言选择器，始终显示各自语言的自称） */
export function langName(l: Lang): string {
  return l === 'zh' ? '简体中文' : 'English';
}

/** 关于页作者署名（按当前语言） */
export function authorName(l: Lang): string {
  return l === 'zh' ? '今天不宕机' : 'nocrashtodaytech';
}

/** React hook：订阅语言变化，切换后触发重渲染 */
export function useI18n() {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    subs.add(force);
    return () => {
      subs.delete(force);
    };
  }, []);
  return { t, lang, setLang, getLang };
}

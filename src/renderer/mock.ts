/**
 * 浏览器预览用的模拟后端。
 * 只在没有 Electron 桥接层时生效，用于评审界面与交互，不会触碰任何真实磁盘。
 */
import type { DiterApi, Device, ImageInfo, JobEvent } from './types';

const GB = 1024 * 1024 * 1024;

const mk = (o: Partial<Device>): Device => ({
  id: 'disk9',
  node: '/dev/disk9',
  rawNode: '/dev/rdisk9',
  name: '设备',
  size: 16 * GB,
  bus: 'USB',
  busKind: 'usb',
  removable: true,
  internal: false,
  virtual: false,
  isSystemDisk: false,
  mountPoints: [],
  volumes: [],
  partitionScheme: 'MBR',
  writable: true,
  detail: 'USB · 可移动',
  platform: 'darwin',
  verdict: { level: 'ok', code: null, title: '可安全写入', reason: '外部可移动介质，且不承载任何系统卷。', advice: '' },
  selectable: true,
  selectableReason: '可安全写入',
  ...o,
});

function devices(): Device[] {
  // 真实应用里，设备来自系统磁盘枚举（electron/core/devices），绝不虚构任何磁盘。
  // 预览模式同样不造假：返回空列表，展示「未检测到可写设备」的空状态。
  return [];
}

function probe(path: string): ImageInfo {
  const fileName = path.split(/[\\/]/).pop() || path;
  const low = fileName.toLowerCase();
  const isWin = /win|windows|_dv9|ccco/.test(low);
  const isMac = /mac|osx|os ?x|sonoma|ventura|sequoia|tahoe|monterey|big.?sur/.test(low);
  const os = isWin ? 'windows' : isMac ? 'macos' : 'linux';
  const size = isWin ? 5.7 * GB : isMac ? 14.2 * GB : 2.4 * GB;
  const base = {
    ok: true,
    path,
    fileName,
    size,
    label: isWin ? 'CCCOMA_X64FRE_ZH-CN_DV9' : isMac ? 'Install macOS' : 'Ubuntu 24.04.1 LTS amd64',
    kind: isMac ? 'hfs+' : 'iso9660',
    structures: { mbr: !isMac, gpt: isMac, hfs: isMac, apfs: false, isRaw: false },
    hasUefiBoot: true,
    hasBiosBoot: true,
    recommended: {
      scheme: isMac ? 'gpt' : 'mbr',
      filesystem: isMac ? 'hfs+' : isWin ? 'fat32' : 'raw',
      bootMode: 'hybrid',
      note: '',
    },
  } as ImageInfo;

  if (isWin) {
    base.target = {
      os: 'windows',
      osLabel: 'Windows',
      version: /11/.test(low) ? 'Windows 11 24H2' : 'Windows 10 22H2',
      arch: 'x64',
      archLabel: 'x86_64',
      confidence: 0.97,
      evidence: ['卷标 ' + base.label, 'ISO9660 文件系统', 'sources/install.wim', 'GPT 分区表'],
    };
    base.needsFat32Split = true;
    base.recommended.note = 'UEFI + Legacy 双引导，install.wim 超限时自动拆分';
  } else if (isMac) {
    base.target = {
      os: 'macos',
      osLabel: 'macOS',
      version: /tahoe|26/.test(low) ? 'macOS 26 Tahoe' : 'macOS 15 Sequoia',
      arch: 'arm64',
      archLabel: 'ARM64 / Apple Silicon',
      confidence: 0.92,
      evidence: ['HFS+ 卷头', 'BaseSystem.dmg（10.13+ 布局）', 'Packages 目录'],
    };
    base.recommended.note = 'GPT + 原生 macOS 分区，恢复后自动设置启动 bless';
  } else {
    base.target = {
      os: 'linux',
      osLabel: 'Ubuntu',
      version: 'Ubuntu 24.04.1 LTS',
      arch: 'x64',
      archLabel: 'x86_64',
      confidence: 0.95,
      evidence: ['卷标 Ubuntu 24.04.1 LTS amd64', 'ISO9660 文件系统', 'casper/ 目录', 'isolinux/ 目录'],
    };
    base.supportsPersistence = true;
    base.recommended.note = '混合 ISO 直接整盘写入，保留原有分区与引导';
  }
  return base;
}

export function createMock(): DiterApi {
  let listeners = new Set<(e: JobEvent) => void>();
  const emit = (e: JobEvent) => listeners.forEach((fn) => fn(e));
  let timer: any = null;

  return {
    isDesktop: false,
    async boot() {
      return { version: '0.1.0', platform: 'darwin', arch: 'arm64', elevated: true, elevatedByArg: false, electron: 'preview' };
    },
    async listDevices() {
      const list = devices();
      return {
        ok: true,
        platform: 'darwin',
        devices: list,
        safeCount: list.filter((d) => d.selectable).length,
        lockedCount: list.filter((d) => !d.selectable).length,
      };
    },
    async pickImage() {
      return '/Users/ryan/Downloads/Win11_24H2_Chinese_Simplified_x64.iso';
    },
    async probeImage(path: string) {
      return probe(path);
    },
    async start({ imageInfo, device, options }) {
      window.setTimeout(() => {
        let pct = 0;
        const total = imageInfo.size;
        const started = Date.now();
        let prevWritten = 0;
        let prevT = Date.now();
        let smooth = 0;
        const phaseSeq = [
          { until: 0.04, phase: '安全检查', msg: '复核目标设备身份' },
          { until: 0.1, phase: '分区', msg: '建立 FAT32 活动分区' },
          { until: 0.88, phase: '拷贝', msg: '复制安装文件' },
          { until: 0.93, phase: '引导', msg: '写入启动代码' },
          { until: 1, phase: '完成', msg: '刷新缓存' },
        ];
        timer = window.setInterval(() => {
          const inc = 0.006 + Math.random() * 0.012;
          pct = Math.min(1, pct + inc);
          const ph = phaseSeq.find((p) => pct <= p.until) || phaseSeq[phaseSeq.length - 1];
          const written = Math.min(total, Math.max(0, total * Math.max(0, (pct - 0.1) / 0.78)));
          const now = Date.now();
          const dt = Math.max(0.05, (now - prevT) / 1000);
          const inst = Math.max(0, (written - prevWritten) / dt);
          smooth = smooth > 0 ? smooth * 0.72 + inst * 0.28 : inst;
          prevWritten = written;
          prevT = now;
          const eta = smooth > 0 ? (total - written) / smooth : 0;

          if (pct >= 1) {
            window.clearInterval(timer);
            emit({
              kind: 'done',
              pct: 1,
              result: {
                mode: 'files',
                bytes: total,
                files: 1387,
                legacyBoot: true,
                elapsedSec: (Date.now() - started) / 1000,
                verification: options.verify ? { ok: true, srcHash: 'a3f9…', devHash: 'a3f9…' } : null,
                engine: '文件级安装盘（分区 + FAT32 + 引导）',
                note: 'UEFI 与 Legacy BIOS 双模式可启动。',
              },
            });
            return;
          }

          emit({
            kind: 'progress',
            pct,
            phase: ph.phase,
            message:
              pct > 0.1 && pct < 0.88
                ? `复制 ${(written / 1073741824).toFixed(2)} / ${(total / 1073741824).toFixed(2)} GB`
                : ph.msg,
            speed: smooth,
            eta,
            bytesWritten: written,
            totalBytes: total,
          });
        }, 240);
      }, 420);
      return { jobId: 'mock-job' };
    },
    async cancel() {
      window.clearInterval(timer);
      emit({ kind: 'cancelled' });
      return true;
    },
    async eject() {
      return { ok: true };
    },
    async requestElevation() {
      return { ok: true };
    },
    async assertWritable() {
      return { ok: true };
    },
    async reveal() {},
    async openExternal(url: string) {
      window.open(url, '_blank');
    },
    pathForFile(file: File) {
      return `mock:///${file.name}`;
    },
    onEvent(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

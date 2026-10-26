export type OsKind = 'windows' | 'macos' | 'linux' | 'unknown';

export interface Verdict {
  level: 'ok' | 'warn' | 'blocked';
  code: string | null;
  title: string;
  reason: string;
  advice: string;
}

export interface Volume {
  name: string;
  mount: string;
  fs: string;
}

export interface Device {
  id: string;
  node: string;
  rawNode: string;
  name: string;
  size: number;
  bus: string;
  busKind: 'usb' | 'sd' | 'internal' | 'virtual' | 'unknown';
  removable: boolean;
  internal: boolean;
  virtual: boolean;
  isSystemDisk: boolean;
  mountPoints: string[];
  volumes: Volume[];
  partitionScheme: string;
  writable: boolean;
  detail: string;
  platform: string;
  serial?: string;
  verdict: Verdict;
  selectable: boolean;
  selectableReason: string;
}

export interface DeviceListResult {
  ok: boolean;
  error?: string;
  platform: string;
  devices: Device[];
  safeCount: number;
  lockedCount: number;
}

export interface ImageTarget {
  os: OsKind;
  osLabel: string;
  version: string;
  arch: string;
  archLabel: string;
  confidence: number;
  evidence: string[];
}

export interface ImageInfo {
  ok: boolean;
  error?: string;
  path: string;
  fileName: string;
  size: number;
  label: string;
  kind: string;
  structures: {
    mbr?: boolean;
    gpt?: boolean;
    apm?: boolean;
    hfs?: boolean;
    apfs?: boolean;
    isRaw?: boolean;
    hfsVariant?: string | null;
  };
  target: ImageTarget;
  hasUefiBoot?: boolean;
  hasBiosBoot?: boolean;
  needsFat32Split?: boolean;
  supportsPersistence?: boolean;
  wimSize?: number;
  recommended: {
    scheme: string;
    filesystem: string;
    bootMode: string;
    note: string;
  };
}

export interface BootInfo {
  version: string;
  platform: NodeJS.Platform | string;
  arch: string;
  elevated: boolean;
  elevatedByArg: boolean;
  electron: string;
  language?: 'zh' | 'en';
}

export interface StartPayload {
  imagePath: string;
  imageInfo: ImageInfo;
  device: Device;
  options: { verify: boolean; persistence: boolean; allowUnknownBus: boolean };
}

export interface JobEvent {
  jobId?: string;
  kind: 'phase' | 'progress' | 'log' | 'done' | 'error' | 'cancelled';
  phase?: string;
  message?: string;
  pct?: number;
  speed?: number;
  eta?: number;
  bytesWritten?: number;
  totalBytes?: number;
  result?: any;
  error?: { code: string; message: string; detail?: string };
}

export interface DiterApi {
  boot(): Promise<BootInfo>;
  listDevices(opts: { imageSize: number; allowUnknownBus: boolean }): Promise<DeviceListResult>;
  pickImage(): Promise<string | null>;
  probeImage(path: string): Promise<ImageInfo>;
  start(payload: StartPayload): Promise<{ jobId: string }>;
  cancel(jobId: string): Promise<boolean>;
  eject(deviceId: string): Promise<{ ok: boolean; stderr?: string }>;
  requestElevation(): Promise<{ ok: boolean; message?: string }>;
  assertWritable(p: { device: Device; imageSize: number; allowUnknownBus: boolean }): Promise<any>;
  reveal(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  getLanguage(): Promise<'zh' | 'en'>;
  setLanguage(lang: 'zh' | 'en'): Promise<'zh' | 'en'>;
  pathForFile(file: File): string;
  onEvent(cb: (e: JobEvent) => void): () => void;
  onOpenSettings(cb: () => void): () => void;
  onOpenAbout(cb: () => void): () => void;
  isDesktop: boolean;
}

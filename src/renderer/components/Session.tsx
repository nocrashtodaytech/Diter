import React from 'react';
import type { Device, ImageInfo } from '../types';
import { Alert, Check, Spin } from './Icons';

export interface Progress {
  pct: number;
  phase: string;
  message: string;
  speed: number;
  eta: number;
  bytesWritten: number;
  totalBytes: number;
  samples: number[];
  logs: string[];
}

const bytes = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  const v = n / 1024 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
};
const dur = (s: number) => {
  if (!Number.isFinite(s) || s <= 0) return '—';
  if (s < 60) return `${Math.ceil(s)} 秒`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} 分 ${Math.round(s % 60)} 秒` : `${Math.floor(m / 60)} 时 ${m % 60} 分`;
};

function Spark({ samples }: { samples: number[] }) {
  const data = samples.filter((n) => n > 0).slice(-64);
  const W = 300;
  const H = 52;
  const ready = data.length >= 3;

  // 用 min–max 归一化，并把波动放大到可视区间，否则稳定速率会画成一条贴边的实心块
  let pts: string[] = [];
  if (ready) {
    const max = Math.max(...data);
    const min = Math.min(...data);
    const span = Math.max(max - min, max * 0.06);
    pts = data.map((v, i) => {
      const x = (i / Math.max(1, data.length - 1)) * W;
      const y = H - 7 - ((v - min) / span) * (H - 16);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
  }
  const line = pts.join(' ');
  const peak = data.length ? Math.max(...data) : 0;

  return (
    <div className="spark">
      <div className="spark-head">
        <span>写入速率</span>
        <span style={{ fontFamily: 'var(--mono)' }}>{peak ? `${bytes(peak)}/s 峰值` : '采样中…'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', flex: 1 }}>
        <defs>
          <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0a84ff" stopOpacity=".3" />
            <stop offset="1" stopColor="#0a84ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ready ? (
          <>
            <polygon points={`0,${H} ${line} ${W},${H}`} fill="url(#sg)" />
            <polyline
              points={line}
              fill="none"
              stroke="#0a84ff"
              strokeWidth="1.6"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : (
          <line x1="0" y1={H - 12} x2={W} y2={H - 12} stroke="#d0d4da" strokeDasharray="4 5" strokeWidth="1.4" />
        )}
      </svg>
    </div>
  );
}

export function WritingView({
  progress,
  image,
  device,
  onCancel,
}: {
  progress: Progress;
  image: ImageInfo;
  device: Device;
  onCancel: () => void;
}) {
  const pct = Math.round(progress.pct * 1000) / 10;
  return (
    <div className="session">
      <div className="session-head">
        <div>
          <div className="session-title">正在写入</div>
          <div className="session-sub">
            {image.fileName} <span style={{ color: '#c2c6cc' }}>→</span> {device.name}
          </div>
        </div>
        <div className="session-phase">
          <span className="pulse-dot" />
          {progress.phase}
        </div>
      </div>

      <div className="progress-wrap">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${Math.max(1.5, pct)}%` }} />
        </div>
        <div className="progress-line">
          <span className="progress-message">{progress.message || progress.phase}</span>
          <span className="progress-bytes">
            {bytes(progress.bytesWritten)} / {bytes(progress.totalBytes || image.size)}
          </span>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-k">写入速度</div>
          <div className="stat-v" style={{ color: '#0a84ff' }}>
            {bytes(progress.speed)}/s
          </div>
        </div>
        <div className="stat">
          <div className="stat-k">剩余时间</div>
          <div className="stat-v">{dur(progress.eta)}</div>
        </div>
        <div className="stat">
          <div className="stat-k">已写入</div>
          <div className="stat-v">{bytes(progress.bytesWritten)}</div>
        </div>
        <div className="stat">
          <div className="stat-k">目标设备</div>
          <div className="stat-v" style={{ fontSize: 12.5, fontFamily: 'var(--sans)' }}>
            {device.node}
          </div>
        </div>
      </div>

      <Spark samples={progress.samples} />

      {progress.logs.length > 0 && (
        <div className="logstrip">
          {progress.logs.slice(-6).map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      <div className="session-actions">
        <div className="footer-note">
          <span>写入过程中请勿拔出设备或关闭窗口</span>
        </div>
        <button className="btn danger" onClick={onCancel}>
          中止写入
        </button>
      </div>
    </div>
  );
}

export function DoneView({
  result,
  device,
  elapsedSec = 0,
  onEject,
  onAgain,
}: {
  result: any;
  device: Device;
  elapsedSec?: number;
  onEject: () => void;
  onAgain: () => void;
}) {
  const v = result?.verification;
  const chips: string[] = [];
  if (result?.engine) chips.push(result.engine);
  if (v) chips.push(v.ok ? 'SHA-256 校验通过' : '校验不一致');
  if (result?.legacyBoot) chips.push('Legacy BIOS 可启动');
  if (result?.persistence?.created) chips.push('已创建持久化分区');
  if (result?.files) chips.push(`${result.files} 个文件`);

  const written = result?.bytes || (v ? device.size : 0);
  const avg = elapsedSec > 0 && written > 0 ? written / elapsedSec : 0;

  return (
    <div className="result">
      <div className="result-orb ok">
        <Check size={36} style={{ color: 'var(--ok)' }} />
      </div>
      <h2>写入完成</h2>
      <p>
        <strong style={{ color: '#1d1d1f' }}>{device.name}</strong> 已可启动。
        {result?.note ? <> {result.note}</> : null}
      </p>

      <div className="result-summary">
        {chips.map((c) => (
          <span className="ev" key={c} style={{ fontSize: 11 }}>
            {c}
          </span>
        ))}
      </div>

      <div className="stats" style={{ width: '100%', maxWidth: 560, marginTop: 6 }}>
        <div className="stat">
          <div className="stat-k">目标设备</div>
          <div className="stat-v" style={{ fontSize: 12, fontFamily: 'var(--sans)' }}>
            {device.node}
          </div>
        </div>
        <div className="stat">
          <div className="stat-k">耗时</div>
          <div className="stat-v">{dur(elapsedSec) === '—' ? '—' : dur(elapsedSec)}</div>
        </div>
        <div className="stat">
          <div className="stat-k">平均速率</div>
          <div className="stat-v" style={{ color: '#0a84ff' }}>
            {avg > 0 ? `${bytes(avg)}/s` : '—'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-k">数据校验</div>
          <div className="stat-v" style={{ color: v?.ok ? 'var(--ok)' : v ? 'var(--danger)' : 'var(--faint)' }}>
            {v ? (v.ok ? '一致' : '不一致') : '未启用'}
          </div>
        </div>
      </div>

      {v && !v.ok && (
        <p style={{ color: 'var(--danger)', maxWidth: 420 }}>
          校验阶段发现差异（{v.error || '源与设备内容不一致'}）。可能是写入过程中设备被拔出或存在坏块，建议重新写入。
        </p>
      )}

      <div className="result-actions">
        <button className="btn ghost" onClick={onAgain}>
          再写一个
        </button>
        <button className="btn primary" onClick={onEject}>
          安全弹出
        </button>
      </div>
    </div>
  );
}

export function ErrorView({
  error,
  onBack,
  device,
}: {
  error: { code: string; message: string; detail?: string };
  onBack: () => void;
  device?: Device | null;
}) {
  return (
    <div className="result">
      <div className="result-orb err">
        <Alert size={34} style={{ color: 'var(--danger)' }} />
      </div>
      <h2>写入未完成</h2>
      <p>{error.message}</p>
      {device && (
        <p style={{ color: 'var(--faint)', fontSize: 11.5 }}>
          目标设备 {device.name}（{device.node}）可能已处于不完整状态，请重新写入后再使用。
        </p>
      )}
      {error.detail && (
        <pre
          className="logstrip"
          style={{ maxWidth: 520, width: '100%', textAlign: 'left', maxHeight: 130, overflow: 'auto' }}
        >
          {error.detail}
        </pre>
      )}
      <div className="result-actions">
        <button className="btn primary" onClick={onBack}>
          返回重试
        </button>
      </div>
    </div>
  );
}

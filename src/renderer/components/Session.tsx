import React from 'react';
import type { Device, ImageInfo } from '../types';
import { Alert, Check, Spin } from './Icons';
import { useI18n } from '../i18n';

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
  const { t } = useI18n();
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
        <span>{t('writeRate')}</span>
        <span style={{ fontFamily: 'var(--mono)' }}>{peak ? `${bytes(peak)}/s ${t('peak')}` : t('sampling')}</span>
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
  const { t } = useI18n();
  return (
    <div className="session">
      <div className="session-head">
        <div>
          <div className="session-title">{t('writing')}</div>
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
          <div className="stat-k">{t('writeSpeed')}</div>
          <div className="stat-v" style={{ color: '#0a84ff' }}>
            {bytes(progress.speed)}/s
          </div>
        </div>
        <div className="stat">
          <div className="stat-k">{t('remaining')}</div>
          <div className="stat-v">{dur(progress.eta)}</div>
        </div>
        <div className="stat">
          <div className="stat-k">{t('written')}</div>
          <div className="stat-v">{bytes(progress.bytesWritten)}</div>
        </div>
        <div className="stat">
          <div className="stat-k">{t('targetDevice')}</div>
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
          <span>{t('noRemove')}</span>
        </div>
        <button className="btn danger" onClick={onCancel}>
          {t('abort')}
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
  const { t } = useI18n();
  const v = result?.verification;
  const chips: string[] = [];
  if (result?.engine) chips.push(result.engine);
  if (v) chips.push(v.ok ? t('shaOk') : t('shaMismatch'));
  if (result?.legacyBoot) chips.push(t('legacyBoot'));
  if (result?.persistence?.created) chips.push(t('persistenceCreated'));
  if (result?.files) chips.push(t('filesCount', { n: result.files }));

  const written = result?.bytes || (v ? device.size : 0);
  const avg = elapsedSec > 0 && written > 0 ? written / elapsedSec : 0;

  return (
    <div className="result">
      <div className="result-orb ok">
        <Check size={36} style={{ color: 'var(--ok)' }} />
      </div>
      <h2>{t('done')}</h2>
      <p>
        <strong style={{ color: '#1d1d1f' }}>{device.name}</strong> {t('bootable')}。
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
          <div className="stat-k">{t('targetDevice')}</div>
          <div className="stat-v" style={{ fontSize: 12, fontFamily: 'var(--sans)' }}>
            {device.node}
          </div>
        </div>
        <div className="stat">
          <div className="stat-k">{t('elapsed')}</div>
          <div className="stat-v">{dur(elapsedSec) === '—' ? '—' : dur(elapsedSec)}</div>
        </div>
        <div className="stat">
          <div className="stat-k">{t('avgSpeed')}</div>
          <div className="stat-v" style={{ color: '#0a84ff' }}>
            {avg > 0 ? `${bytes(avg)}/s` : '—'}
          </div>
        </div>
        <div className="stat">
          <div className="stat-k">{t('verification')}</div>
          <div className="stat-v" style={{ color: v?.ok ? 'var(--ok)' : v ? 'var(--danger)' : 'var(--faint)' }}>
            {v ? (v.ok ? t('match') : t('mismatch')) : t('notEnabled')}
          </div>
        </div>
      </div>

      {v && !v.ok && (
        <p style={{ color: 'var(--danger)', maxWidth: 420 }}>
          {t('verifyFailed')}
        </p>
      )}

      <div className="result-actions">
        <button className="btn ghost" onClick={onAgain}>
          {t('again')}
        </button>
        <button className="btn primary" onClick={onEject}>
          {t('eject')}
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
  const { t } = useI18n();
  return (
    <div className="result">
      <div className="result-orb err">
        <Alert size={34} style={{ color: 'var(--danger)' }} />
      </div>
      <h2>{t('writeFailed')}</h2>
      <p>{error.message}</p>
      {device && (
        <p style={{ color: 'var(--faint)', fontSize: 11.5 }}>
          {t('incomplete', { name: device.name, node: device.node })}
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
          {t('retry')}
        </button>
      </div>
    </div>
  );
}

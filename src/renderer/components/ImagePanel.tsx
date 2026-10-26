import React from 'react';
import type { Device, ImageInfo } from '../types';
import { Drive, Folder, Shield } from './Icons';
import { useI18n } from '../i18n';

const gb = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const v = n / 1024 ** 3;
  return v >= 10 ? `${v.toFixed(1)} GB` : `${v.toFixed(2)} GB`;
};

const OS_LETTER: Record<string, string> = { windows: 'W', macos: 'M', linux: 'L', unknown: '?' };

export function ImagePanel({
  image,
  onPick,
  onClear,
  dragActive,
  loading,
}: {
  image: ImageInfo | null;
  onPick: () => void;
  onClear: () => void;
  dragActive: boolean;
  loading: boolean;
}) {
  const { t } = useI18n();
  if (!image) {
    return (
      <div className={`dropzone ${dragActive ? 'drag' : ''}`} onClick={onPick}>
        <div className="dz-orb">
          {loading ? <div className="dz-spinner" /> : <Drive size={30} />}
        </div>
        <div className="dz-title">{loading ? t('detecting') : t('dropTitle')}</div>
        <div className="dz-sub">
          {loading ? t('detectingSub') : t('dropSub')}
        </div>
        {loading ? (
          <div className="dz-progress">
            <div className="dz-progress-fill" />
          </div>
        ) : (
          <div className="dz-formats">
            <span className="fmt">.iso</span>
            <span className="fmt">.img</span>
            <span className="fmt">.dmg</span>
            <span className="fmt">.app</span>
          </div>
        )}
      </div>
    );
  }

  const target = image.target;
  const os = target.os;
  const conf = target.confidence >= 0.9 ? 'high' : '';
  const bootLabel = [image.hasUefiBoot ? 'UEFI' : null, image.hasBiosBoot ? 'Legacy' : null, os === 'macos' ? 'Apple' : null]
    .filter(Boolean)
    .join(' + ');

  return (
    <div className="panel image-card">
      <div className="image-top">
        <div className={`os-mark ${os}`}>{OS_LETTER[os] || '?'}</div>
        <div className="image-main">
          <div className="image-name" title={image.fileName}>
            {image.fileName}
          </div>
          <div className="image-sub">
            <span>{target.version}</span>
            <span className={`conf-chip ${conf}`}>识别度 {Math.round(target.confidence * 100)}%</span>
          </div>
        </div>
        <button className="btn ghost sm" onClick={onPick} style={{ flex: '0 0 auto' }}>
          更换
        </button>
      </div>

      <div className="meta-grid">
        <div className="meta-cell">
          <div className="meta-k">目标系统</div>
          <div className="meta-v">{target.osLabel}</div>
        </div>
        <div className="meta-cell">
          <div className="meta-k">架构</div>
          <div className="meta-v">{target.archLabel}</div>
        </div>
        <div className="meta-cell">
          <div className="meta-k">镜像大小</div>
          <div className="meta-v">{gb(image.size)}</div>
        </div>
      </div>

      <div className="evidence">
        <span className="ev">引导 {bootLabel || '未知'}</span>
        <span className="ev">分区 {image.recommended?.scheme?.toUpperCase() || '—'}</span>
        <span className="ev">文件系统 {image.recommended?.filesystem || '—'}</span>
        {(target.evidence || []).slice(0, 3).map((e) => (
          <span className="ev" key={e}>
            {e}
          </span>
        ))}
      </div>

      <div className="footer-note" style={{ fontSize: 11.5 }}>
        <Shield size={13} style={{ color: 'var(--faint)' }} />
        <span>{image.recommended?.note || '按镜像原始结构写入'}</span>
      </div>
    </div>
  );
}

export const fmtGB = gb;

/**
 * 写入前预检清单。
 * 不是装饰：每一项都对应真实校验（识别置信度、容量余量、引导能力、系统盘防护），
 * 让用户在按下"开始写入"之前就能看到会成功还是会失败。
 */
export function Preflight({ image, device }: { image: ImageInfo; device: Device | null }) {
  const conf = image.target.confidence;
  const boot = [image.hasUefiBoot ? 'UEFI' : null, image.hasBiosBoot ? 'Legacy BIOS' : null, image.target.os === 'macos' ? 'Apple 引导' : null]
    .filter(Boolean)
    .join(' + ');

  const rows: { level: 'ok' | 'warn' | 'idle'; k: string; v: string }[] = [
    {
      level: conf >= 0.7 ? 'ok' : 'warn',
      k: '镜像识别',
      v: `${image.target.version.startsWith(image.target.osLabel) ? image.target.version : `${image.target.osLabel} ${image.target.version}`} · 置信度 ${Math.round(conf * 100)}%`,
    },
    {
      level: !device ? 'idle' : device.size >= image.size * 1.02 ? 'ok' : 'warn',
      k: '容量余量',
      v: device ? `${gb(device.size)} 设备 / ${gb(image.size)} 镜像` : '等待选择目标设备',
    },
    { level: boot ? 'ok' : 'warn', k: '引导能力', v: boot || '未知，将按原始镜像结构写入' },
    { level: 'ok', k: '系统盘防护', v: '已启用 · 系统盘与内建盘无法被选中' },
  ];

  return (
    <div className="panel preflight">
      <div className="pf-head">
        <Shield size={13} style={{ color: 'var(--faint)' }} />
        <span>写入前预检</span>
      </div>
      {rows.map((r) => (
        <div className="pf-row" key={r.k}>
          <span className={`pf-dot ${r.level}`} />
          <span className="pf-k">{r.k}</span>
          <span className="pf-v">{r.v}</span>
        </div>
      ))}
    </div>
  );
}

import React, { useRef, useState } from 'react';
import type { Device, ImageInfo } from '../types';
import { Alert, Check, X } from './Icons';
import { useI18n } from '../i18n';

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;

/**
 * 二次确认：勾选 + 长按 1.5 秒。
 * 设计意图 —— 单次误触不可能完成写入（这是本产品最重要的一个交互）。
 */
export function ConfirmDialog({
  device,
  image,
  onCancel,
  onConfirm,
  elevated,
  elevating,
  elevateError,
  onRequestElevation,
}: {
  device: Device;
  image: ImageInfo;
  onCancel: () => void;
  onConfirm: () => void;
  elevated: boolean;
  elevating: boolean;
  elevateError: string | null;
  onRequestElevation: () => void;
}) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);
  const [hold, setHold] = useState(0);
  const raf = useRef<number | null>(null);
  const startAt = useRef(0);
  const HOLD_MS = 1500;

  const begin = () => {
    if (!checked || !elevated) return;
    startAt.current = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - startAt.current) / HOLD_MS);
      setHold(p);
      if (p >= 1) {
        setHold(0);
        raf.current = null;
        onConfirm();
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  const end = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    setHold(0);
  };

  if (!elevated) {
    return (
      <div className="overlay" onClick={onCancel}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-icon" style={{ background: 'rgba(255,159,10,.12)', borderColor: 'rgba(255,159,10,.3)' }}>
            <Alert size={22} style={{ color: 'var(--warn)' }} />
          </div>
          <h3>{t('needAdmin')}</h3>
          <p>{t('needAdminDesc')}</p>
          {elevateError && (
            <div className="target-box" style={{ marginTop: 12, background: 'var(--danger-soft)' }}>
              <div className="target-meta" style={{ color: 'var(--danger)' }}>{elevateError}</div>
            </div>
          )}
          <div className="modal-actions">
            <button className="btn ghost" onClick={onCancel}>
              {t('cancel')}
            </button>
            <button className="btn primary" onClick={onRequestElevation} disabled={elevating}>
              {elevating ? t('waitingAuth') : t('authorize')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-icon">
          <Alert size={22} style={{ color: 'var(--danger)' }} />
        </div>
        <h3>{t('confirmWipe')}</h3>
        <p>{t('confirmWipeDesc')}</p>

        <div className="target-box">
          <div className="target-name">{device.name}</div>
          <div className="target-meta">
            {device.node} · {gb(device.size)} · {device.bus}
          </div>
        </div>

        <div className="target-box" style={{ marginTop: 8, borderStyle: 'dashed' }}>
          <div className="target-name" style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--dim)' }}>
            {t('willWrite')}
          </div>
          <div className="target-meta" style={{ color: 'var(--dim)' }}>
            {image.fileName} → {image.target.version}
          </div>
        </div>

        <div className={`confirm-check ${checked ? 'on' : ''}`} onClick={() => setChecked(!checked)}>
          <span className="box">
            <Check size={10} style={{ color: '#fff' }} />
          </span>
          <span>{t('confirmCheck')}</span>
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} onMouseUp={end}>
            {t('cancel')}
          </button>
          <button
            className={`btn primary hold-btn ${hold > 0 ? 'holding' : ''}`}
            disabled={!checked}
            onMouseDown={begin}
            onMouseUp={end}
            onMouseLeave={end}
            onTouchStart={begin}
            onTouchEnd={end}
          >
            {hold > 0 && <span className="hold-fill" style={{ transform: `scaleX(${hold})` }} />}
            <span className="hold-label">
              {checked ? t('holdToWrite') : t('checkFirst')}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

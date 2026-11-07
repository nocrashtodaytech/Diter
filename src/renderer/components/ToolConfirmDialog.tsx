import React, { useRef, useState } from 'react';
import type { Device } from '../types';
import { Alert, Check } from './Icons';
import { useI18n } from '../i18n';

/**
 * 磁盘工具（擦除 / 备份）的二次确认：勾选 + 长按 1.5 秒，
 * 与写入确认一致的安全交互，避免单次误触触发不可逆操作。
 */
export function ToolConfirmDialog({
  title,
  desc,
  device,
  meta,
  checkLabel,
  danger = true,
  onCancel,
  onConfirm,
}: {
  title: string;
  desc: string;
  device: Device;
  meta?: string;
  checkLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);
  const [hold, setHold] = useState(0);
  const raf = useRef<number | null>(null);
  const startAt = useRef(0);
  const HOLD_MS = 1500;

  const begin = () => {
    if (!checked) return;
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

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-icon" style={danger ? undefined : { background: 'var(--accent-soft)' }}>
          <Alert size={22} style={{ color: danger ? 'var(--danger)' : 'var(--accent)' }} />
        </div>
        <h3>{title}</h3>
        <p>{desc}</p>

        <div className="target-box">
          <div className="target-name">{device.name}</div>
          <div className="target-meta">
            {device.node}
            {meta ? ` · ${meta}` : ''}
          </div>
        </div>

        <div className={`confirm-check ${checked ? 'on' : ''}`} onClick={() => setChecked(!checked)}>
          <span className="box">
            <Check size={10} style={{ color: '#fff' }} />
          </span>
          <span>{checkLabel}</span>
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
            <span className="hold-label">{checked ? t('holdToWrite') : t('checkFirst')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

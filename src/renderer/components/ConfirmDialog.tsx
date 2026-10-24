import React, { useRef, useState } from 'react';
import type { Device, ImageInfo } from '../types';
import { Alert, Check, X } from './Icons';

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
          <h3>需要管理员权限</h3>
          <p>
            写入原始磁盘、修改分区表必须由管理员执行。点击「授权」后会弹出系统密码框，输入密码后当前窗口原地获得管理员权限，无需重启。
          </p>
          {elevateError && (
            <div className="target-box" style={{ marginTop: 12, background: 'var(--danger-soft)' }}>
              <div className="target-meta" style={{ color: 'var(--danger)' }}>{elevateError}</div>
            </div>
          )}
          <div className="modal-actions">
            <button className="btn ghost" onClick={onCancel}>
              取消
            </button>
            <button className="btn primary" onClick={onRequestElevation} disabled={elevating}>
              {elevating ? '正在等待授权…' : '授权'}
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
        <h3>确认清空这台设备</h3>
        <p>
          接下来对以下设备的操作是<strong style={{ color: 'var(--danger)' }}>不可恢复</strong>的：全部分区将被删除，原有数据无法通过任何软件找回。
        </p>

        <div className="target-box">
          <div className="target-name">{device.name}</div>
          <div className="target-meta">
            {device.node} · {gb(device.size)} · {device.bus}
          </div>
        </div>

        <div className="target-box" style={{ marginTop: 8, borderStyle: 'dashed' }}>
          <div className="target-name" style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--dim)' }}>
            将写入
          </div>
          <div className="target-meta" style={{ color: 'var(--dim)' }}>
            {image.fileName} → {image.target.version}
          </div>
        </div>

        <div className={`confirm-check ${checked ? 'on' : ''}`} onClick={() => setChecked(!checked)}>
          <span className="box">
            <Check size={10} style={{ color: '#fff' }} />
          </span>
          <span>我确认该设备的全部数据将被清除，且这不是系统盘。</span>
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} onMouseUp={end}>
            取消
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
              {checked ? '按住 1.5 秒开始写入' : '请先勾选确认'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

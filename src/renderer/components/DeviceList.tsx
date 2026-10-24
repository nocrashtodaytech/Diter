import React from 'react';
import type { Device } from '../types';
import { Check, Disc, Lock, Usb, Cpu } from './Icons';

const gb = (n: number) => {
  const v = n / 1024 ** 3;
  if (v >= 1000) return `${(v / 1000).toFixed(2)} TB`;
  return v >= 10 ? `${v.toFixed(0)} GB` : `${v.toFixed(1)} GB`;
};

function glyph(d: Device) {
  if (d.isSystemDisk || d.internal) return <Cpu size={19} />;
  if (d.virtual) return <Disc size={19} />;
  return <Usb size={19} />;
}

export function DeviceList({
  devices,
  selectedId,
  onSelect,
  scanning,
}: {
  devices: Device[];
  selectedId: string | null;
  onSelect: (d: Device) => void;
  scanning: boolean;
}) {
  const safe = devices.filter((d) => d.selectable);
  const locked = devices.filter((d) => !d.selectable);

  if (!devices.length) {
    return (
      <div className="device-empty">
        <strong>未检测到磁盘</strong>
        <div style={{ marginTop: 4 }}>{scanning ? '正在扫描…' : '请插入 U 盘后重试。'}</div>
      </div>
    );
  }

  return (
    <div className="device-list">
      {[...safe, ...locked].map((d) => {
        const isLocked = !d.selectable;
        const selected = d.id === selectedId;
        const warn = d.verdict?.level === 'warn';
        return (
          <div
            key={`${d.id}-${d.node}`}
            className={`device ${selected ? 'selected' : ''} ${isLocked ? 'locked' : ''}`}
            onClick={() => !isLocked && onSelect(d)}
            title={isLocked ? d.verdict?.reason : '点击选择该设备'}
          >
            {isLocked ? (
              <div style={{ width: 18, flex: '0 0 18px' }} />
            ) : (
              <div className="check">
                <Check size={11} style={{ color: '#fff' }} />
              </div>
            )}

            <div className="device-icon" style={isLocked ? { color: 'var(--faint)' } : { color: 'var(--dim)' }}>
              {glyph(d)}
            </div>

            <div className="device-body">
              <div className="device-name">{d.name}</div>
              <div className="device-sub">
                <span>{d.detail}</span>
                <span className="sep" />
                <span className="mono" style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>
                  {d.node}
                </span>
                {d.volumes?.filter((v) => v.name).length > 0 && (
                  <>
                    <span className="sep" />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {d.volumes.filter((v) => v.name).map((v) => v.name).join(', ')}
                    </span>
                  </>
                )}
              </div>
              {isLocked && (
                <div className="device-reason" title={`${d.verdict?.title} — ${d.verdict?.reason}`}>
                  {d.verdict?.reason}
                </div>
              )}
              {!isLocked && warn && <div className="device-reason">{d.verdict?.reason}</div>}
            </div>

            <div className="device-right">
              <div className="device-size">{gb(d.size)}</div>
              {isLocked ? (
                <span className="tag lock">
                  <Lock size={10} />
                  {d.verdict?.code === 'SYSTEM_DISK' ? '系统盘' : '已锁定'}
                </span>
              ) : warn ? (
                <span className="tag warn">容量偏紧</span>
              ) : (
                <span className="tag safe">可写入</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

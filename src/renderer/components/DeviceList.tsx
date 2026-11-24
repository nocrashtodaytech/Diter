import React from 'react';
import type { Device } from '../types';
import { Check, Disc, Lock, Unlock, Usb, Cpu, Trash, Download } from './Icons';
import { useI18n } from '../i18n';

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

/** 后端只回传 verdict.code（英文枚举），锁定标题/原因在前端按当前语言渲染 */
function verdictTitle(code: string | null | undefined, t: (k: any) => string): string {
  switch (code) {
    case 'SYSTEM_DISK': return t('vSystem');
    case 'VIRTUAL_DISK': return t('vVirtual');
    case 'INTERNAL_DISK': return t('vInternal');
    case 'UNKNOWN_BUS': return t('vUnknownBus');
    case 'READ_ONLY': return t('vReadonly');
    case 'TOO_SMALL': return t('vTooSmall');
    default: return t('locked');
  }
}

function verdictReason(d: Device, imageSize: number, t: (k: any, v?: any) => string): string {
  const code = d.verdict?.code;
  const size = gb(d.size);
  const need = gb(imageSize || 0);
  switch (code) {
    case 'SYSTEM_DISK': return t('vSystemReason');
    case 'VIRTUAL_DISK': return t('vVirtualReason');
    case 'INTERNAL_DISK': return t('vInternalReason', { bus: d.bus || '' });
    case 'UNKNOWN_BUS': return t('vUnknownBusReason');
    case 'READ_ONLY': return t('vReadonlyReason');
    case 'TOO_SMALL': return t('vTooSmallReason', { need, size });
    default:
      return d.verdict?.level === 'warn' ? t('vTightReason', { need, size }) : (d.verdict?.reason || '');
  }
}

export function DeviceList({
  devices,
  selectedId,
  onSelect,
  scanning,
  onErase,
  onBackup,
  imageSize = 0,
  onUnlock,
}: {
  devices: Device[];
  selectedId: string | null;
  onSelect: (d: Device) => void;
  scanning: boolean;
  onErase: (d: Device) => void;
  onBackup: (d: Device) => void;
  imageSize?: number;
  onUnlock?: (d: Device) => void;
}) {
  const { t } = useI18n();
  const safe = devices.filter((d) => d.selectable);
  const locked = devices.filter((d) => !d.selectable);

  if (!devices.length) {
    return (
      <div className="device-empty">
        <strong>{t('noDisk')}</strong>
        <div style={{ marginTop: 4 }}>{scanning ? t('scanning') : t('insertUsb')}</div>
      </div>
    );
  }

  return (
    <div className="device-list">
      {[...safe, ...locked].map((d) => {
        const isLocked = !d.selectable;
        const selected = d.id === selectedId;
        const warn = d.verdict?.level === 'warn';
        const isSystem = d.verdict?.code === 'SYSTEM_DISK';
        const reason = isLocked || warn ? verdictReason(d, imageSize, t) : '';
        const title = isLocked ? verdictTitle(d.verdict?.code, t) : '';
        // 详情：总线 + 可移动/固定，前端本地化（后端 bus 字段已英文）
        const detail = `${d.bus || '—'} · ${d.removable ? t('removableMedia') : t('fixedMedia')}`;
        return (
          <div
            key={`${d.id}-${d.node}`}
            className={`device ${selected ? 'selected' : ''} ${isLocked ? 'locked' : ''}`}
            onClick={() => !isLocked && onSelect(d)}
            title={isLocked ? reason : t('clickSelect')}
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
                <span>{detail}</span>
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
                <div className="device-reason" title={`${title} — ${reason}`}>
                  {reason}
                </div>
              )}
              {!isLocked && warn && <div className="device-reason">{reason}</div>}
            </div>

            <div className="device-right">
              <div className="device-size">{gb(d.size)}</div>
              {isLocked ? (
                <>
                  <span className="tag lock">
                    <Lock size={10} />
                    {isSystem ? t('systemDisk') : t('locked')}
                  </span>
                  {!isSystem && onUnlock && (
                    <button
                      className="unlock-btn"
                      title={t('unlockHint')}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUnlock(d);
                      }}
                    >
                      <Unlock size={12} />
                      <span>{t('unlock')}</span>
                    </button>
                  )}
                </>
              ) : warn ? (
                <span className="tag warn">{t('tightCapacity')}</span>
              ) : (
                <span className="tag safe">{t('writable')}</span>
              )}
              {!isLocked && (
                <div className="device-tools" onClick={(e) => e.stopPropagation()}>
                  <button className="tool-btn" title={t('backup')} onClick={() => onBackup(d)}>
                    <Download size={13} />
                  </button>
                  <button className="tool-btn danger" title={t('erase')} onClick={() => onErase(d)}>
                    <Trash size={13} />
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

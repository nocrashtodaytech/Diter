import React, { useEffect, useState } from 'react';
import type { HistoryEntry } from '../types';
import { api } from '../api';
import { useI18n } from '../i18n';

/** 任务历史面板：列出最近的写入 / 擦除 / 备份记录，可定位对应日志文件 */
export function History({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [items, setItems] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    api()
      .getHistory()
      .then(setItems)
      .catch(() => {});
  }, []);

  const typeLabel = (type: string) =>
    type === 'erase' ? t('erase') : type === 'backup' ? t('backup') : t('writeOp');

  const resultLabel = (r: string) =>
    r === 'success' ? t('success') : r === 'error' ? t('failed') : t('cancelled');

  const timeStr = (ts: number) => {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 470 }}>
        <h3>{t('history')}</h3>
        {items.length === 0 ? (
          <p style={{ marginTop: 12 }}>{t('historyEmpty')}</p>
        ) : (
          <div className="history-list">
            {items.map((h) => (
              <div className="history-item" key={h.id}>
                <div className="history-info">
                  <div className="history-title">
                    {typeLabel(h.type)}
                    <span className={`history-result ${h.result}`}>{resultLabel(h.result)}</span>
                  </div>
                  <div className="history-meta">
                    {timeStr(h.time)}
                    {h.error ? ` · ${h.error}` : ''}
                  </div>
                </div>
                <button className="btn ghost sm" onClick={() => api().reveal(h.logFile)}>
                  {t('revealLog')}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}

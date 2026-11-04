import React, { useEffect, useState } from 'react';
import { api } from '../api';
import type { UpdateInfo, UpdateProgress } from '../types';
import { useI18n } from '../i18n';
import { Drive } from './Icons';

type Phase = 'checking' | 'no-update' | 'available' | 'downloading' | 'installing' | 'done' | 'error';

function fmtBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

/** 把 release 的 markdown 简单转成可读纯文本（保留换行与要点） */
function plainNotes(md: string) {
  return String(md || '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .trim();
}

export function Update({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>('checking');
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setPhase('checking');
    setError('');
    try {
      const r = await api().checkUpdate();
      if (!r.ok) {
        setError(r.error || t('updateFailed'));
        setPhase('error');
        return;
      }
      setInfo(r);
      if (r.hasUpdate) {
        if (r.asset) setPhase('available');
        else {
          setError(t('noInstallPackage'));
          setPhase('error');
        }
      } else {
        setPhase('no-update');
      }
    } catch (e: any) {
      setError(e?.message || t('updateFailed'));
      setPhase('error');
    }
  };

  useEffect(() => {
    check();
    const off = api().onUpdateProgress((p) => {
      setProgress(p);
      if (p.phase === 'downloading') setPhase('downloading');
      else if (p.phase === 'installing') setPhase('installing');
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doDownload = async () => {
    if (!info?.asset || busy) return;
    setBusy(true);
    setProgress({ phase: 'downloading', pct: 0, received: 0, total: info.asset.size });
    setPhase('downloading');
    try {
      const r = await api().downloadUpdate(info.asset);
      if (!r.ok) {
        setError(r.error || t('updateFailed'));
        setPhase('error');
      } else {
        setPhase('done');
        if (r.mode === 'restart' || r.mode === 'quit') {
          api().finishUpdate(r.mode);
        }
      }
    } catch (e: any) {
      setError(e?.message || t('updateFailed'));
      setPhase('error');
    } finally {
      setBusy(false);
    }
  };

  const pct = progress ? Math.max(0, Math.min(100, Math.round(progress.pct * 100))) : 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal about-modal" onClick={(e) => e.stopPropagation()}>
        <div className="about-hero">
          <div className="brand-mark" style={{ width: 52, height: 52, borderRadius: 14 }}>
            <Drive size={28} />
          </div>
          <div>
            <div className="about-name">{t('checkUpdate')}</div>
            <div className="about-ver">
              {t('version')} {info?.current || '—'}
            </div>
          </div>
        </div>

        <div className="update-body">
          {phase === 'checking' && (
            <div className="update-line">
              <span className="spin" style={{ width: 14, height: 14, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block' }} />
              {t('checkingUpdate')}
            </div>
          )}

          {phase === 'no-update' && (
            <div className="update-line ok">{t('alreadyLatest')} · v{info?.current}</div>
          )}

          {phase === 'available' && info && (
            <>
              <div className="update-found">
                {t('newVersionFound')} <b>v{info.latest}</b>
                <span className="update-arrow">（v{info.current} → v{info.latest}）</span>
              </div>
              {info.notes && (
                <div className="update-notes">
                  <div className="update-notes-title">{t('updateNotes')}</div>
                  <div className="update-notes-body">{plainNotes(info.notes).slice(0, 1200)}</div>
                </div>
              )}
              <div className="update-asset">
                {t('willDownload')}：{info.asset?.name}（{fmtBytes(info.asset?.size || 0)}）
              </div>
            </>
          )}

          {(phase === 'downloading' || phase === 'installing') && (
            <div className="update-progress">
              <div className="update-progress-track">
                <div className="update-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="update-progress-meta">
                <span>{phase === 'downloading' ? t('downloadingUpdate') : t('installingUpdate')}</span>
                <span>
                  {progress ? `${fmtBytes(progress.received)} / ${fmtBytes(progress.total)} · ${pct}%` : ''}
                </span>
              </div>
            </div>
          )}

          {phase === 'done' && (
            <div className="update-line ok">
              {t('updateDone')} · {t('willRestart')}
            </div>
          )}

          {phase === 'error' && <div className="update-line err">{error || t('updateFailed')}</div>}
        </div>

        <div className="modal-actions">
          {phase === 'available' && (
            <>
              <button className="btn ghost" onClick={onClose}>
                {t('later')}
              </button>
              <button className="btn primary" onClick={doDownload} disabled={busy}>
                {t('downloadInstall')}
              </button>
            </>
          )}
          {phase === 'error' && (
            <>
              <button className="btn ghost" onClick={onClose}>
                {t('close')}
              </button>
              <button className="btn primary" onClick={check}>
                {t('retryUpdate')}
              </button>
            </>
          )}
          {(phase === 'no-update' || phase === 'done') && (
            <button className="btn primary" onClick={onClose}>
              {t('close')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

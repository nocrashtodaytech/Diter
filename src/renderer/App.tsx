import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, isMock } from './api';
import type { BootInfo, Device, ImageInfo, JobEvent } from './types';
import { ImagePanel, Preflight } from './components/ImagePanel';
import { DeviceList } from './components/DeviceList';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DoneView, ErrorView, WritingView, type Progress } from './components/Session';
import { Alert, Drive, Shield, X } from './components/Icons';
import { useI18n, setLang as applyLang } from './i18n';
import { About } from './components/About';
import { Settings } from './components/Settings';

type View = 'select' | 'writing' | 'done' | 'error';

const EMPTY_PROGRESS: Progress = {
  pct: 0,
  phase: '准备',
  message: '',
  speed: 0,
  eta: 0,
  bytesWritten: 0,
  totalBytes: 0,
  samples: [],
  logs: [],
};

const PLATFORM_LABEL: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

export default function App() {
  const { t } = useI18n();
  const [boot, setBoot] = useState<BootInfo | null>(null);
  const [image, setImage] = useState<ImageInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('select');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [verify, setVerify] = useState(true);
  const [persistence, setPersistence] = useState(false);
  const [allowUnknown, setAllowUnknown] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>(EMPTY_PROGRESS);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [elevating, setElevating] = useState(false);
  const [elevateError, setElevateError] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const startedAt = useRef(0);

  /* ---------------------------- 启动 ---------------------------- */
  useEffect(() => {
    api()
      .boot()
      .then((b) => {
        setBoot(b);
        if (b.language) applyLang(b.language);
        if (b.platform === 'darwin') document.body.classList.add('is-mac');
      })
      .catch(() => {});
  }, []);

  /* ---------------------------- 菜单触发面板 ---------------------------- */
  useEffect(() => {
    const offS = api().onOpenSettings(() => setSettingsOpen(true));
    const offA = api().onOpenAbout(() => setAboutOpen(true));
    return () => {
      offS();
      offA();
    };
  }, []);

  /* ---------------------------- 写入事件 ---------------------------- */
  useEffect(() => {
    const off = api().onEvent((ev: JobEvent) => {
      if (ev.kind === 'progress' || ev.kind === 'phase') {
        setProgress((p) => {
          const next: Progress = {
            ...p,
            pct: typeof ev.pct === 'number' ? ev.pct : p.pct,
            phase: ev.phase || p.phase,
            message: ev.message || p.message,
            speed: ev.speed ?? p.speed,
            eta: ev.eta ?? p.eta,
            bytesWritten: ev.bytesWritten ?? p.bytesWritten,
            totalBytes: ev.totalBytes ?? p.totalBytes,
          };
          if (typeof ev.speed === 'number' && ev.speed > 0) {
            next.samples = [...p.samples, ev.speed].slice(-120);
          }
          if (ev.message && ev.message !== p.logs[p.logs.length - 1]) {
            next.logs = [...p.logs, ev.message].slice(-40);
          }
          return next;
        });
        if (ev.kind === 'phase') setView((v) => (v === 'select' ? 'writing' : v));
      } else if (ev.kind === 'done') {
        setResult(ev.result);
        setElapsed(ev.result?.elapsedSec || (Date.now() - startedAt.current) / 1000);
        setView('done');
      } else if (ev.kind === 'error') {
        setError(ev.error || { code: 'UNKNOWN', message: t('unknownError') });
        setView('error');
      } else if (ev.kind === 'cancelled') {
        setView('select');
        setJobId(null);
      }
    });
    return off;
  }, []);

  /* ---------------------------- 设备轮询 ---------------------------- */
  const imageSize = image?.size || 0;
  useEffect(() => {
    if (view !== 'select') return;
    let alive = true;
    const tick = async () => {
      setScanning(true);
      try {
        const r = await api().listDevices({ imageSize, allowUnknownBus: allowUnknown });
        if (!alive) return;
        const list = r.devices || [];
        setDevices(list);
        setSelectedId((prev) => {
          const selectable = list.filter((d) => d.selectable);
          if (prev && selectable.some((d) => d.id === prev)) return prev;
          return selectable.length === 1 ? selectable[0].id : null;
        });
      } finally {
        if (alive) setScanning(false);
      }
    };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [view, imageSize, allowUnknown]);

  /* ---------------------------- 镜像选择 ---------------------------- */
  const probe = useCallback(async (path: string) => {
    if (!path) return;
    setProbing(true);
    setProbeError(null);
    try {
      const info = await api().probeImage(path);
      if (!info || info.ok === false) {
        setProbeError((info as any)?.error || t('parseFailed'));
      } else {
        setImage(info);
      }
    } catch (e: any) {
      setProbeError(e?.message || t('parseFailed'));
    } finally {
      setProbing(false);
    }
  }, []);

  const pick = useCallback(async () => {
    const p = await api().pickImage();
    if (p) probe(p);
  }, [probe]);

  /* ---------------------------- 拖放 ---------------------------- */
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current++;
      if (e.dataTransfer?.types?.includes('Files')) setDragActive(true);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const p = api().pathForFile(file);
      const legacy = (file as any).path;
      if (p) {
        probe(p);
      } else if (legacy) {
        probe(legacy);
      } else {
        setProbeError(t('dropPathFailed', { name: file.name }));
      }
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [probe]);

  const selected = useMemo(() => devices.find((d) => d.id === selectedId) || null, [devices, selectedId]);
  const canStart = !!image && !!selected && selected.selectable && !probing;

  /* ---------------------------- 动作 ---------------------------- */
  const handleStart = () => {
    if (!canStart) return;
    setConfirmOpen(true);
  };

  const doStart = async () => {
    if (!image || !selected) return;
    setConfirmOpen(false);
    setProgress({ ...EMPTY_PROGRESS, totalBytes: image.size, logs: ['已提交写入任务'] });
    startedAt.current = Date.now();
    setView('writing');
    try {
      const { jobId: id } = await api().start({
        imagePath: image.path,
        imageInfo: image,
        device: selected,
        options: { verify, persistence, allowUnknownBus: allowUnknown },
      });
      setJobId(id);
    } catch (e: any) {
      setError({ code: 'START_FAILED', message: e?.message || t('startFailed') });
      setView('error');
    }
  };

  const cancel = async () => {
    if (jobId) await api().cancel(jobId);
    else setView('select');
  };

  const eject = async () => {
    if (selected) await api().eject(selected.id);
    setView('select');
    setResult(null);
  };

  const reset = () => {
    setView('select');
    setResult(null);
    setError(null);
    setProgress(EMPTY_PROGRESS);
  };

  const requestElevation = async () => {
    if (elevating) return;
    setElevating(true);
    setElevateError(null);
    try {
      const r = await api().requestElevation();
      if (r && r.ok) {
        // 助手已就绪，重新拉取授权状态（原窗口保持不变）
        const b = await api().boot();
        setBoot(b);
      } else {
        setElevateError((r && r.message) || '授权失败，请重试');
      }
    } catch (e: any) {
      setElevateError(e?.message || '授权失败，请重试');
    } finally {
      setElevating(false);
    }
  };

  /* ---------------------------- 渲染 ---------------------------- */
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Drive size={18} />
          </div>
          <div className="brand-text">
            <div className="brand-name">DITER</div>
            <div className="brand-sub">{t('brandSub')}</div>
          </div>
        </div>

        <div className="topbar-spacer" />

        {isMock() && (
          <span className="pill" style={{ color: 'var(--info)', borderColor: 'rgba(90,169,255,.28)' }}>
            {t('previewMode')}
          </span>
        )}
        <span className="pill mono">
          {PLATFORM_LABEL[boot?.platform || ''] || '—'} {boot?.arch || ''}
        </span>
        {boot?.elevated ? (
          <span className="pill ok">
            <span className="dot" /> {t('admin')}
          </span>
        ) : (
          <span className="pill warn" onClick={requestElevation} title={t('needAuth')}>
            {elevating ? (
              <>
                <span className="spin" style={{ width: 11, height: 11, border: '1.5px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block' }} />
                {t('authorizing')}
              </>
            ) : (
              <>
                <Alert size={11} /> {t('needAuth')}
              </>
            )}
          </span>
        )}
      </header>

      {view === 'select' && (
        <>
          <div className="content">
            <div className="col">
              <div className="section-head">
                <span className="section-title">{t('sectionImage')}</span>
                <span className="spacer" />
                {image && (
                  <button className="btn ghost sm" onClick={() => { setImage(null); setProbeError(null); }}>
                    {t('clear')}
                  </button>
                )}
              </div>
              <ImagePanel
                image={image}
                onPick={pick}
                onClear={() => setImage(null)}
                dragActive={dragActive}
                loading={probing}
              />
              {image && <Preflight image={image} device={selected} />}
              <div className="scope-line">
                <span>{t('scope')}</span>
                <b>Windows 7 – 11</b>
                <i>·</i>
                <b>macOS 10.10 – 27</b>
                <i>·</i>
                <b>Linux</b>
              </div>
              {probeError && (
                <div className="panel" style={{ padding: '10px 14px', display: 'flex', gap: 9, alignItems: 'center' }}>
                  <X size={14} style={{ color: 'var(--danger)', flex: '0 0 14px' }} />
                  <span style={{ fontSize: 12, color: 'var(--danger)' }}>{probeError}</span>
                </div>
              )}
            </div>

            <div className="col" style={{ minHeight: 0 }}>
              <div className="section-head">
                <span className="section-title">{t('sectionDevice')}</span>
                <span className="section-meta">
                  {t('writableCount', { a: devices.filter((d) => d.selectable).length, b: devices.filter((d) => !d.selectable).length })}
                </span>
                <span className="spacer" />
                {scanning && <span className="section-meta">{t('scanning')}</span>}
              </div>
              <DeviceList
                devices={devices}
                selectedId={selectedId}
                onSelect={(d) => setSelectedId(d.id)}
                scanning={scanning}
              />
            </div>
          </div>

          <footer className="footer">
            <div className="footer-note">
              <Shield size={14} style={{ color: 'var(--faint)' }} />
              <span>
                {t('footerWarn')}
              </span>
            </div>
            <div className="footer-spacer" />

            {image?.supportsPersistence && (
              <div className={`switch ${persistence ? 'on' : ''}`} onClick={() => setPersistence(!persistence)}>
                <span className="switch-track" />
                <span>{t('persistence')}</span>
              </div>
            )}

            <div className={`switch ${verify ? 'on' : ''}`} onClick={() => setVerify(!verify)}>
              <span className="switch-track" />
              <span>{t('verify')}</span>
            </div>

            <button className="btn primary" disabled={!canStart} onClick={handleStart}>
              {image ? (selected ? t('startWrite') : t('selectDevice')) : t('selectImage')}
            </button>
          </footer>
        </>
      )}

      {view === 'writing' && image && selected && (
        <WritingView progress={progress} image={image} device={selected} onCancel={cancel} />
      )}

      {view === 'done' && selected && (
        <DoneView result={result} device={selected} elapsedSec={elapsed} onEject={eject} onAgain={reset} />
      )}

      {view === 'error' && <ErrorView error={error} device={selected} onBack={reset} />}

      {confirmOpen && image && selected && (
        <ConfirmDialog
          device={selected}
          image={image}
          elevated={!!boot?.elevated}
          elevating={elevating}
          elevateError={elevateError}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={doStart}
          onRequestElevation={requestElevation}
        />
      )}

      {dragActive && (
        <div className="drag-veil">
          <span>{t('dropVeil')}</span>
        </div>
      )}

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {aboutOpen && <About version={boot?.version || '1.0.0'} onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

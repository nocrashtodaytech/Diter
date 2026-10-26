import React from 'react';
import { useI18n, langName, type Lang } from '../i18n';

export function Settings({ onClose }: { onClose: () => void }) {
  const { t, lang, setLang } = useI18n();
  const applyLang = (l: Lang) => {
    setLang(l);
    // 持久化到主进程（Electron 环境）
    if (window.diter?.setLanguage) window.diter.setLanguage(l);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('settings')}</h3>

        <div className="setting-row">
          <div className="setting-label">{t('language')}</div>
          <div className="lang-seg">
            {(['zh', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                className={`lang-opt ${lang === l ? 'on' : ''}`}
                onClick={() => applyLang(l)}
              >
                {langName(l)}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}

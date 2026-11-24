import React, { useEffect, useState } from 'react';
import { useI18n, langName, LANGS, APPEARANCES, type Lang, type Appearance } from '../i18n';
import { api } from '../api';

type Tab = 'appearance' | 'language';

export function Settings({ onClose }: { onClose: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [tab, setTab] = useState<Tab>('appearance');
  const [appearance, setAppearance] = useState<Appearance>('system');

  // 初始化：读取当前外观与「设为默认语言」状态
  useEffect(() => {
    api()
      .getSettings()
      .then((s) => {
        setAppearance(s.appearance);
      })
      .catch(() => {});
  }, []);

  const applyLang = (l: Lang) => {
    setLang(l); // 立即更新界面
    // 选择即持久化，下次启动（含更新后）沿用用户选择
    api().setLanguage(l);
  };

  const applyAppearance = (a: Appearance) => {
    setAppearance(a);
    api().setAppearance(a);
  };

  const appearanceLabel = (a: Appearance) =>
    a === 'light' ? t('themeLight') : a === 'dark' ? t('themeDark') : t('themeSystem');

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('settings')}</h3>

        {/* 两层选项卡：外观 / 语言 */}
        <div className="tab-bar">
          <button className={`tab ${tab === 'appearance' ? 'on' : ''}`} onClick={() => setTab('appearance')}>
            {t('appearance')}
          </button>
          <button className={`tab ${tab === 'language' ? 'on' : ''}`} onClick={() => setTab('language')}>
            {t('language')}
          </button>
        </div>

        {tab === 'appearance' && (
          <div className="setting-row">
            <div className="setting-label">{t('appearance')}</div>
            <div className="lang-seg">
              {APPEARANCES.map((a) => (
                <button
                  key={a}
                  className={`lang-opt ${appearance === a ? 'on' : ''}`}
                  onClick={() => applyAppearance(a)}
                >
                  {appearanceLabel(a)}
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === 'language' && (
          <>
            <div className="setting-row">
              <div className="setting-label">{t('language')}</div>
              <div className="lang-seg lang-seg-wrap">
                {LANGS.map((l) => (
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
          </>
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

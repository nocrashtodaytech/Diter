import React, { useEffect, useState } from 'react';
import { useI18n, langName, LANGS, APPEARANCES, type Lang, type Appearance } from '../i18n';
import { api } from '../api';
import { Check } from './Icons';

type Tab = 'appearance' | 'language';

export function Settings({ onClose }: { onClose: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [tab, setTab] = useState<Tab>('appearance');
  const [appearance, setAppearance] = useState<Appearance>('system');
  const [asDefault, setAsDefault] = useState(false);

  // 初始化：读取当前外观与「设为默认语言」状态
  useEffect(() => {
    api()
      .getSettings()
      .then((s) => {
        setAppearance(s.appearance);
        setAsDefault(s.defaultLanguage);
      })
      .catch(() => {});
  }, []);

  const applyLang = (l: Lang) => {
    setLang(l); // 立即更新界面
    // 无论是否勾选默认，都同步菜单语言；持久化与否由 asDefault 决定
    api().setLanguage(l, { default: asDefault });
  };

  const toggleDefault = () => {
    const next = !asDefault;
    setAsDefault(next);
    // 勾选 → 用当前语言持久化；取消 → 清除已存语言（下次启动恢复默认中文）
    api().setLanguage(lang, { default: next });
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

            <div className="setting-check">
              <div className={`confirm-check ${asDefault ? 'on' : ''}`} onClick={toggleDefault}>
                <span className="box">
                  <Check size={10} style={{ color: '#fff' }} />
                </span>
                <span>{t('setAsDefaultLang')}</span>
              </div>
              <div className="setting-hint">{t('setAsDefaultLangHint')}</div>
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

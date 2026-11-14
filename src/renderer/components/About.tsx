import React from 'react';
import { useI18n, authorName } from '../i18n';
import { Drive, Heart } from './Icons';

const BILIBILI = 'https://space.bilibili.com/314146648';
const DONATE_URL = 'https://afdian.com/order/create?user_id=8a2e6fc6768411f1ac655254001e7c00&remark=&affiliate_code=';

export function About({ version, onClose }: { version: string; onClose: () => void }) {
  const { t, lang } = useI18n();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal about-modal" onClick={(e) => e.stopPropagation()}>
        <div className="about-hero">
          <div className="brand-mark" style={{ width: 52, height: 52, borderRadius: 14 }}>
            <Drive size={28} />
          </div>
          <div>
            <div className="about-name">Diter</div>
            <div className="about-ver">
              {t('version')} {version}
            </div>
          </div>
        </div>

        <p className="about-desc">{t('aboutDesc')}</p>

        <div className="about-meta">
          <div className="about-row">
            <span className="about-k">by</span>
            <span className="about-v">{authorName(lang)}</span>
          </div>
          <div className="about-row">
            <span className="about-k">bilibili</span>
            <a
              className="about-link"
              href={BILIBILI}
              onClick={(e) => {
                e.preventDefault();
                if (window.diter) window.diter.openExternal(BILIBILI);
                else window.open(BILIBILI, '_blank');
              }}
            >
              {BILIBILI}
            </a>
          </div>
        </div>

        <div className="modal-actions">
          <button
            className="btn ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => {
              if (window.diter) window.diter.openDonate();
              else window.open(DONATE_URL, '_blank');
            }}
          >
            <Heart size={15} style={{ color: '#ff5a2b' }} />
            {t('donateAbout')}
          </button>
          <button className="btn primary" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}

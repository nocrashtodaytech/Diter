import React from 'react';
import { useI18n } from '../i18n';
import { Heart } from './Icons';

export function DonateDialog({ onDonate, onClose }: { onDonate: () => void; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal about-modal" onClick={(e) => e.stopPropagation()}>
        <div className="about-hero">
          <div className="brand-mark donate-mark" style={{ width: 52, height: 52, borderRadius: 14 }}>
            <Heart size={28} />
          </div>
          <div>
            <div className="about-name">{t('donateTitle')}</div>
            <div className="about-ver">{t('donateSub')}</div>
          </div>
        </div>

        <p className="about-desc">{t('donateDesc')}</p>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            {t('donateLater')}
          </button>
          <button className="btn primary" onClick={onDonate}>
            {t('donateBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}

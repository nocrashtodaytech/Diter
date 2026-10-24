import React from 'react';

type P = { size?: number; className?: string; style?: React.CSSProperties };

const S = (size = 18) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export const Flame = ({ size = 18, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
    <defs>
      <linearGradient id="fl" x1="4" y1="20" x2="18" y2="4" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FF4D1F" />
        <stop offset="1" stopColor="#FFC24A" />
      </linearGradient>
    </defs>
    <path
      d="M12 2.6c.4 3.1 2.1 4.4 3.7 6.1 1.7 1.8 2.8 3.4 2.8 5.8A6.5 6.5 0 0 1 12 21a6.5 6.5 0 0 1-6.5-6.5c0-2 .9-3.4 2-4.5.2 1.3.9 2.2 1.9 2.6-.3-3.4.6-6.6 2.6-10Z"
      fill="url(#fl)"
    />
    <path d="M12 21a3.2 3.2 0 0 0 3.2-3.2c0-1.6-1.2-2.6-3.2-4.6-1.9 2-3.2 3-3.2 4.6A3.2 3.2 0 0 0 12 21Z" fill="#2A1108" opacity=".45" />
  </svg>
);

export const Usb = ({ size = 18, style }: P) => (
  <svg {...S(size)} style={style}>
    <path d="M12 21V8" />
    <path d="M12 8 8.5 11.5" />
    <path d="M12 12.5 15.5 16" />
    <rect x="9.5" y="2.8" width="5" height="5.2" rx="1.2" />
    <path d="M12 2.8V1.4" />
    <circle cx="7.6" cy="12.2" r="1.1" />
    <circle cx="16.6" cy="16.7" r="1.1" />
    <path d="M10 21h4" />
  </svg>
);

export const Lock = ({ size = 18, style }: P) => (
  <svg {...S(size)} style={style}>
    <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.4" />
    <path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9" />
    <circle cx="12" cy="15.6" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

export const Check = ({ size = 18, style }: P) => (
  <svg {...S(size)} style={style} strokeWidth={2.6}>
    <path d="m4.5 12.6 4.7 4.6L19.5 6.8" />
  </svg>
);

export const Alert = ({ size = 18, style }: P) => (
  <svg {...S(size)} style={style}>
    <path d="M12 3.2 2.9 19.2h18.2L12 3.2Z" />
    <path d="M12 9.4v4.4" />
    <circle cx="12" cy="16.7" r=".9" fill="currentColor" stroke="none" />
  </svg>
);

export const Shield = ({ size = 18, style }: P) => (
  <svg {...S(size)} style={style}>
    <path d="M12 2.8 5 5.6v6.1c0 4.2 2.9 7.6 7 9.5 4.1-1.9 7-5.3 7-9.5V5.6L12 2.8Z" />
    <path d="m9 11.8 2.2 2.2L15.3 9.8" />
  </svg>
);

export const Folder = ({ size = 18, style }: P) => (
  <svg {...S(size)} style={style}>
    <path d="M3.5 7.4a2 2 0 0 1 2-2h3.2l2 2.3h7.8a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V7.4Z" />
  </svg>
);

export const Disc = ({ size = 18, style }: P) => (
  <svg {...S(size)} style={style}>
    <circle cx="12" cy="12" r="8.6" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export const Drive = ({ size = 18, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
    <defs>
      <linearGradient id="drv" x1="5" y1="18" x2="18" y2="6" gradientUnits="userSpaceOnUse">
        <stop stopColor="#0a84ff" />
        <stop offset="1" stopColor="#5ac8fa" />
      </linearGradient>
    </defs>
    <rect x="2.6" y="6.6" width="18.8" height="10.8" rx="2.6" stroke="currentColor" strokeWidth="1.7" />
    <circle cx="7" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="17.2" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="17.2" cy="12" r="0.9" fill="url(#drv)" stroke="none" />
    <path d="M9.4 15.7h4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

export const X = ({ size = 18, style }: P) => (
  <svg {...S(size)} style={style} strokeWidth={2.2}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const Arrow = ({ size = 18, style }: P) => (
  <svg {...S(size)} style={style} strokeWidth={2}>
    <path d="M4.5 12h14M13 6.5l5.5 5.5L13 17.5" />
  </svg>
);

export const Spin = ({ size = 16, className }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".22" strokeWidth="2.4" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

export const Cpu = ({ size = 18, style }: P) => (
  <svg {...S(size)} style={style}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
    <path d="M10 3v3.5M14 3v3.5M10 17.5V21M14 17.5V21M3 10h3.5M3 14h3.5M17.5 10H21M17.5 14H21" />
  </svg>
);

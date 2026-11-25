import React from 'react';

interface BrandLogoProps {
  size?: number;
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 32, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mikan-shell" x1="4" y1="3" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF9E4F" />
          <stop offset="52%" stopColor="#FF7A2F" />
          <stop offset="100%" stopColor="#D94E0F" />
        </linearGradient>
        <linearGradient id="mikan-leaf" x1="20" y1="3" x2="29" y2="11" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4ADE80" />
          <stop offset="100%" stopColor="#16A34A" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="11" fill="url(#mikan-shell)" />
      <rect
        x="2.5"
        y="2.5"
        width="35"
        height="35"
        rx="10.5"
        stroke="white"
        strokeOpacity="0.24"
      />
      {/* Subtle citrus segments ring */}
      <circle cx="20" cy="21" r="11" stroke="#0B0D11" strokeOpacity="0.22" strokeWidth="1.5" />
      {/* Cinema play aperture */}
      <path
        d="M16.6 15.4C16.6 14.52 17.56 13.98 18.31 14.44L26.52 19.44C27.24 19.88 27.24 20.92 26.52 21.36L18.31 26.36C17.56 26.82 16.6 26.28 16.6 25.4V15.4Z"
        fill="#0B0D11"
      />
      {/* Tiny citrus leaf accent */}
      <path
        d="M21 7.2C23.4 4.8 27.3 5 28.4 6.6C26.9 9 23.2 9.4 21 7.2Z"
        fill="url(#mikan-leaf)"
      />
    </svg>
  );
};

import React from 'react';

interface TagBadgeProps {
  label: string;
  size?: 'xs' | 'sm';
}

function getTagStyle(label: string): string {
  const upper = label.toUpperCase();
  if (upper.includes('4K') || upper.includes('2160')) {
    return 'bg-amber-500/15 text-amber-300 border-amber-400/25';
  }
  if (upper.includes('1080')) {
    return 'bg-sky-500/14 text-sky-300 border-sky-400/25';
  }
  if (upper.includes('HEVC') || upper.includes('X265') || upper.includes('10BIT')) {
    return 'bg-teal-500/14 text-teal-300 border-teal-400/25';
  }
  if (upper.includes('BDRIP') || upper.includes('BLU')) {
    return 'bg-orange-500/15 text-orange-300 border-orange-400/25';
  }
  if (
    label.includes('简') ||
    label.includes('繁') ||
    upper.includes('CHS') ||
    upper.includes('CHT')
  ) {
    return 'bg-emerald-500/14 text-emerald-300 border-emerald-400/25';
  }
  return 'bg-white/[0.05] text-slate-300 border-white/[0.09]';
}

export const TagBadge: React.FC<TagBadgeProps> = ({ label, size = 'xs' }) => {
  const style = getTagStyle(label);
  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-[10.5px]' : 'px-2 py-0.5 text-[11px]';
  return (
    <span
      className={`inline-flex items-center rounded-md border font-medium leading-none tracking-wide ${pad} ${style}`}
    >
      {label}
    </span>
  );
};

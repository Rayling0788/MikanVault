import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useProxiedImage } from '@/hooks/useProxiedImage';

const FALLBACK_PALETTES = [
  { darkA: '#1E293B', darkB: '#0F172A', lightA: '#FFF3EB', lightB: '#E7EFFC', accent: '#F97316' },
  { darkA: '#2A1B16', darkB: '#110D10', lightA: '#FFEDE2', lightB: '#FCE7F3', accent: '#EA580C' },
  { darkA: '#122732', darkB: '#0A1319', lightA: '#E6F5FF', lightB: '#E9EDFE', accent: '#0284C7' },
  { darkA: '#152922', darkB: '#0B1411', lightA: '#E7FAF2', lightB: '#E8F3FF', accent: '#059669' },
  { darkA: '#272017', darkB: '#110F0B', lightA: '#FEF3C7', lightB: '#FDEEE5', accent: '#D97706' },
  { darkA: '#2B1821', darkB: '#110C10', lightA: '#FCE7F3', lightB: '#EDE9FE', accent: '#E11D48' },
];

function hashTitle(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i += 1) {
    h = (h * 31 + title.charCodeAt(i)) >>> 0;
  }
  return h;
}

interface PosterImageProps {
  url?: string;
  title: string;
  className?: string;
  imgClassName?: string;
  compactFallback?: boolean;
}

export const PosterImage: React.FC<PosterImageProps> = React.memo(({
  url,
  title,
  className = '',
  imgClassName = '',
  compactFallback = false,
}) => {
  const { src, loading, failed } = useProxiedImage(url);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgError, setImgError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setImgError(false);
    if (src && imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    } else {
      setLoaded(false);
    }
  }, [src]);

  const palette = useMemo(() => {
    const idx = hashTitle(title || 'MikanVault') % FALLBACK_PALETTES.length;
    return FALLBACK_PALETTES[idx];
  }, [title]);

  const initials = useMemo(() => {
    const clean = (title || 'MV').replace(/^\[[^\]]+\]\s*/, '').trim();
    return clean.slice(0, 2).toUpperCase();
  }, [title]);

  const showFallback = !url || failed || imgError || (!loading && !src);

  return (
    <div className={`poster-surface relative overflow-hidden ${className}`}>
      {(loading || (!loaded && !showFallback)) && (
        <div className="skeleton-shimmer absolute inset-0" />
      )}

      {!showFallback && src && (
        <img
          ref={imgRef}
          src={src}
          alt={title}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setImgError(true)}
          className={`h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          } ${imgClassName}`}
        />
      )}

      {showFallback && (
        <div
          className="poster-fallback-card relative flex h-full w-full flex-col justify-between p-3.5 select-none"
          style={
            {
              '--pf-dark-a': palette.darkA,
              '--pf-dark-b': palette.darkB,
              '--pf-light-a': palette.lightA,
              '--pf-light-b': palette.lightB,
            } as React.CSSProperties
          }
        >
          <div
            className="pointer-events-none absolute -top-8 -right-8 h-28 w-28 rounded-full opacity-22 blur-xl"
            style={{ backgroundColor: palette.accent }}
          />
          <div
            className="pointer-events-none absolute bottom-10 -left-6 h-20 w-20 rounded-full border opacity-22"
            style={{ borderColor: palette.accent }}
          />
          {!compactFallback && (
            <div className="poster-fallback-brand text-[10px] font-medium tracking-[0.2em] uppercase">
              MIKANVAULT
            </div>
          )}
          <div className="my-auto flex items-center justify-center">
            <span
              className={`font-bold tracking-tight ${compactFallback ? 'text-base' : 'text-3xl'}`}
              style={{ color: palette.accent }}
            >
              {initials}
            </span>
          </div>
          {!compactFallback && (
            <div className="line-clamp-2 text-[11px] font-medium leading-snug">
              {title}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

PosterImage.displayName = 'PosterImage';

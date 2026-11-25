import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useProxiedImage } from '@/hooks/useProxiedImage';

const FALLBACK_PALETTES = [
  ['#1E293B', '#0F172A', '#FF7A2F'],
  ['#2A1B16', '#110D10', '#FB923C'],
  ['#122732', '#0A1319', '#38BDF8'],
  ['#152922', '#0B1411', '#22C55E'],
  ['#272017', '#110F0B', '#F59E0B'],
  ['#2B1821', '#110C10', '#FB7185'],
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

export const PosterImage: React.FC<PosterImageProps> = ({
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
    <div className={`relative overflow-hidden bg-[#151923] ${className}`}>
      {loading && !src && <div className="skeleton-shimmer absolute inset-0" />}

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
          className="relative flex h-full w-full flex-col justify-between p-3.5 select-none"
          style={{
            background: `linear-gradient(145deg, ${palette[0]} 0%, ${palette[1]} 100%)`,
          }}
        >
          <div
            className="pointer-events-none absolute -top-8 -right-8 h-28 w-28 rounded-full opacity-20 blur-xl"
            style={{ backgroundColor: palette[2] }}
          />
          <div
            className="pointer-events-none absolute bottom-10 -left-6 h-20 w-20 rounded-full border opacity-20"
            style={{ borderColor: palette[2] }}
          />
          {!compactFallback && (
            <div className="text-[10px] font-medium tracking-[0.2em] text-white/45 uppercase">
              MIKANVAULT
            </div>
          )}
          <div className="my-auto flex items-center justify-center">
            <span
              className={`font-bold tracking-tight ${compactFallback ? 'text-base' : 'text-3xl'}`}
              style={{ color: palette[2] }}
            >
              {initials}
            </span>
          </div>
          {!compactFallback && (
            <div className="line-clamp-2 text-[11px] font-medium text-white/70 leading-snug">
              {title}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

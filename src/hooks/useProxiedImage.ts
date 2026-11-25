import { useEffect, useState } from 'react';
import { getCachedImage, resolveProxiedImage } from '@/lib/imageCache';

export function useProxiedImage(url?: string): {
  src: string;
  loading: boolean;
  failed: boolean;
} {
  const initial = url ? getCachedImage(url) || '' : '';
  const [src, setSrc] = useState<string>(initial);
  const [loading, setLoading] = useState<boolean>(Boolean(url && !initial));
  const [failed, setFailed] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    if (!url) {
      setSrc('');
      setLoading(false);
      setFailed(false);
      return;
    }

    const cached = getCachedImage(url);
    if (cached) {
      setSrc(cached);
      setLoading(false);
      setFailed(false);
      return;
    }

    setSrc('');
    setLoading(true);
    setFailed(false);

    resolveProxiedImage(url).then((resolved) => {
      if (cancelled) return;
      if (resolved) {
        setSrc(resolved);
        setFailed(false);
      } else {
        setSrc('');
        setFailed(true);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { src, loading, failed };
}

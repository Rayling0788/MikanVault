import { api, isElectronRuntime } from './api';

const MAX_CACHE_ENTRIES = 160;
const resolvedCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

function setBoundedCache(key: string, value: string): void {
  if (resolvedCache.has(key)) {
    resolvedCache.delete(key);
  } else if (resolvedCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = resolvedCache.keys().next().value;
    if (oldestKey !== undefined) {
      resolvedCache.delete(oldestKey);
    }
  }
  resolvedCache.set(key, value);
}

export function toMikanImgUrl(url: string): string {
  return `mikan-img://proxy?url=${encodeURIComponent(url)}`;
}

function isDirectImageUrl(url: string): boolean {
  return (
    url.startsWith('data:') ||
    url.startsWith('mikan-img://') ||
    url.startsWith('blob:')
  );
}

// Limit concurrent fallback IPC image proxy requests when needed
const MAX_CONCURRENT = 8;
let activeCount = 0;
const queue: Array<() => void> = [];

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeCount += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeCount -= 1;
          const next = queue.shift();
          if (next) next();
        });
    };
    if (activeCount < MAX_CONCURRENT) {
      run();
    } else {
      queue.push(run);
    }
  });
}

export function getCachedImage(url: string): string | undefined {
  if (!url) return undefined;
  if (isDirectImageUrl(url)) {
    return url;
  }
  if (isElectronRuntime && (url.startsWith('http://') || url.startsWith('https://'))) {
    return toMikanImgUrl(url);
  }
  return resolvedCache.get(url);
}

export function resolveProxiedImage(url: string): Promise<string> {
  if (!url) return Promise.resolve('');
  if (isDirectImageUrl(url)) {
    return Promise.resolve(url);
  }
  if (isElectronRuntime && (url.startsWith('http://') || url.startsWith('https://'))) {
    return Promise.resolve(toMikanImgUrl(url));
  }
  const cached = resolvedCache.get(url);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }
  const existing = inFlight.get(url);
  if (existing) {
    return existing;
  }

  const promise = enqueue(async () => {
    try {
      if (!isElectronRuntime) {
        setBoundedCache(url, url);
        return url;
      }
      const dataUrl = await api.proxyImage(url);
      if (dataUrl) {
        setBoundedCache(url, dataUrl);
        return dataUrl;
      }
      return '';
    } catch {
      return '';
    } finally {
      inFlight.delete(url);
    }
  });

  inFlight.set(url, promise);
  return promise;
}

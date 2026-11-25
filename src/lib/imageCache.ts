import { api, isElectronRuntime } from './api';

const resolvedCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

// Limit concurrent IPC image proxy requests so large walls stay buttery smooth
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
  if (url.startsWith('data:') || url.startsWith('mikan-img://') || url.startsWith('blob:')) {
    return url;
  }
  return resolvedCache.get(url);
}

export function resolveProxiedImage(url: string): Promise<string> {
  if (!url) return Promise.resolve('');
  if (url.startsWith('data:') || url.startsWith('mikan-img://') || url.startsWith('blob:')) {
    return Promise.resolve(url);
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
        resolvedCache.set(url, url);
        return url;
      }
      const dataUrl = await api.proxyImage(url);
      if (dataUrl) {
        resolvedCache.set(url, dataUrl);
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

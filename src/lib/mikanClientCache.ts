import type {
  MikanBangumiDetail,
  MikanRelease,
  MikanScheduleResponse,
} from '@shared/types';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const SCHEDULE_TTL_MS = 5 * 60_000;
const BANGUMI_TTL_MS = 3 * 60_000;
const RSS_TTL_MS = 2 * 60_000;

const scheduleCache = new Map<string, CacheEntry<MikanScheduleResponse>>();
const bangumiCache = new Map<string, CacheEntry<MikanBangumiDetail>>();
const rssCache = new Map<string, CacheEntry<MikanRelease[]>>();

function readEntry<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function writeEntry<T>(
  map: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxEntries: number,
): void {
  if (map.has(key)) {
    map.delete(key);
  } else if (map.size >= maxEntries) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function getScheduleCacheKey(year?: number, season?: string): string {
  return year !== undefined && season !== undefined ? `${year}-${season}` : 'current';
}

export function getCachedSchedule(key: string): MikanScheduleResponse | null {
  return readEntry(scheduleCache, key);
}

export function setCachedSchedule(key: string, data: MikanScheduleResponse): void {
  writeEntry(scheduleCache, key, data, SCHEDULE_TTL_MS, 12);
}

export function getCachedBangumiDetail(id: string): MikanBangumiDetail | null {
  return readEntry(bangumiCache, id);
}

export function setCachedBangumiDetail(id: string, detail: MikanBangumiDetail): void {
  writeEntry(bangumiCache, id, detail, BANGUMI_TTL_MS, 40);
}

export function getCachedRssFeed(key: string): MikanRelease[] | null {
  return readEntry(rssCache, key);
}

export function setCachedRssFeed(key: string, releases: MikanRelease[]): void {
  writeEntry(rssCache, key, releases, RSS_TTL_MS, 12);
}

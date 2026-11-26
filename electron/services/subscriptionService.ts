import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ActionResult,
  AddDownloadRequest,
  AddDownloadResult,
  LocalProgressHint,
  MikanRelease,
  QbConnectionStatus,
  QbLaunchResult,
  QbTorrentItem,
  SubscriptionCheckSummary,
  SubscriptionItem,
  SubscriptionLogEntry,
  UpsertSubscriptionRequest,
} from '../../src/shared/types';
import { IPC_CHANNELS } from '../../src/shared/types';
import { matchesSubtitleLanguage } from '../../src/shared/subtitleLanguage';
import {
  appendSubscriptionLog,
  getSettings,
  getSubscriptionLogs,
  getSubscriptions,
  normalizePathKey,
  saveSubscriptions,
} from './configStore';
import { isVideoFile, parseEpisodeNumber, scanLibrary } from './libraryService';
import { extractSubgroupFromTitle, getRssFeed } from './mikanService';
import {
  addDownload,
  getTorrents,
  launchQbittorrent,
  sanitizeFolderName,
  testConnection,
} from './qbService';

export interface SubscriptionCheckDeps {
  fetchRss?: (rssUrl: string) => Promise<MikanRelease[]>;
  addDownloadFn?: (req: AddDownloadRequest) => Promise<AddDownloadResult>;
  getTorrentsFn?: () => Promise<QbTorrentItem[]>;
  testConnFn?: () => Promise<QbConnectionStatus>;
  launchQbFn?: () => Promise<QbLaunchResult>;
  notifyFn?: (title: string, body: string) => void;
}

let bootTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let checkingLock = false;

function broadcastSubscriptionsUpdated(): void {
  if (!process.versions?.electron) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron');
    for (const win of electron.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SUB_UPDATED_EVENT);
      }
    }
  } catch {
    // Ignore broadcast errors outside Electron window
  }
}

function defaultNotify(title: string, body: string): void {
  if (!process.versions?.electron) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron');
    if (electron.Notification?.isSupported()) {
      new electron.Notification({ title, body }).show();
    }
  } catch {
    // Ignore notification errors
  }
}

function collectLocalEpisodeNumbers(dirPath: string): {
  episodeNumbers: Set<number>;
  maxEpisodeNumber: number;
  episodeCount: number;
  detectedSubgroup?: string;
} {
  const episodeNumbers = new Set<number>();
  let maxEpisodeNumber = 0;
  let episodeCount = 0;
  let detectedSubgroup: string | undefined;

  if (!dirPath || !fs.existsSync(dirPath)) {
    return { episodeNumbers, maxEpisodeNumber, episodeCount };
  }

  const walk = (current: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && isVideoFile(entry.name)) {
        episodeCount += 1;
        if (!detectedSubgroup) {
          detectedSubgroup = extractSubgroupFromTitle(entry.name);
        }
        const epNum = parseEpisodeNumber(entry.name);
        if (epNum !== undefined) {
          episodeNumbers.add(epNum);
          if (epNum > maxEpisodeNumber) {
            maxEpisodeNumber = epNum;
          }
        }
      }
    }
  };

  walk(dirPath, 0);
  return { episodeNumbers, maxEpisodeNumber, episodeCount, detectedSubgroup };
}

function normalizeTitleKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\-_·:：/\\()（）\[\]【】!！?？.,，。'"`]/g, '');
}

export async function detectLocalProgress(
  bangumiId: string,
  bangumiTitle: string,
  preferredSavePath?: string,
): Promise<LocalProgressHint> {
  if (preferredSavePath && fs.existsSync(preferredSavePath)) {
    const local = collectLocalEpisodeNumbers(preferredSavePath);
    if (local.episodeCount > 0) {
      return {
        savePath: preferredSavePath,
        maxEpisodeNumber: local.maxEpisodeNumber > 0 ? local.maxEpisodeNumber : local.episodeCount,
        episodeCount: local.episodeCount,
        detectedSubgroup: local.detectedSubgroup,
      };
    }
  }

  try {
    const seriesList = await scanLibrary();
    const normTitle = normalizeTitleKey(bangumiTitle);
    const matched = seriesList.find((s) => {
      if (bangumiId && s.bangumiId === bangumiId) return true;
      if (preferredSavePath && normalizePathKey(s.folderPath) === normalizePathKey(preferredSavePath)) {
        return true;
      }
      if (!normTitle) return false;
      const sNorm = normalizeTitleKey(s.title);
      return sNorm === normTitle || sNorm.includes(normTitle) || normTitle.includes(sNorm);
    });

    if (matched) {
      let maxEp = 0;
      let detectedSubgroup: string | undefined;
      for (const ep of matched.episodes) {
        if (ep.episodeNumber !== undefined && ep.episodeNumber > maxEp) {
          maxEp = ep.episodeNumber;
        }
        if (!detectedSubgroup) {
          detectedSubgroup = extractSubgroupFromTitle(ep.fileName);
        }
      }
      return {
        savePath: matched.folderPath,
        maxEpisodeNumber: maxEp > 0 ? maxEp : matched.totalEpisodes,
        episodeCount: matched.totalEpisodes,
        detectedSubgroup,
      };
    }
  } catch {
    // Ignore scan failure and fall back to default path
  }

  const settings = getSettings();
  return {
    savePath:
      preferredSavePath?.trim() ||
      path.join(settings.downloadRootDir, sanitizeFolderName(bangumiTitle || `Bangumi-${bangumiId}`)),
    maxEpisodeNumber: 0,
    episodeCount: 0,
  };
}

export function matchesSubscriptionKeywords(
  title: string,
  includeKeywords?: string,
  excludeKeywords?: string,
): boolean {
  const lower = title.toLowerCase();

  if (includeKeywords?.trim()) {
    const tokens = includeKeywords
      .split(/[,，\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    for (const token of tokens) {
      if (!lower.includes(token)) {
        return false;
      }
    }
  }

  if (excludeKeywords?.trim()) {
    const tokens = excludeKeywords
      .split(/[,，\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    for (const token of tokens) {
      if (lower.includes(token)) {
        return false;
      }
    }
  }

  return true;
}

export function listSubscriptions(): SubscriptionItem[] {
  return getSubscriptions().sort((a, b) => b.createdAt - a.createdAt);
}

export function getSubscriptionLogsList(): SubscriptionLogEntry[] {
  return getSubscriptionLogs();
}

export function upsertSubscription(req: UpsertSubscriptionRequest): SubscriptionItem {
  const settings = getSettings();
  const list = getSubscriptions();
  const id = req.id?.trim() || `${req.bangumiId}:${req.subgroupId}`;
  const existingIdx = list.findIndex((s) => s.id === id);
  const existing = existingIdx >= 0 ? list[existingIdx] : undefined;

  const mergedSkipped = new Set<string>(existing?.downloadedReleaseIds || []);
  for (const rid of req.initialSkipReleaseIds || []) {
    if (rid) mergedSkipped.add(rid);
  }

  const safeStartAfter =
    typeof req.startAfterEpisode === 'number' && Number.isFinite(req.startAfterEpisode)
      ? Math.max(0, req.startAfterEpisode)
      : 0;

  const savePath =
    req.savePath?.trim() ||
    path.join(settings.downloadRootDir, sanitizeFolderName(req.bangumiTitle));

  const nextItem: SubscriptionItem = {
    id,
    bangumiId: req.bangumiId.trim(),
    bangumiTitle: req.bangumiTitle.trim(),
    coverUrl: req.coverUrl ?? existing?.coverUrl,
    subgroupId: req.subgroupId.trim(),
    subgroupName: req.subgroupName.trim(),
    rssUrl: req.rssUrl.trim(),
    savePath,
    category: req.category?.trim() || existing?.category || settings.qbCategory || 'MikanVault',
    startAfterEpisode: safeStartAfter,
    languageFilter:
      req.languageFilter === undefined
        ? existing?.languageFilter
        : req.languageFilter === 'all'
          ? undefined
          : req.languageFilter,
    includeKeywords: req.includeKeywords?.trim() || undefined,
    excludeKeywords: req.excludeKeywords?.trim() || undefined,
    cloudTargetDir: req.cloudTargetDir?.trim() || undefined,
    deleteLocalAfterCloudMove:
      req.deleteLocalAfterCloudMove ?? existing?.deleteLocalAfterCloudMove ?? true,
    enabled: req.enabled ?? existing?.enabled ?? true,
    downloadedReleaseIds: Array.from(mergedSkipped),
    lastDownloadedEpisode: existing?.lastDownloadedEpisode,
    createdAt: existing?.createdAt ?? Date.now(),
    lastCheckedAt: existing?.lastCheckedAt,
    lastTriggeredAt: existing?.lastTriggeredAt,
    lastError: undefined,
    totalAutoDownloaded: existing?.totalAutoDownloaded ?? 0,
  };

  if (existingIdx >= 0) {
    list[existingIdx] = nextItem;
  } else {
    list.unshift(nextItem);
  }
  saveSubscriptions(list);
  broadcastSubscriptionsUpdated();
  return nextItem;
}

export function deleteSubscription(id: string): ActionResult {
  const list = getSubscriptions();
  const next = list.filter((s) => s.id !== id);
  saveSubscriptions(next);
  broadcastSubscriptionsUpdated();
  return { ok: true };
}

function getReleaseOrderKey(rel: MikanRelease): { ep: number; time: number } {
  const ep = parseEpisodeNumber(rel.title) ?? Number.MAX_SAFE_INTEGER;
  const parsedTime = Date.parse(rel.pubDate || '');
  return {
    ep,
    time: Number.isFinite(parsedTime) ? parsedTime : 0,
  };
}

function extractReleaseHash(rel: MikanRelease): string | undefined {
  if (rel.magnetUrl) {
    const m = rel.magnetUrl.match(/btih:([a-fA-F0-9]{40})/i);
    if (m) return m[1].toLowerCase();
  }
  if (rel.torrentUrl) {
    const m = rel.torrentUrl.match(/\/([a-fA-F0-9]{40})\.torrent/i);
    if (m) return m[1].toLowerCase();
  }
  if (/^[a-fA-F0-9]{40}$/.test(rel.id)) {
    return rel.id.toLowerCase();
  }
  return undefined;
}

export async function checkSingleSubscription(
  sub: SubscriptionItem,
  deps: SubscriptionCheckDeps = {},
): Promise<{ updated: SubscriptionItem; added: number; error?: string }> {
  const fetchRss = deps.fetchRss ?? ((url: string) => getRssFeed(url));
  const addDownloadFn = deps.addDownloadFn ?? ((req: AddDownloadRequest) => addDownload(req));
  const getTorrentsFn = deps.getTorrentsFn ?? (() => getTorrents());
  const testConnFn = deps.testConnFn ?? (() => testConnection());
  const launchQbFn = deps.launchQbFn ?? (() => launchQbittorrent());
  const notifyFn = deps.notifyFn ?? defaultNotify;

  const now = Date.now();
  const updated: SubscriptionItem = {
    ...sub,
    downloadedReleaseIds: [...sub.downloadedReleaseIds],
    lastCheckedAt: now,
  };

  try {
    const releases = await fetchRss(sub.rssUrl);
    const localInfo = collectLocalEpisodeNumbers(sub.savePath);
    const seenIds = new Set(updated.downloadedReleaseIds);

    let activeHashes = new Set<string>();
    try {
      const torrents = await getTorrentsFn();
      activeHashes = new Set(torrents.map((t) => t.hash.toLowerCase()));
    } catch {
      // Ignore if qB is offline during pre-check
    }

    const candidates = releases
      .map((rel) => ({
        rel,
        epNum: parseEpisodeNumber(rel.title),
        hash: extractReleaseHash(rel),
      }))
      .filter(({ rel, epNum, hash }) => {
        if (seenIds.has(rel.id)) return false;
        if (hash && activeHashes.has(hash)) {
          // Already present in qBittorrent -> remember as seen without re-adding
          seenIds.add(rel.id);
          return false;
        }
        if (epNum !== undefined) {
          if (epNum <= sub.startAfterEpisode) return false;
          if (localInfo.episodeNumbers.has(epNum)) return false;
        }
        if (!matchesSubtitleLanguage(rel.title, sub.languageFilter)) {
          return false;
        }
        if (!matchesSubscriptionKeywords(rel.title, sub.includeKeywords, sub.excludeKeywords)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const ka = getReleaseOrderKey(a.rel);
        const kb = getReleaseOrderKey(b.rel);
        if (ka.ep !== kb.ep) return ka.ep - kb.ep;
        return ka.time - kb.time;
      });

    updated.downloadedReleaseIds = Array.from(seenIds);

    if (candidates.length === 0) {
      updated.lastError = undefined;
      return { updated, added: 0 };
    }

    // Ensure qBittorrent is reachable; optionally auto-launch if configured
    let conn = await testConnFn();
    if (!conn.connected && getSettings().subscriptionAutoLaunchQb) {
      const launched = await launchQbFn();
      if (launched.ok) {
        for (const delay of [1200, 2000]) {
          await new Promise((r) => setTimeout(r, delay));
          conn = await testConnFn();
          if (conn.connected) break;
        }
      }
    }

    if (!conn.connected) {
      const errMsg = conn.error || 'qBittorrent 未连接，等待下次检查自动重试';
      updated.lastError = errMsg;
      appendSubscriptionLog({
        id: crypto.randomBytes(6).toString('hex'),
        subscriptionId: sub.id,
        bangumiTitle: sub.bangumiTitle,
        releaseTitle: candidates[0].rel.title,
        episodeNumber: candidates[0].epNum,
        ok: false,
        message: errMsg,
        timestamp: Date.now(),
      });
      return { updated, added: 0, error: errMsg };
    }

    let added = 0;
    let lastErr: string | undefined;
    const pushedEpisodesInRun = new Set<number>();

    for (const { rel, epNum } of candidates) {
      if (epNum !== undefined && pushedEpisodesInRun.has(epNum)) {
        seenIds.add(rel.id);
        updated.downloadedReleaseIds = Array.from(seenIds);
        continue;
      }

      const res = await addDownloadFn({
        torrentUrl: rel.torrentUrl,
        magnetUrl: rel.magnetUrl,
        title: rel.title,
        bangumiId: sub.bangumiId,
        bangumiTitle: sub.bangumiTitle,
        coverUrl: sub.coverUrl,
        subgroup: sub.subgroupName,
        savePath: sub.savePath,
        category: sub.category,
        cloudTargetDir: sub.cloudTargetDir,
        deleteLocalAfterCloudMove: sub.deleteLocalAfterCloudMove,
      });

      if (res.ok) {
        added += 1;
        seenIds.add(rel.id);
        updated.downloadedReleaseIds = Array.from(seenIds);
        updated.totalAutoDownloaded += 1;
        updated.lastTriggeredAt = Date.now();
        if (epNum !== undefined) {
          pushedEpisodesInRun.add(epNum);
          updated.lastDownloadedEpisode = Math.max(updated.lastDownloadedEpisode ?? 0, epNum);
        }
        appendSubscriptionLog({
          id: crypto.randomBytes(6).toString('hex'),
          subscriptionId: sub.id,
          bangumiTitle: sub.bangumiTitle,
          releaseTitle: rel.title,
          episodeNumber: epNum,
          ok: true,
          message: `已自动推送至 qBittorrent（保存至 ${res.savePath}）`,
          timestamp: Date.now(),
        });
      } else {
        lastErr = res.error || '发送种子到 qBittorrent 失败';
        appendSubscriptionLog({
          id: crypto.randomBytes(6).toString('hex'),
          subscriptionId: sub.id,
          bangumiTitle: sub.bangumiTitle,
          releaseTitle: rel.title,
          episodeNumber: epNum,
          ok: false,
          message: lastErr,
          timestamp: Date.now(),
        });
      }
    }

    updated.lastError = lastErr;
    if (added > 0) {
      notifyFn(
        `MikanVault 自动追更 · ${sub.bangumiTitle}`,
        `已自动添加 ${added} 集新资源到 qBittorrent 下载队列`,
      );
    }

    return { updated, added, error: lastErr };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : '检查 RSS 更新失败';
    updated.lastError = errMsg;
    appendSubscriptionLog({
      id: crypto.randomBytes(6).toString('hex'),
      subscriptionId: sub.id,
      bangumiTitle: sub.bangumiTitle,
      releaseTitle: sub.rssUrl,
      ok: false,
      message: errMsg,
      timestamp: Date.now(),
    });
    return { updated, added: 0, error: errMsg };
  }
}

export async function checkSubscriptions(
  subscriptionId?: string,
  deps: SubscriptionCheckDeps = {},
): Promise<SubscriptionCheckSummary> {
  if (checkingLock) {
    return { checkedCount: 0, newDownloads: 0, errors: 0, items: [] };
  }
  checkingLock = true;

  try {
    const list = getSubscriptions();
    const targets = subscriptionId
      ? list.filter((s) => s.id === subscriptionId)
      : list.filter((s) => s.enabled);

    const summaryItems: SubscriptionCheckSummary['items'] = [];
    const updatedById = new Map<string, SubscriptionItem>();
    let newDownloads = 0;
    let errors = 0;

    for (const sub of targets) {
      const { updated, added, error } = await checkSingleSubscription(sub, deps);
      updatedById.set(sub.id, updated);
      newDownloads += added;
      if (error) errors += 1;
      summaryItems.push({
        subscriptionId: sub.id,
        bangumiTitle: sub.bangumiTitle,
        added,
        error,
      });
    }

    // Re-read store before saving so user edits/additions/deletions made during async RSS checks are never overwritten
    const latestList = getSubscriptions();
    const mergedList = latestList.map((current) => {
      const checked = updatedById.get(current.id);
      if (!checked) return current;
      const mergedDownloaded = Array.from(
        new Set([...current.downloadedReleaseIds, ...checked.downloadedReleaseIds]),
      );
      return {
        ...current,
        downloadedReleaseIds: mergedDownloaded,
        totalAutoDownloaded: Math.max(current.totalAutoDownloaded, checked.totalAutoDownloaded),
        lastDownloadedEpisode:
          checked.lastDownloadedEpisode !== undefined
            ? Math.max(current.lastDownloadedEpisode ?? 0, checked.lastDownloadedEpisode)
            : current.lastDownloadedEpisode,
        lastTriggeredAt:
          checked.lastTriggeredAt !== undefined
            ? Math.max(current.lastTriggeredAt ?? 0, checked.lastTriggeredAt)
            : current.lastTriggeredAt,
        lastCheckedAt: checked.lastCheckedAt,
        lastError: checked.lastError,
      };
    });

    saveSubscriptions(mergedList);
    broadcastSubscriptionsUpdated();

    return {
      checkedCount: targets.length,
      newDownloads,
      errors,
      items: summaryItems,
    };
  } finally {
    checkingLock = false;
  }
}

export function startSubscriptionScheduler(): void {
  stopSubscriptionScheduler();
  const intervalMin = Math.min(1440, Math.max(5, getSettings().subscriptionCheckIntervalMin || 15));

  bootTimer = setTimeout(() => {
    const hasEnabled = getSubscriptions().some((s) => s.enabled);
    if (hasEnabled) {
      void checkSubscriptions();
    }
  }, 15_000);

  pollTimer = setInterval(() => {
    const hasEnabled = getSubscriptions().some((s) => s.enabled);
    if (hasEnabled) {
      void checkSubscriptions();
    }
  }, intervalMin * 60_000);
}

export function restartSubscriptionScheduler(): void {
  startSubscriptionScheduler();
}

export function stopSubscriptionScheduler(): void {
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ActionResult,
  LibraryEpisode,
  LibraryRemoveEpisodeRequest,
  LibraryRemoveSeriesRequest,
  LibraryScrapeAllResult,
  LibraryScrapeSeriesRequest,
  LibraryScrapeSeriesResult,
  LibrarySeries,
  MikanBangumiCard,
} from '../../src/shared/types';
import {
  deleteSeriesMeta,
  findSeriesMetaByTitle,
  getHiddenCount,
  getSeriesMeta,
  getSeriesMetaById,
  getSettings,
  getWatchedRecord,
  hideFilePath,
  hideSeries,
  isFileHidden,
  isSeriesHidden,
  normalizePathKey,
  restoreAllHidden,
  setSeriesMeta,
  setWatchedRecord,
} from './configStore';
import {
  extractReleaseTags,
  extractSubgroupFromTitle,
  getBangumiDetail,
  searchMikan,
  type FetchLike,
} from './mikanService';

export const VIDEO_EXTENSIONS = new Set([
  '.mkv',
  '.mp4',
  '.avi',
  '.mov',
  '.webm',
  '.flv',
  '.ts',
  '.m2ts',
]);

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '$recycle.bin',
  'system volume information',
]);

const MAX_SCAN_DEPTH = 5;

function getElectronShell(): typeof import('electron').shell | null {
  if (!process.versions?.electron) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron');
    return electron?.shell ?? null;
  } catch {
    return null;
  }
}

export function isVideoFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

export function extractResolution(name: string): string | undefined {
  if (/\b(?:2160p|4K|3840x2160|UHD)\b/i.test(name)) return '4K';
  if (/\b(?:1080p|1920x1080|FHD)\b/i.test(name)) return '1080P';
  if (/\b(?:720p|1280x720)\b/i.test(name)) return '720P';
  if (/\b480p\b/i.test(name)) return '480P';
  return undefined;
}

function isLikelyFalseEpisodeNumber(num: number): boolean {
  if (!Number.isFinite(num) || num < 0) return true;
  // Filter common resolutions and years
  if (num === 480 || num === 720 || num === 1080 || num === 2160 || num === 264 || num === 265) {
    return true;
  }
  if (num >= 1980 && num <= 2099) {
    return true;
  }
  return false;
}

export function parseEpisodeNumber(fileName: string): number | undefined {
  const base = path.parse(fileName).name;

  // 1. Chinese explicit episode indicator: 第01话 / 第 12 集 / 第03回
  const cnMatch = base.match(/第\s*(\d{1,4}(?:\.\d)?)\s*[话話集回]/);
  if (cnMatch) {
    const val = Number.parseFloat(cnMatch[1]);
    if (!isLikelyFalseEpisodeNumber(val)) return val;
  }

  // 2. S01E05 / E05 / EP05
  const seMatch = base.match(/(?:^|[\s._\-\[\(])(?:S\d{1,2})?(?:EP|E)\s*(\d{1,4}(?:\.\d)?)(?!\d)/i);
  if (seMatch) {
    const val = Number.parseFloat(seMatch[1]);
    if (!isLikelyFalseEpisodeNumber(val)) return val;
  }

  // 3. Fansub standard dash separator: " - 05 " / " - 12v2 "
  const dashMatch = base.match(/\s-\s(\d{1,4}(?:\.\d)?)(?:v\d)?(?=$|[\s\[\(._\-]|END)/i);
  if (dashMatch) {
    const val = Number.parseFloat(dashMatch[1]);
    if (!isLikelyFalseEpisodeNumber(val)) return val;
  }

  // 4. Bracketed episode number: [05] / [12v2] / 【08】
  const bracketRegex = /[\[【](\d{1,4}(?:\.\d)?)(?:v\d)?[\]】]/gi;
  let bMatch: RegExpExecArray | null;
  while ((bMatch = bracketRegex.exec(base)) !== null) {
    const val = Number.parseFloat(bMatch[1]);
    if (!isLikelyFalseEpisodeNumber(val)) return val;
  }

  // 5. Hash notation: #05
  const hashMatch = base.match(/#(\d{1,4}(?:\.\d)?)(?!\d)/);
  if (hashMatch) {
    const val = Number.parseFloat(hashMatch[1]);
    if (!isLikelyFalseEpisodeNumber(val)) return val;
  }

  return undefined;
}

export function cleanSeriesTitleFromFileName(fileName: string): string {
  let name = path.parse(fileName).name.trim();

  // Strip only the leading subgroup tag [Subgroup] or 【Subgroup】
  name = name.replace(/^[\[【][^\]】]+[\]】]\s*/, '');

  // Cut at common episode/metadata boundaries
  name = name
    .replace(/\s+-\s+\d{1,4}(?:\.\d)?(?:v\d)?.*$/i, '')
    .replace(/\s*(?:S\d{1,2})?(?:EP|E)\d{1,4}.*$/i, '')
    .replace(/\s*第\s*\d{1,4}\s*[话話集回].*$/, '')
    .replace(/\s*[\[【]\d{1,4}(?:v\d)?[\]】].*$/i, '')
    .replace(/\s*[\[【](?:1080P|720P|4K|2160P|BDRip|WebRip|WEB-DL|HEVC|AVC|简|繁).*$/i, '');

  // Unwrap bracketed title like [BanG Dream Yumemita]
  name = name.trim().replace(/^[\[【]([^\]】]+)[\]】]$/, '$1');

  name = name.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  return name || path.parse(fileName).name;
}

function buildEpisodeTitle(fileName: string, episodeNumber?: number): string {
  const base = path.parse(fileName).name;
  if (episodeNumber !== undefined) {
    const padded = Number.isInteger(episodeNumber)
      ? String(episodeNumber).padStart(2, '0')
      : String(episodeNumber);
    return `第 ${padded} 话 · ${base}`;
  }
  return base;
}

interface ScannedVideoEntry {
  rootDir: string;
  filePath: string;
  fileName: string;
  sizeBytes: number;
  addedAt: number;
}

function collectVideosInDir(
  rootDir: string,
  currentDir: string,
  depth: number,
  out: ScannedVideoEntry[],
): void {
  if (depth > MAX_SCAN_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name.toLowerCase()) || entry.name.startsWith('.')) {
        continue;
      }
      collectVideosInDir(rootDir, fullPath, depth + 1, out);
    } else if (entry.isFile() && isVideoFile(entry.name)) {
      try {
        const stat = fs.statSync(fullPath);
        out.push({
          rootDir,
          filePath: fullPath,
          fileName: entry.name,
          sizeBytes: stat.size,
          addedAt: stat.mtimeMs,
        });
      } catch {
        // Skip unreadable files
      }
    }
  }
}

export async function scanLibrary(overrideRoots?: string[]): Promise<LibrarySeries[]> {
  const settings = getSettings();
  const cloudRoot =
    settings.googleDriveIncludeInLibrary && settings.googleDriveDir?.trim()
      ? settings.googleDriveDir.trim()
      : '';
  const cloudRootKey = cloudRoot ? normalizePathKey(path.resolve(cloudRoot)) : '';
  const rawRoots =
    overrideRoots ?? [
      settings.downloadRootDir,
      ...settings.extraLibraryDirs,
      ...(cloudRoot ? [cloudRoot] : []),
    ];

  const uniqueRoots: string[] = [];
  const seenRootKeys = new Set<string>();
  for (const dir of rawRoots) {
    const trimmed = dir?.trim();
    if (!trimmed) continue;
    const resolved = path.resolve(trimmed);
    const key = normalizePathKey(resolved);
    if (seenRootKeys.has(key)) continue;
    seenRootKeys.add(key);
    if (fs.existsSync(resolved)) {
      uniqueRoots.push(resolved);
    }
  }

  const videos: ScannedVideoEntry[] = [];
  for (const root of uniqueRoots) {
    collectVideosInDir(root, root, 0, videos);
  }

  // Deduplicate by normalized filePath in case nested roots overlap
  const seenFiles = new Set<string>();
  const seriesGroups = new Map<
    string,
    {
      seriesId: string;
      title: string;
      originalTitle?: string;
      folderPath: string;
      bangumiId?: string;
      coverUrl?: string;
      infoLines?: string[];
      overview?: string;
      rating?: number;
      airDate?: string;
      scrapedAt?: number;
      episodes: LibraryEpisode[];
      lastUpdated: number;
    }
  >();

  for (const video of videos) {
    if (isFileHidden(video.filePath)) continue;
    const fileKey = normalizePathKey(video.filePath);
    if (seenFiles.has(fileKey)) continue;
    seenFiles.add(fileKey);

    const rel = path.relative(video.rootDir, video.filePath);
    const segments = rel.split(path.sep).filter(Boolean);

    let groupKey: string;
    let seriesFolderPath: string;
    let defaultTitle: string;

    if (segments.length >= 2) {
      // Grouped by immediate anime folder inside the scan root
      const topFolderName = segments[0];
      seriesFolderPath = path.join(video.rootDir, topFolderName);
      groupKey = `dir:${normalizePathKey(seriesFolderPath)}`;
      defaultTitle = topFolderName;
    } else {
      // Loose video file directly inside the scan root -> group by cleaned series title
      const cleaned = cleanSeriesTitleFromFileName(video.fileName);
      seriesFolderPath = video.rootDir;
      groupKey = `loose:${normalizePathKey(video.rootDir)}::${cleaned.toLowerCase()}`;
      defaultTitle = cleaned;
    }

    const seriesId = crypto.createHash('sha1').update(groupKey).digest('hex').slice(0, 16);
    if (isSeriesHidden(seriesId)) continue;

    let group = seriesGroups.get(groupKey);
    if (!group) {
      const folderMeta =
        getSeriesMetaById(seriesId) ??
        (segments.length >= 2
          ? getSeriesMeta(seriesFolderPath) ?? findSeriesMetaByTitle(defaultTitle)
          : findSeriesMetaByTitle(defaultTitle));

      group = {
        seriesId,
        title: folderMeta?.title || defaultTitle,
        originalTitle:
          folderMeta?.originalTitle ||
          (folderMeta?.title && folderMeta.title !== defaultTitle ? defaultTitle : undefined),
        folderPath: seriesFolderPath,
        bangumiId: folderMeta?.bangumiId,
        coverUrl: folderMeta?.coverUrl,
        infoLines: folderMeta?.infoLines,
        overview: folderMeta?.overview,
        rating: folderMeta?.rating,
        airDate: folderMeta?.airDate,
        scrapedAt: folderMeta?.scrapedAt,
        episodes: [],
        lastUpdated: video.addedAt,
      };
      seriesGroups.set(groupKey, group);
    }

    const episodeNumber = parseEpisodeNumber(video.fileName);
    const resolution = extractResolution(video.fileName);
    const subgroup = extractSubgroupFromTitle(video.fileName);
    const tags = extractReleaseTags(video.fileName, subgroup);
    const watchedRec = getWatchedRecord(video.filePath);

    group.episodes.push({
      id: crypto.createHash('sha1').update(fileKey).digest('hex').slice(0, 16),
      title: buildEpisodeTitle(video.fileName, episodeNumber),
      fileName: video.fileName,
      filePath: video.filePath,
      episodeNumber,
      resolution,
      tags,
      sizeBytes: video.sizeBytes,
      watched: Boolean(watchedRec?.watched),
      lastPlayedAt: watchedRec?.lastPlayedAt,
      addedAt: video.addedAt,
    });

    if (video.addedAt > group.lastUpdated) {
      group.lastUpdated = video.addedAt;
    }
  }

  const seriesList: LibrarySeries[] = [];
  for (const [groupKey, group] of seriesGroups.entries()) {
    group.episodes.sort((a, b) => {
      if (a.episodeNumber !== undefined && b.episodeNumber !== undefined) {
        if (a.episodeNumber !== b.episodeNumber) {
          return a.episodeNumber - b.episodeNumber;
        }
      } else if (a.episodeNumber !== undefined) {
        return -1;
      } else if (b.episodeNumber !== undefined) {
        return 1;
      }
      return a.fileName.localeCompare(b.fileName, 'zh-CN', { numeric: true });
    });

    const watchedCount = group.episodes.filter((ep) => ep.watched).length;
    const folderKey = normalizePathKey(path.resolve(group.folderPath));
    const isCloud = Boolean(
      cloudRootKey &&
        (folderKey === cloudRootKey ||
          folderKey.startsWith(`${cloudRootKey}/`) ||
          folderKey.startsWith(`${cloudRootKey}\\`)),
    );
    seriesList.push({
      seriesId: group.seriesId,
      title: group.title,
      originalTitle: group.originalTitle,
      bangumiId: group.bangumiId,
      coverUrl: group.coverUrl,
      infoLines: group.infoLines,
      overview: group.overview,
      rating: group.rating,
      airDate: group.airDate,
      scrapedAt: group.scrapedAt,
      folderPath: group.folderPath,
      totalEpisodes: group.episodes.length,
      watchedCount,
      lastUpdated: group.lastUpdated,
      episodes: group.episodes,
      isCloud,
    });
  }

  seriesList.sort((a, b) => b.lastUpdated - a.lastUpdated);
  return seriesList;
}

export async function playEpisode(filePath: string): Promise<ActionResult> {
  const target = filePath?.trim();
  if (!target || !fs.existsSync(target)) {
    return { ok: false, error: '找不到指定的视频文件，可能已被移动或删除' };
  }

  setWatchedRecord(target, true, Date.now());
  const settings = getSettings();

  if (settings.playerMode === 'custom') {
    const playerExe = settings.customPlayerPath?.trim();
    if (playerExe && fs.existsSync(playerExe)) {
      try {
        const child = spawn(playerExe, [target], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
        child.unref();
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : '启动自定义播放器失败',
        };
      }
    }
  }

  const electronShell = getElectronShell();
  if (electronShell) {
    try {
      const errMsg = await electronShell.openPath(target);
      if (errMsg) {
        return { ok: false, error: errMsg };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : '调用系统播放器失败',
      };
    }
  }

  return { ok: true };
}

export async function toggleWatched(filePath: string, watched: boolean): Promise<ActionResult> {
  if (!filePath?.trim()) {
    return { ok: false, error: '无效的文件路径' };
  }
  setWatchedRecord(filePath.trim(), Boolean(watched));
  return { ok: true };
}

export async function openFolder(targetPath: string): Promise<ActionResult> {
  const trimmed = targetPath?.trim();
  if (!trimmed) {
    return { ok: false, error: '无效的路径' };
  }

  const electronShell = getElectronShell();
  if (!electronShell) {
    return { ok: false, error: '仅在桌面应用环境中支持打开文件夹' };
  }

  try {
    if (fs.existsSync(trimmed)) {
      const stat = fs.statSync(trimmed);
      if (stat.isFile()) {
        electronShell.showItemInFolder(trimmed);
        return { ok: true };
      }
      const errMsg = await electronShell.openPath(trimmed);
      return errMsg ? { ok: false, error: errMsg } : { ok: true };
    }

    const parent = path.dirname(trimmed);
    if (parent && fs.existsSync(parent)) {
      const errMsg = await electronShell.openPath(parent);
      return errMsg ? { ok: false, error: errMsg } : { ok: true };
    }

    return { ok: false, error: '目标目录不存在' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '打开目录失败',
    };
  }
}

// ---------------------------------------------------------------------------
// Metadata Scraping (Mikan + optional Bangumi.tv enrichment) & Safe Removal
// ---------------------------------------------------------------------------

export function cleanSearchQueryForScrape(rawTitle: string): string {
  let q = rawTitle.trim();
  // Strip leading fansub brackets like [LoliHouse] or 【ANi】
  q = q.replace(/^(?:[\[【][^\]】]+[\]】]\s*)+/, '');
  // Strip trailing brackets / release metadata & parenthesized edition/episode tags
  q = q
    .replace(/[\[【][^\]】]*(?:1080p|720p|2160p|4k|bdrip|webrip|web-dl|hevc|x265|x264|avc|10bit|flac|mkv|mp4|简|繁|内封|内嵌|外挂|合集|全集|tv|bd)[^\]】]*[\]】]/gi, ' ')
    .replace(/[（(]\s*(?:19|20)?\d{2,4}\s*[）)]/g, ' ')
    .replace(/[（(]\s*(?:剧场版|電影版|电影版|OVA|OAD|SP|S\d+|第?\d+[季部话集]?|\d{1,3})\s*[）)]/gi, ' ')
    .replace(/\b(?:1080p|720p|2160p|4k|bdrip|webrip|web-dl|hevc|x265|x264|avc|10bit|flac|mkv|mp4|complete|batch)\b/gi, ' ')
    .replace(/(?:剧场版|全集|合集|完结)$/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!q || /^\d+$/.test(q) || !/[\p{L}\p{N}]/u.test(q)) {
    return '';
  }
  return q;
}

function normalizeMatchString(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\-_·:：/\\()（）\[\]【】!！?？.,，。'"`]/g, '');
}

export function pickBestBangumiMatch(
  query: string,
  candidates: MikanBangumiCard[],
): MikanBangumiCard | null {
  if (candidates.length === 0) return null;
  const normQuery = normalizeMatchString(query);
  if (!normQuery) return null;

  let best: MikanBangumiCard | null = null;
  let bestScore = -1;

  for (const cand of candidates) {
    const normTitle = normalizeMatchString(cand.title);
    if (!normTitle) continue;
    let score = 0;
    if (normTitle === normQuery) {
      score += 1000;
    } else if (normTitle.startsWith(normQuery) || normQuery.startsWith(normTitle)) {
      score += 500;
    } else if (normTitle.includes(normQuery) || normQuery.includes(normTitle)) {
      score += 300;
    }

    // Character overlap score for fuzzy CJK/English matching
    const queryChars = new Set(normQuery.split(''));
    let overlap = 0;
    for (const ch of queryChars) {
      if (normTitle.includes(ch)) overlap += 1;
    }
    if (score === 0 && overlap === 0) {
      continue;
    }
    score += Math.round((overlap / Math.max(queryChars.size, 1)) * 100);
    // Prefer shorter title delta on ties
    score -= Math.abs(normTitle.length - normQuery.length) * 0.1;

    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  return best;
}

interface BgmEnrichment {
  overview?: string;
  rating?: number;
  airDate?: string;
  originalTitle?: string;
}

function getBgmFetch(fetchFn?: FetchLike): FetchLike {
  if (fetchFn) return fetchFn;
  if (process.versions?.electron) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron') as typeof import('electron');
      if (electron?.net?.fetch) {
        return (input: string, init?: RequestInit) => electron.net.fetch(input, init);
      }
    } catch {
      // Fallback to global fetch
    }
  }
  return (input: string, init?: RequestInit) => fetch(input, init);
}

async function fetchOptionalBgmEnrichment(
  infoLines: string[],
  fetchFn?: FetchLike,
): Promise<BgmEnrichment> {
  let subjectId: string | undefined;
  for (const line of infoLines) {
    const match = line.match(/https?:\/\/(?:bgm\.tv|bangumi\.tv)\/subject\/(\d+)/i);
    if (match?.[1]) {
      subjectId = match[1];
      break;
    }
  }
  if (!subjectId) return {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const impl = getBgmFetch(fetchFn);
    const res = await impl(`https://api.bgm.tv/v0/subjects/${subjectId}`, {
      headers: {
        'User-Agent': 'MikanVault/0.1.0 (https://github.com/mikanvault)',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      name?: string;
      summary?: string;
      date?: string;
      rating?: { score?: number };
    };
    return {
      overview: typeof data.summary === 'string' && data.summary.trim() ? data.summary.trim() : undefined,
      rating: typeof data.rating?.score === 'number' && data.rating.score > 0 ? data.rating.score : undefined,
      airDate: typeof data.date === 'string' && data.date.trim() ? data.date.trim() : undefined,
      originalTitle: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : undefined,
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

function findSampleVideoFileNameInFolder(folderPath: string): string | null {
  if (!folderPath || !fs.existsSync(folderPath)) return null;
  try {
    const stat = fs.statSync(folderPath);
    if (!stat.isDirectory()) return null;
    const queue: Array<{ dir: string; depth: number }> = [{ dir: folderPath, depth: 0 }];
    while (queue.length > 0) {
      const { dir, depth } = queue.shift()!;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && isVideoFile(entry.name)) {
          return entry.name;
        }
      }
      if (depth < 2) {
        for (const entry of entries) {
          if (entry.isDirectory() && !SKIP_DIRS.has(entry.name.toLowerCase())) {
            queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
          }
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function isDedicatedSeriesFolder(folderPath: string): boolean {
  if (!folderPath?.trim()) return false;
  const settings = getSettings();
  const targetKey = normalizePathKey(folderPath);
  const roots = [settings.downloadRootDir, ...settings.extraLibraryDirs]
    .filter((d) => Boolean(d?.trim()))
    .map((d) => normalizePathKey(d));
  return !roots.includes(targetKey);
}

export async function scrapeSeries(
  req: LibraryScrapeSeriesRequest,
  fetchFn?: FetchLike,
): Promise<LibraryScrapeSeriesResult> {
  try {
    let targetBangumiId = req.bangumiId?.trim();

    if (!targetBangumiId) {
      const candidateQueries: string[] = [];
      const pushQuery = (q: string) => {
        const trimmed = q.trim();
        if (trimmed && !candidateQueries.includes(trimmed)) {
          candidateQueries.push(trimmed);
        }
      };

      const rawQuery = req.query?.trim() || req.currentTitle;
      const cleaned = cleanSearchQueryForScrape(rawQuery);
      pushQuery(cleaned);

      if (cleaned) {
        const firstSeg = cleaned.split(/[\/|\-–—]/)[0]?.trim();
        if (firstSeg) pushQuery(firstSeg);
      }

      if (!req.query?.trim() && isDedicatedSeriesFolder(req.folderPath)) {
        const sampleFile = findSampleVideoFileNameInFolder(req.folderPath);
        if (sampleFile) {
          const fromFile = cleanSearchQueryForScrape(cleanSeriesTitleFromFileName(sampleFile));
          pushQuery(fromFile);
        }
      }

      let best: MikanBangumiCard | null = null;
      for (const q of candidateQueries) {
        const searchRes = await searchMikan(q, fetchFn);
        best = pickBestBangumiMatch(q, searchRes.bangumis);
        if (best) break;
      }

      if (!best) {
        return {
          ok: false,
          error: '未在蜜柑计划中找到匹配的番剧，请尝试手动调整关键词',
        };
      }
      targetBangumiId = best.id;
    }

    const detail = await getBangumiDetail(targetBangumiId, fetchFn);
    const bgm = await fetchOptionalBgmEnrichment(detail.infoLines, fetchFn);

    let fallbackAirDate: string | undefined;
    for (const line of detail.infoLines) {
      const m = line.match(/^放送开始[：:]\s*(.+)$/);
      if (m?.[1]) {
        fallbackAirDate = m[1].trim();
        break;
      }
    }

    const dedicatedFolder = isDedicatedSeriesFolder(req.folderPath);
    const now = Date.now();
    setSeriesMeta(
      req.seriesId,
      {
        seriesId: req.seriesId,
        folderPath: req.folderPath,
        title: detail.title,
        originalTitle: bgm.originalTitle || req.currentTitle,
        bangumiId: detail.id,
        coverUrl: detail.coverUrl,
        infoLines: detail.infoLines,
        overview: bgm.overview,
        rating: bgm.rating,
        airDate: bgm.airDate || fallbackAirDate,
        scrapedAt: now,
        updatedAt: now,
      },
      dedicatedFolder,
    );

    return {
      ok: true,
      matchedTitle: detail.title,
      bangumiId: detail.id,
      coverUrl: detail.coverUrl,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '刮削番剧信息失败',
    };
  }
}

export async function scrapeAllUnscraped(
  forceAll = false,
  fetchFn?: FetchLike,
): Promise<LibraryScrapeAllResult> {
  const allSeries = await scanLibrary();
  const targets = forceAll ? allSeries : allSeries.filter((s) => !s.scrapedAt);
  const skipped = allSeries.length - targets.length;

  if (targets.length === 0) {
    return {
      total: allSeries.length,
      matched: 0,
      skipped,
      failed: 0,
      results: [],
    };
  }

  const results: LibraryScrapeAllResult['results'] = new Array(targets.length);
  const concurrency = Math.min(2, targets.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= targets.length) break;
      const s = targets[idx];
      const res = await scrapeSeries(
        {
          seriesId: s.seriesId,
          folderPath: s.folderPath,
          currentTitle: s.originalTitle || s.title,
        },
        fetchFn,
      );
      results[idx] = {
        seriesId: s.seriesId,
        title: s.title,
        ok: res.ok,
        matchedTitle: res.matchedTitle,
        error: res.error,
      };
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const matched = results.filter((r) => r.ok).length;
  return {
    total: allSeries.length,
    matched,
    skipped,
    failed: targets.length - matched,
    results,
  };
}

async function trashOrRemoveLocalPath(targetPath: string): Promise<void> {
  if (!targetPath || !fs.existsSync(targetPath)) return;
  const electronShell = getElectronShell();
  if (electronShell && typeof electronShell.trashItem === 'function') {
    await electronShell.trashItem(path.resolve(targetPath));
  } else {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

export async function removeSeriesFromLibrary(
  req: LibraryRemoveSeriesRequest,
): Promise<ActionResult> {
  try {
    const dedicatedFolder = isDedicatedSeriesFolder(req.folderPath);

    if (req.deleteFiles) {
      if (dedicatedFolder && fs.existsSync(req.folderPath)) {
        await trashOrRemoveLocalPath(req.folderPath);
      } else {
        for (const fp of req.filePaths || []) {
          await trashOrRemoveLocalPath(fp);
        }
      }
    } else {
      hideSeries(req.seriesId);
    }

    deleteSeriesMeta(req.seriesId, dedicatedFolder ? req.folderPath : undefined);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '移除番剧失败',
    };
  }
}

export async function removeEpisodeFromLibrary(
  req: LibraryRemoveEpisodeRequest,
): Promise<ActionResult> {
  const target = req.filePath?.trim();
  if (!target) {
    return { ok: false, error: '无效的文件路径' };
  }
  try {
    if (req.deleteFile) {
      await trashOrRemoveLocalPath(target);
    } else {
      hideFilePath(target);
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '移除剧集失败',
    };
  }
}

export function restoreHiddenLibraryItems(): ActionResult {
  restoreAllHidden();
  return { ok: true };
}

export function getHiddenLibraryCount(): number {
  return getHiddenCount();
}

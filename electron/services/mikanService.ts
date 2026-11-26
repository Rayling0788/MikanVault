import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import {
  MIKAN_DAY_LABELS,
  type MikanBangumiCard,
  type MikanBangumiDetail,
  type MikanRelease,
  type MikanResolvedUrl,
  type MikanScheduleGroup,
  type MikanScheduleResponse,
  type MikanSearchResult,
  type MikanSeasonName,
  type MikanSeasonOption,
  type MikanSubgroup,
} from '../../src/shared/types';
import { getImageCacheDir, getSettings } from './configStore';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const SCHEDULE_DAY_ORDER = [1, 2, 3, 4, 5, 6, 0, 7, 8];
const MAX_SEARCH_RELEASES = 200;
const rssXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});
const inFlightProxyImages = new Map<string, Promise<string>>();

function getDefaultFetch(): FetchLike {
  if (process.versions?.electron) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron') as typeof import('electron');
      if (electron?.net?.fetch) {
        return (input: string, init?: RequestInit) => electron.net.fetch(input, init);
      }
    } catch {
      // Fall back to global fetch
    }
  }
  return (input: string, init?: RequestInit) => fetch(input, init);
}

const RETRY_DELAYS_MS = [300, 700];

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return false;
  const cause = (err as { cause?: unknown }).cause;
  const causeText =
    cause instanceof Error
      ? `${cause.name} ${cause.message} ${String((cause as { code?: unknown }).code ?? '')}`
      : String(cause ?? '');
  const combined = `${err.name} ${err.message} ${causeText}`.toLowerCase();
  return (
    combined.includes('err_connection_closed') ||
    combined.includes('err_connection_reset') ||
    combined.includes('err_socket_not_connected') ||
    combined.includes('err_empty_response') ||
    combined.includes('err_timed_out') ||
    combined.includes('err_http2_protocol_error') ||
    combined.includes('econnreset') ||
    combined.includes('etimedout') ||
    combined.includes('epipe') ||
    combined.includes('socket') ||
    combined.includes('fetch failed') ||
    combined.includes('network')
  );
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mikanFetch(
  url: string,
  init: RequestInit = {},
  fetchFn?: FetchLike,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<Response> {
  const impl = fetchFn ?? getDefaultFetch();
  const parsed = new URL(url);
  const headers: Record<string, string> = {
    'User-Agent': DEFAULT_UA,
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: `${parsed.origin}/`,
    ...(init.headers as Record<string, string> | undefined),
  };

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      return await impl(url, {
        ...init,
        headers,
        signal: init.signal ?? controller.signal,
      });
    } catch (err) {
      const callerAborted = Boolean(init.signal?.aborted);
      if (callerAborted || attempt >= retryDelaysMs.length || !isTransientNetworkError(err)) {
        throw err;
      }
      await sleep(retryDelaysMs[attempt]);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error('Request failed after retries');
}

export function resolveAbsoluteUrl(href: string | undefined, baseUrl: string): string {
  if (!href) return '';
  const trimmed = href.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('magnet:')) {
    return trimmed;
  }
  try {
    return new URL(trimmed, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return trimmed;
  }
}

export function parseSizeToBytes(sizeText: string): number | undefined {
  if (!sizeText) return undefined;
  const match = sizeText.trim().match(/([\d.]+)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB)/i);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    KIB: 1024,
    MB: 1024 ** 2,
    MIB: 1024 ** 2,
    GB: 1024 ** 3,
    GIB: 1024 ** 3,
    TB: 1024 ** 4,
    TIB: 1024 ** 4,
  };
  return Math.round(value * (multipliers[unit] ?? 1));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${Math.round(bytes)} B`;
}

export function extractSubgroupFromTitle(title: string): string | undefined {
  const match = title.trim().match(/^[\[【]([^\]】]{1,40})[\]】]/);
  if (!match) return undefined;
  const candidate = match[1].trim();
  if (!candidate) return undefined;
  // Exclude common non-subgroup leading tokens
  if (/^(?:1080P|720P|4K|2160P|BDRip|WebRip|HEVC|OVA|SP|\d{1,3})$/i.test(candidate)) {
    return undefined;
  }
  return candidate;
}

export function extractReleaseTags(title: string, subgroup?: string): string[] {
  const tags: string[] = [];
  const pushUnique = (tag: string) => {
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  };

  if (subgroup && subgroup.trim()) {
    pushUnique(subgroup.trim());
  }

  // Resolution
  if (/\b(?:2160p|4K|3840x2160|UHD)\b/i.test(title)) {
    pushUnique('4K');
  } else if (/\b(?:1080p|1920x1080|FHD)\b/i.test(title)) {
    pushUnique('1080P');
  } else if (/\b(?:720p|1280x720)\b/i.test(title)) {
    pushUnique('720P');
  } else if (/\b(?:480p)\b/i.test(title)) {
    pushUnique('480P');
  }

  // Source
  if (/\bBD(?:Rip|MV|Remux)?\b/i.test(title)) {
    pushUnique('BDRip');
  } else if (/\bWebRip\b/i.test(title)) {
    pushUnique('WebRip');
  } else if (/\bWEB-?DL\b/i.test(title)) {
    pushUnique('WEB-DL');
  } else if (/\bDVDRip\b/i.test(title)) {
    pushUnique('DVDRip');
  }

  // Video Codec & Bit depth
  if (/\b(?:HEVC|x265|H\.?265)\b/i.test(title)) {
    pushUnique('HEVC');
  } else if (/\bAV1\b/i.test(title)) {
    pushUnique('AV1');
  } else if (/\b(?:AVC|x264|H\.?264)\b/i.test(title)) {
    pushUnique('AVC');
  }

  if (/\b10-?bit\b/i.test(title) || /Ma10p/i.test(title)) {
    pushUnique('10bit');
  }

  // Subtitle languages & types
  if (/简繁日/.test(title)) {
    pushUnique('简繁日');
  } else if (/简繁|CHS[_&+\-]?CHT|CHT[_&+\-]?CHS/i.test(title)) {
    pushUnique('简繁');
  } else if (/简日|JPSC|CHS[_&+\-]?JP/i.test(title)) {
    pushUnique('简日');
  } else if (/繁日|JPTC|CHT[_&+\-]?JP/i.test(title)) {
    pushUnique('繁日');
  } else if (/简中|简体|简体中文|\bCHS\b|\bGB\b/i.test(title)) {
    pushUnique('简中');
  } else if (/繁中|繁体|繁體|\bCHT\b|\bBIG5\b/i.test(title)) {
    pushUnique('繁中');
  } else if (/生肉|Raw/i.test(title)) {
    pushUnique('生肉');
  }

  if (/外挂|外掛|ASS|SRT/i.test(title)) {
    pushUnique('外挂');
  } else if (/内封|內封/.test(title)) {
    pushUnique('内封');
  } else if (/内嵌|內嵌/.test(title)) {
    pushUnique('内嵌');
  }

  return tags;
}

function extractEpisodeHash(episodeUrl: string, torrentUrl?: string, magnetUrl?: string): string {
  const epMatch = episodeUrl.match(/\/Home\/Episode\/([a-fA-F0-9]{16,64})/);
  if (epMatch) return epMatch[1].toLowerCase();

  if (magnetUrl) {
    const magnetMatch = magnetUrl.match(/btih:([a-fA-F0-9]{32,40}|[A-Z2-7]{32})/i);
    if (magnetMatch) return magnetMatch[1].toLowerCase();
  }

  if (torrentUrl) {
    const torrentMatch = torrentUrl.match(/\/([a-fA-F0-9]{32,64})\.torrent/i);
    if (torrentMatch) return torrentMatch[1].toLowerCase();
  }

  return crypto
    .createHash('sha1')
    .update(episodeUrl || torrentUrl || magnetUrl || String(Math.random()))
    .digest('hex')
    .slice(0, 16);
}

function extractBgImageUrl(style: string | undefined): string {
  if (!style) return '';
  const match = style.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
  return match ? match[1].trim() : '';
}

const VALID_SEASONS = new Set<MikanSeasonName>(['冬', '春', '夏', '秋']);

export function parseScheduleHtml(
  html: string,
  baseUrl: string,
  meta?: { year?: number; season?: MikanSeasonName },
): MikanScheduleResponse {
  const $ = cheerio.load(html);
  const groupMap = new Map<number, MikanBangumiCard[]>();

  const availableSeasons: MikanSeasonOption[] = [];
  const seenSeasons = new Set<string>();
  $('[data-year][data-season]').each((_idx, el) => {
    const rawYear = Number.parseInt($(el).attr('data-year') || '', 10);
    const rawSeason = ($(el).attr('data-season') || '').trim() as MikanSeasonName;
    if (!Number.isInteger(rawYear) || !VALID_SEASONS.has(rawSeason)) return;
    const key = `${rawYear}-${rawSeason}`;
    if (seenSeasons.has(key)) return;
    seenSeasons.add(key);
    availableSeasons.push({ year: rawYear, season: rawSeason });
  });

  let activeYear = meta?.year;
  let activeSeason = meta?.season;
  if (!activeYear || !activeSeason) {
    const headerText = $('.sk-col.date-text, .dropdown-toggle').text();
    const ym = headerText.match(/(\d{4})\s*年?\s*([冬春夏秋])/);
    if (ym) {
      activeYear = Number.parseInt(ym[1], 10);
      activeSeason = ym[2] as MikanSeasonName;
    }
  }

  $('.sk-bangumi[data-dayofweek]').each((_idx, block) => {
    const $block = $(block);
    const dayAttr = $block.attr('data-dayofweek');
    const dayOfWeek = dayAttr !== undefined ? Number.parseInt(dayAttr, 10) : -1;
    if (!Number.isInteger(dayOfWeek)) return;

    const items: MikanBangumiCard[] = groupMap.get(dayOfWeek) ?? [];
    const seenIds = new Set(items.map((i) => i.id));

    $block.find('li').each((_liIdx, li) => {
      const $li = $(li);
      const $link = $li.find('a[href^="/Home/Bangumi/"]').first();
      const href = $link.attr('href') || '';
      const idMatch = href.match(/\/Home\/Bangumi\/(\d+)/);
      const id = idMatch?.[1] || $li.find('span[data-bangumiid]').attr('data-bangumiid') || '';
      if (!id || seenIds.has(id)) return;
      seenIds.add(id);

      const title =
        $link.text().trim() ||
        $link.attr('title')?.trim() ||
        $li.find('.an-text').first().text().trim() ||
        $li.find('.an-text').first().attr('title')?.trim() ||
        `番剧 #${id}`;

      const rawCover =
        $li.find('span[data-src]').first().attr('data-src') ||
        $li.find('img').first().attr('data-src') ||
        $li.find('img').first().attr('src') ||
        '';

      const hasUpdate = $li.find('.num-node').length > 0;
      const updateDate = $li.find('.date-text').first().text().trim() || undefined;

      items.push({
        id,
        title,
        coverUrl: resolveAbsoluteUrl(rawCover, baseUrl),
        updateDay: dayOfWeek,
        hasUpdate,
        updateDate,
      });
    });

    if (items.length > 0) {
      groupMap.set(dayOfWeek, items);
    }
  });

  const orderedDays = [
    ...SCHEDULE_DAY_ORDER.filter((d) => groupMap.has(d)),
    ...Array.from(groupMap.keys())
      .filter((d) => !SCHEDULE_DAY_ORDER.includes(d))
      .sort((a, b) => a - b),
  ];

  const groups: MikanScheduleGroup[] = orderedDays.map((dayOfWeek) => ({
    dayOfWeek,
    label: MIKAN_DAY_LABELS[dayOfWeek] ?? `分类 ${dayOfWeek}`,
    items: groupMap.get(dayOfWeek) ?? [],
  }));

  return {
    groups,
    fetchedAt: Date.now(),
    year: activeYear,
    season: activeSeason,
    availableSeasons: availableSeasons.length > 0 ? availableSeasons : undefined,
  };
}

function parseReleaseRow(
  $: cheerio.CheerioAPI,
  $row: cheerio.Cheerio<any>,
  baseUrl: string,
  extra?: { bangumiId?: string; bangumiTitle?: string; subgroup?: string; subgroupId?: string },
): MikanRelease | null {
  const $titleLink = $row.find('a.magnet-link-wrap').first();
  const title = $titleLink.text().trim();
  if (!title) return null;

  const episodeUrl = resolveAbsoluteUrl($titleLink.attr('href'), baseUrl);
  const magnetUrl =
    $row.find('[data-clipboard-text^="magnet:"]').first().attr('data-clipboard-text')?.trim() ||
    $row.find('input[data-magnet^="magnet:"]').first().attr('data-magnet')?.trim() ||
    $row.find('a[href^="magnet:"]').first().attr('href')?.trim() ||
    undefined;

  const torrentHref = $row.find('a[href^="/Download/"]').first().attr('href');
  const torrentUrl = resolveAbsoluteUrl(torrentHref, baseUrl);

  const tds = $row.find('td').toArray();
  let titleTdIdx = -1;
  for (let i = 0; i < tds.length; i += 1) {
    if ($(tds[i]).find('a.magnet-link-wrap').length > 0) {
      titleTdIdx = i;
      break;
    }
  }

  let size = '';
  let pubDate = '';
  if (titleTdIdx >= 0) {
    size = $(tds[titleTdIdx + 1]).text().trim();
    pubDate = $(tds[titleTdIdx + 2]).text().trim();
  }

  const subgroup = extra?.subgroup || extractSubgroupFromTitle(title);
  const id = extractEpisodeHash(episodeUrl, torrentUrl, magnetUrl);

  return {
    id,
    title,
    bangumiId: extra?.bangumiId,
    bangumiTitle: extra?.bangumiTitle,
    subgroup,
    subgroupId: extra?.subgroupId,
    size,
    sizeBytes: parseSizeToBytes(size),
    pubDate,
    torrentUrl,
    magnetUrl,
    episodeUrl,
    tags: extractReleaseTags(title, subgroup),
  };
}

export function parseBangumiDetailHtml(
  html: string,
  id: string,
  baseUrl: string,
): MikanBangumiDetail {
  const $ = cheerio.load(html);

  const title =
    $('.bangumi-title').first().text().trim() ||
    $('title').text().replace(/\s*-\s*Mikan Project.*$/i, '').trim() ||
    `番剧 #${id}`;

  const posterStyle = $('.bangumi-poster').first().attr('style');
  const rawCover =
    extractBgImageUrl(posterStyle) ||
    $('.bangumi-poster img').first().attr('src') ||
    '';

  const infoLines: string[] = [];
  $('.bangumi-info').each((_i, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text) infoLines.push(text);
  });

  const subgroups: MikanSubgroup[] = [];
  $('.subgroup-text').each((idx, el) => {
    const $sg = $(el);
    const sgId = $sg.attr('id')?.trim() || String(idx);

    // Pick subgroup display name without grabbing subscription dropdown text
    const $nameLink = $sg
      .children('a')
      .filter((_i, a) => !$(a).hasClass('mikan-rss') && !$(a).hasClass('js-subscribe_bangumi_page'))
      .first();
    const directText = $sg
      .clone()
      .children()
      .remove()
      .end()
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    const name = $nameLink.text().trim() || directText || '生肉/其他字幕组';
    const rssHref =
      $sg.find('a.mikan-rss').first().attr('href') ||
      `/RSS/Bangumi?bangumiId=${encodeURIComponent(id)}&subgroupid=${encodeURIComponent(sgId)}`;
    const rssUrl = resolveAbsoluteUrl(rssHref, baseUrl);

    const $tableContainer = $sg.nextAll('.episode-table, table').first();
    const $rows =
      $tableContainer.find('tbody tr').length > 0
        ? $tableContainer.find('tbody tr')
        : $tableContainer.find('tr');

    const episodes: MikanRelease[] = [];
    $rows.each((_rIdx, tr) => {
      const release = parseReleaseRow($, $(tr), baseUrl, {
        bangumiId: id,
        bangumiTitle: title,
        subgroup: name,
        subgroupId: sgId,
      });
      if (release) {
        episodes.push(release);
      }
    });

    const $between = $sg.nextUntil('.subgroup-text');
    const hasMore =
      $between.filter('.js-expand-episode').length > 0 ||
      $between.find('.js-expand-episode').length > 0;

    subgroups.push({
      id: sgId,
      name,
      rssUrl,
      episodes,
      hasMore,
    });
  });

  return {
    id,
    title,
    coverUrl: resolveAbsoluteUrl(rawCover, baseUrl),
    mikanUrl: resolveAbsoluteUrl(`/Home/Bangumi/${id}`, baseUrl),
    infoLines,
    subgroups,
  };
}

export function parseExpandedEpisodesHtml(
  html: string,
  bangumiId: string,
  subgroupId: string,
  baseUrl: string,
  extra?: { bangumiTitle?: string; subgroup?: string },
): MikanRelease[] {
  const wrapped = /<table/i.test(html) ? html : `<table><tbody>${html}</tbody></table>`;
  const $ = cheerio.load(wrapped);
  const $rows = $('tbody tr').length > 0 ? $('tbody tr') : $('tr');
  const episodes: MikanRelease[] = [];

  $rows.each((_idx, tr) => {
    const release = parseReleaseRow($, $(tr), baseUrl, {
      bangumiId,
      bangumiTitle: extra?.bangumiTitle,
      subgroup: extra?.subgroup,
      subgroupId,
    });
    if (release) {
      episodes.push(release);
    }
  });

  return episodes;
}

export function parseSearchHtml(
  html: string,
  query: string,
  baseUrl: string,
): MikanSearchResult {
  const $ = cheerio.load(html);

  const bangumis: MikanBangumiCard[] = [];
  const seenBangumiIds = new Set<string>();

  const $cardLinks = $('.an-ul a[href^="/Home/Bangumi/"], .list-inline a[href^="/Home/Bangumi/"]');
  $cardLinks.each((_idx, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const idMatch = href.match(/\/Home\/Bangumi\/(\d+)/);
    if (!idMatch) return;
    const id = idMatch[1];
    if (seenBangumiIds.has(id)) return;
    seenBangumiIds.add(id);

    const $container = $a.closest('li').length ? $a.closest('li') : $a;
    const title =
      $container.find('.an-text').first().text().trim() ||
      $container.find('.an-text').first().attr('title')?.trim() ||
      $a.text().trim() ||
      `番剧 #${id}`;
    const rawCover =
      $container.find('span[data-src]').first().attr('data-src') ||
      $container.find('img').first().attr('data-src') ||
      $container.find('img').first().attr('src') ||
      '';

    bangumis.push({
      id,
      title,
      coverUrl: resolveAbsoluteUrl(rawCover, baseUrl),
      updateDay: -1,
      hasUpdate: $container.find('.num-node').length > 0,
    });
  });

  const releases: MikanRelease[] = [];
  const $rows = $('tr.js-search-results-row');
  $rows.each((_idx, tr) => {
    if (releases.length >= MAX_SEARCH_RELEASES) return false;
    const release = parseReleaseRow($, $(tr), baseUrl);
    if (release) {
      releases.push(release);
    }
    return undefined;
  });

  return {
    query,
    bangumis,
    releases,
  };
}

export function parseRssXml(xml: string, baseUrl: string): MikanRelease[] {
  const doc = rssXmlParser.parse(xml) as {
    rss?: {
      channel?: {
        item?: Record<string, unknown> | Record<string, unknown>[];
      };
    };
  };

  const rawItems = doc?.rss?.channel?.item;
  if (!rawItems) return [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  const releases: MikanRelease[] = [];
  for (const item of items) {
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) continue;

    const episodeUrl = resolveAbsoluteUrl(
      typeof item.link === 'string' ? item.link : '',
      baseUrl,
    );

    const enclosure = item.enclosure as Record<string, unknown> | undefined;
    const torrentUrl = resolveAbsoluteUrl(
      typeof enclosure?.['@_url'] === 'string' ? enclosure['@_url'] : '',
      baseUrl,
    );

    const torrentNode = item.torrent as Record<string, unknown> | undefined;
    const contentLengthRaw = torrentNode?.contentLength ?? enclosure?.['@_length'];
    let sizeBytes: number | undefined;
    if (contentLengthRaw !== undefined && contentLengthRaw !== null && contentLengthRaw !== '') {
      const parsedLen = Number.parseInt(String(contentLengthRaw), 10);
      if (Number.isFinite(parsedLen) && parsedLen > 0) {
        sizeBytes = parsedLen;
      }
    }

    const description = typeof item.description === 'string' ? item.description : '';
    let size = sizeBytes ? formatBytes(sizeBytes) : '';
    if (!size && description) {
      const descSizeMatch = description.match(/\[([\d.]+\s*(?:KB|MB|GB|TB))\]/i);
      if (descSizeMatch) {
        size = descSizeMatch[1];
        sizeBytes = parseSizeToBytes(size);
      }
    }

    const pubDate =
      (typeof torrentNode?.pubDate === 'string' && torrentNode.pubDate.trim()) ||
      (typeof item.pubDate === 'string' && item.pubDate.trim()) ||
      '';

    const epHashMatch = episodeUrl.match(/\/Home\/Episode\/([a-fA-F0-9]{40})/);
    const magnetUrl = epHashMatch ? `magnet:?xt=urn:btih:${epHashMatch[1].toLowerCase()}` : undefined;
    const subgroup = extractSubgroupFromTitle(title);
    const id = extractEpisodeHash(episodeUrl, torrentUrl, magnetUrl);

    releases.push({
      id,
      title,
      subgroup,
      size,
      sizeBytes,
      pubDate,
      torrentUrl,
      magnetUrl,
      episodeUrl,
      tags: extractReleaseTags(title, subgroup),
    });
  }

  return releases;
}

export function parseEpisodeHtml(
  html: string,
  episodeHash: string,
  episodeUrl: string,
  baseUrl: string,
): { bangumiId?: string; release: MikanRelease } {
  const $ = cheerio.load(html);

  const rawTitle = $('.episode-title').first().text().trim();
  const title = rawTitle || `Episode ${episodeHash}`;
  const $bangumiLink = $('.bangumi-title a[href^="/Home/Bangumi/"], a[href^="/Home/Bangumi/"]').first();
  const bangumiHref = $bangumiLink.attr('href') || '';
  const bangumiIdMatch = bangumiHref.match(/\/Home\/Bangumi\/(\d+)/);
  const bangumiId = bangumiIdMatch?.[1];
  const bangumiTitle =
    $('.bangumi-title').first().text().trim() || $bangumiLink.text().trim() || undefined;

  const magnetUrl =
    $('a[href^="magnet:"]').first().attr('href')?.trim() ||
    `magnet:?xt=urn:btih:${episodeHash.toLowerCase()}`;
  const torrentHref = $('a[href^="/Download/"]').first().attr('href');
  const torrentUrl = resolveAbsoluteUrl(torrentHref, baseUrl);

  let subgroup: string | undefined;
  let pubDate = '';
  let size = '';
  $('.bangumi-info').each((_i, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.startsWith('字幕组：') || text.startsWith('字幕组:')) {
      subgroup = text.replace(/^字幕组[：:]\s*/, '').trim();
    } else if (text.startsWith('发布日期：') || text.startsWith('发布日期:')) {
      pubDate = text.replace(/^发布日期[：:]\s*/, '').trim();
    } else if (text.startsWith('文件大小：') || text.startsWith('文件大小:')) {
      size = text.replace(/^文件大小[：:]\s*/, '').trim();
    }
  });

  if (!subgroup) {
    subgroup = extractSubgroupFromTitle(title);
  }

  return {
    bangumiId,
    release: {
      id: episodeHash.toLowerCase(),
      title,
      bangumiId,
      bangumiTitle,
      subgroup,
      size,
      sizeBytes: parseSizeToBytes(size),
      pubDate,
      torrentUrl,
      magnetUrl,
      episodeUrl,
      tags: extractReleaseTags(title, subgroup),
    },
  };
}

export async function getSchedule(
  year?: number,
  season?: MikanSeasonName,
  fetchFn?: FetchLike,
): Promise<MikanScheduleResponse> {
  const baseUrl = getSettings().mikanBaseUrl;
  if (year !== undefined && season !== undefined) {
    if (!Number.isInteger(year) || !VALID_SEASONS.has(season)) {
      throw new Error(`无效的季度参数: ${String(year)} ${String(season)}`);
    }
    const url = `${baseUrl}/Home/BangumiCoverFlowByDayOfWeek?year=${year}&seasonStr=${encodeURIComponent(season)}`;
    const res = await mikanFetch(url, {}, fetchFn);
    if (!res.ok) {
      throw new Error(`获取 ${year} 年${season}季番剧失败 (HTTP ${res.status})`);
    }
    const html = await res.text();
    return parseScheduleHtml(html, baseUrl, { year, season });
  }

  const res = await mikanFetch(`${baseUrl}/`, {}, fetchFn);
  if (!res.ok) {
    throw new Error(`获取蜜柑番剧时间表失败 (HTTP ${res.status})`);
  }
  const html = await res.text();
  return parseScheduleHtml(html, baseUrl);
}

export async function getBangumiDetail(
  id: string,
  fetchFn?: FetchLike,
): Promise<MikanBangumiDetail> {
  const cleanId = String(id).trim();
  if (!/^\d+$/.test(cleanId)) {
    throw new Error(`无效的番剧 ID: ${id}`);
  }
  const baseUrl = getSettings().mikanBaseUrl;
  const res = await mikanFetch(`${baseUrl}/Home/Bangumi/${cleanId}`, {}, fetchFn);
  if (!res.ok) {
    throw new Error(`获取番剧详情失败 (HTTP ${res.status})`);
  }
  const html = await res.text();
  return parseBangumiDetailHtml(html, cleanId, baseUrl);
}

export async function expandSubgroupEpisodes(
  bangumiId: string,
  subgroupId: string,
  take = 200,
  fetchFn?: FetchLike,
): Promise<MikanRelease[]> {
  const cleanBangumiId = String(bangumiId).trim();
  const cleanSubgroupId = String(subgroupId).trim();
  if (!/^\d+$/.test(cleanBangumiId) || !/^\d+$/.test(cleanSubgroupId)) {
    throw new Error('无效的番剧或字幕组 ID');
  }
  const safeTake = Math.min(Math.max(Math.trunc(take) || 200, 1), 500);
  const baseUrl = getSettings().mikanBaseUrl;
  const url = `${baseUrl}/Home/ExpandEpisodeTable?bangumiId=${cleanBangumiId}&subtitleGroupId=${cleanSubgroupId}&take=${safeTake}`;
  const res = await mikanFetch(url, {}, fetchFn);
  if (!res.ok) {
    throw new Error(`展开字幕组全部集数失败 (HTTP ${res.status})`);
  }
  const html = await res.text();
  return parseExpandedEpisodesHtml(html, cleanBangumiId, cleanSubgroupId, baseUrl);
}

export async function searchMikan(
  query: string,
  fetchFn?: FetchLike,
): Promise<MikanSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { query: '', bangumis: [], releases: [] };
  }
  const baseUrl = getSettings().mikanBaseUrl;
  const searchUrl = `${baseUrl}/Home/Search?searchstr=${encodeURIComponent(trimmed)}`;
  const res = await mikanFetch(searchUrl, {}, fetchFn);
  if (!res.ok) {
    throw new Error(`搜索蜜柑失败 (HTTP ${res.status})`);
  }
  const html = await res.text();
  return parseSearchHtml(html, trimmed, baseUrl);
}

export async function getRssFeed(
  rssUrl?: string,
  fetchFn?: FetchLike,
): Promise<MikanRelease[]> {
  const baseUrl = getSettings().mikanBaseUrl;
  const targetUrl = rssUrl?.trim()
    ? resolveAbsoluteUrl(rssUrl.trim(), baseUrl)
    : `${baseUrl}/RSS/Classic`;
  const res = await mikanFetch(targetUrl, {}, fetchFn);
  if (!res.ok) {
    throw new Error(`获取 RSS 订阅失败 (HTTP ${res.status})`);
  }
  const xml = await res.text();
  return parseRssXml(xml, baseUrl);
}

export async function resolveMikanUrl(
  rawUrl: string,
  fetchFn?: FetchLike,
): Promise<MikanResolvedUrl> {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { kind: 'unknown', url: rawUrl, error: '请输入蜜柑计划链接' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { kind: 'unknown', url: rawUrl, error: '链接格式无效，请输入完整的 http/https 链接' };
  }

  const pathname = parsed.pathname;

  const bangumiMatch = pathname.match(/^\/Home\/Bangumi\/(\d+)\/?$/i);
  if (bangumiMatch) {
    const bangumiId = bangumiMatch[1];
    try {
      const detail = await getBangumiDetail(bangumiId, fetchFn);
      return { kind: 'bangumi', bangumiId, url: parsed.toString(), detail };
    } catch {
      return { kind: 'bangumi', bangumiId, url: parsed.toString() };
    }
  }

  const episodeMatch = pathname.match(/^\/Home\/Episode\/([a-fA-F0-9]{16,64})\/?$/i);
  if (episodeMatch) {
    const episodeHash = episodeMatch[1].toLowerCase();
    const baseUrl = getSettings().mikanBaseUrl;
    try {
      const res = await mikanFetch(parsed.toString(), {}, fetchFn);
      if (res.ok) {
        const html = await res.text();
        const parsedEp = parseEpisodeHtml(html, episodeHash, parsed.toString(), baseUrl);
        return {
          kind: 'episode',
          episodeHash,
          url: parsed.toString(),
          bangumiId: parsedEp.bangumiId,
          release: parsedEp.release,
        };
      }
    } catch {
      // Fall back to hash-only result
    }
    return { kind: 'episode', episodeHash, url: parsed.toString() };
  }

  if (/^\/RSS(\/|$)/i.test(pathname) || /\.xml$/i.test(pathname)) {
    const rssUrl = parsed.toString();
    try {
      const releases = await getRssFeed(rssUrl, fetchFn);
      return { kind: 'rss', rssUrl, releases };
    } catch {
      return { kind: 'rss', rssUrl };
    }
  }

  return {
    kind: 'unknown',
    url: trimmed,
    error: '无法识别该蜜柑链接（支持番剧页 /Home/Bangumi/、单集页 /Home/Episode/ 或 /RSS/ 链接）',
  };
}

function guessMimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.avif':
      return 'image/avif';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'image/jpeg';
  }
}

export async function proxyImage(url: string, fetchFn?: FetchLike): Promise<string> {
  if (!url) return '';
  if (url.startsWith('data:image/')) return url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return '';
  }

  if (!fetchFn) {
    const existing = inFlightProxyImages.get(url);
    if (existing) return existing;
  }

  const run = async (): Promise<string> => {
    const hash = crypto.createHash('sha1').update(url).digest('hex');
    const cacheDir = getImageCacheDir();
    const dataPath = path.join(cacheDir, `${hash}.bin`);
    const metaPath = path.join(cacheDir, `${hash}.meta.json`);

    try {
      const [metaRaw, buf] = await Promise.all([
        fsp.readFile(metaPath, 'utf-8'),
        fsp.readFile(dataPath),
      ]);
      const meta = JSON.parse(metaRaw) as { contentType?: string };
      const mime = meta.contentType || 'image/jpeg';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      // Cache miss or read failure; fetch from network
    }

    try {
      const parsed = new URL(url);
      const res = await mikanFetch(
        url,
        {
          headers: {
            Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          },
        },
        fetchFn,
      );
      if (!res.ok) {
        return '';
      }
      const arrayBuffer = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      const contentType =
        (res.headers.get('content-type') || '').split(';')[0].trim() ||
        guessMimeFromExt(path.extname(parsed.pathname));

      try {
        await Promise.all([
          fsp.writeFile(dataPath, buf),
          fsp.writeFile(metaPath, JSON.stringify({ contentType, url })),
        ]);
      } catch {
        // Ignore cache write errors
      }

      return `data:${contentType};base64,${buf.toString('base64')}`;
    } catch {
      return '';
    }
  };

  if (fetchFn) {
    return run();
  }

  const promise = run().finally(() => {
    if (inFlightProxyImages.get(url) === promise) {
      inFlightProxyImages.delete(url);
    }
  });
  inFlightProxyImages.set(url, promise);
  return promise;
}

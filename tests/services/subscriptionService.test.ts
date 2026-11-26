import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDataDirForTesting, updateSettings } from '../../electron/services/configStore';
import {
  checkSubscriptions,
  deleteSubscription,
  detectLocalProgress,
  getSubscriptionLogsList,
  listSubscriptions,
  matchesSubscriptionKeywords,
  upsertSubscription,
} from '../../electron/services/subscriptionService';
import type { MikanRelease } from '../../src/shared/types';
import {
  classifySubtitleLanguage,
  countSubtitleLanguages,
  detectSubtitleLanguage,
  inferCommonSubtitleLanguage,
  matchesSubtitleLanguage,
} from '../../src/shared/subtitleLanguage';

function makeRelease(ep: number, extraTags = '[WebRip 1080p HEVC][简繁内封]'): MikanRelease {
  const pad = String(ep).padStart(2, '0');
  const hash = pad.repeat(20);
  return {
    id: hash,
    title: `[LoliHouse] 无职转生 第三季 - ${pad} ${extraTags}`,
    subgroup: 'LoliHouse',
    size: '600 MB',
    pubDate: `2026-11-${pad}T12:00:00`,
    torrentUrl: `https://mikanani.kas.pub/Download/2026/${hash}.torrent`,
    magnetUrl: `magnet:?xt=urn:btih:${hash}`,
    episodeUrl: `https://mikanani.kas.pub/Home/Episode/${hash}`,
    tags: ['1080P', 'HEVC'],
  };
}

describe('subscriptionService', () => {
  let tmpDir: string;
  let downloadDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikanvault-sub-test-'));
    downloadDir = path.join(tmpDir, 'Anime');
    fs.mkdirSync(downloadDir, { recursive: true });
    setDataDirForTesting(path.join(tmpDir, 'app-data'));
    updateSettings({
      downloadRootDir: downloadDir,
      qbCategory: 'MikanVault',
    });
  });

  afterEach(() => {
    setDataDirForTesting(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('matches include and exclude keywords properly', () => {
    expect(
      matchesSubscriptionKeywords(
        '[LoliHouse] 无职转生 - 08 [1080p HEVC][简繁]',
        '1080p, 简繁',
        '720p, 合集',
      ),
    ).toBe(true);
    expect(
      matchesSubscriptionKeywords(
        '[LoliHouse] 无职转生 - 08 [720p HEVC][简繁]',
        '1080p',
        '720p',
      ),
    ).toBe(false);
    expect(
      matchesSubscriptionKeywords(
        '[LoliHouse] 无职转生 合集 [1080p][简繁]',
        '1080p',
        '合集',
      ),
    ).toBe(false);
  });

  it('detects local episode progress when 7 episodes are already downloaded', async () => {
    const animeFolder = path.join(downloadDir, '无职转生 S3');
    fs.mkdirSync(animeFolder, { recursive: true });
    for (let i = 1; i <= 7; i += 1) {
      fs.writeFileSync(
        path.join(animeFolder, `[LoliHouse] Mushoku Tensei S3 - 0${i} [1080p].mkv`),
        `ep-${i}`,
      );
    }

    const hint = await detectLocalProgress('3995', '无职转生 第三季', animeFolder);
    expect(hint.savePath).toBe(animeFolder);
    expect(hint.maxEpisodeNumber).toBe(7);
    expect(hint.episodeCount).toBe(7);
    expect(hint.detectedSubgroup).toBe('LoliHouse');
  });

  it('skips episodes <= startAfterEpisode (1-7) and auto-downloads 8 and 9 in order, with idempotency', async () => {
    const animeFolder = path.join(downloadDir, '无职转生 S3');
    fs.mkdirSync(animeFolder, { recursive: true });
    // Simulate episode 8 already existing on disk too? No, test 8 & 9 first, and put ep 7 on disk
    fs.writeFileSync(path.join(animeFolder, '[LoliHouse] Mushoku S3 - 07.mkv'), 'ep7');

    const sub = upsertSubscription({
      bangumiId: '3995',
      bangumiTitle: '无职转生 第三季',
      subgroupId: '370',
      subgroupName: 'LoliHouse',
      rssUrl: 'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=3995&subgroupid=370',
      savePath: animeFolder,
      startAfterEpisode: 7,
      includeKeywords: '1080p',
      excludeKeywords: '合集',
    });

    expect(listSubscriptions()).toHaveLength(1);

    const feed: MikanRelease[] = [
      makeRelease(9),
      makeRelease(8),
      makeRelease(7),
      makeRelease(6),
      makeRelease(10, '[720p][合集]'), // excluded by both include & exclude
    ];

    const pushedTitles: string[] = [];
    const summary1 = await checkSubscriptions(sub.id, {
      fetchRss: async () => feed,
      getTorrentsFn: async () => [],
      testConnFn: async () => ({
        ok: true,
        connected: true,
        version: 'v5.1.3.10',
        qbRunning: true,
        exeExists: true,
      }),
      addDownloadFn: async (req) => {
        pushedTitles.push(req.title);
        return { ok: true, hash: req.title, savePath: req.savePath || animeFolder };
      },
      notifyFn: vi.fn(),
    });

    expect(summary1.checkedCount).toBe(1);
    expect(summary1.newDownloads).toBe(2);
    expect(summary1.errors).toBe(0);
    // Ordered ascending: EP 08 before EP 09
    expect(pushedTitles[0]).toContain(' - 08 ');
    expect(pushedTitles[1]).toContain(' - 09 ');

    const updatedSub = listSubscriptions()[0];
    expect(updatedSub.totalAutoDownloaded).toBe(2);
    expect(updatedSub.lastDownloadedEpisode).toBe(9);
    expect(getSubscriptionLogsList()).toHaveLength(2);

    // Second check with same feed must not re-download anything
    const pushedSecond: string[] = [];
    const summary2 = await checkSubscriptions(sub.id, {
      fetchRss: async () => feed,
      getTorrentsFn: async () => [],
      testConnFn: async () => ({
        ok: true,
        connected: true,
        qbRunning: true,
        exeExists: true,
      }),
      addDownloadFn: async (req) => {
        pushedSecond.push(req.title);
        return { ok: true, savePath: animeFolder };
      },
      notifyFn: vi.fn(),
    });

    expect(summary2.newDownloads).toBe(0);
    expect(pushedSecond).toHaveLength(0);

    deleteSubscription(sub.id);
    expect(listSubscriptions()).toHaveLength(0);
  });

  it('does not mark releases as downloaded when qBittorrent is offline so they retry next check', async () => {
    const animeFolder = path.join(downloadDir, 'RetryAnime');
    fs.mkdirSync(animeFolder, { recursive: true });

    const sub = upsertSubscription({
      bangumiId: '4000',
      bangumiTitle: '重试测试番',
      subgroupId: '370',
      subgroupName: 'LoliHouse',
      rssUrl: 'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=4000&subgroupid=370',
      savePath: animeFolder,
      startAfterEpisode: 7,
    });

    const feed = [makeRelease(8)];

    const offlineSummary = await checkSubscriptions(sub.id, {
      fetchRss: async () => feed,
      getTorrentsFn: async () => [],
      testConnFn: async () => ({
        ok: false,
        connected: false,
        error: 'qB 未连接',
        qbRunning: false,
        exeExists: true,
      }),
      notifyFn: vi.fn(),
    });

    expect(offlineSummary.newDownloads).toBe(0);
    expect(offlineSummary.errors).toBe(1);
    expect(listSubscriptions()[0].downloadedReleaseIds).toHaveLength(0);
    expect(listSubscriptions()[0].lastError).toContain('qB 未连接');

    // Once qB comes online, episode 8 is downloaded automatically
    const onlineSummary = await checkSubscriptions(sub.id, {
      fetchRss: async () => feed,
      getTorrentsFn: async () => [],
      testConnFn: async () => ({
        ok: true,
        connected: true,
        qbRunning: true,
        exeExists: true,
      }),
      addDownloadFn: async () => ({ ok: true, savePath: animeFolder }),
      notifyFn: vi.fn(),
    });

    expect(onlineSummary.newDownloads).toBe(1);
    expect(onlineSummary.errors).toBe(0);
    expect(listSubscriptions()[0].totalAutoDownloaded).toBe(1);
  });

  it('detects subtitle languages in strict mutually-exclusive buckets without false positives', () => {
    expect(detectSubtitleLanguage('[ANi] 胆大党 - 01 [1080P][Baha][WEB-DL][CHT].mp4')).toMatchObject({
      category: 'cht',
      hasCht: true,
      hasChs: false,
      isBilingual: false,
    });
    expect(detectSubtitleLanguage('[LoliHouse] 葬送的芙莉莲 - 01 [WebRip 1080p][简繁内封].mkv')).toMatchObject({
      category: 'bilingual',
      hasChs: true,
      hasCht: true,
      isBilingual: true,
    });
    expect(detectSubtitleLanguage('[Sakurato] Frieren - 05 [1080p][简日内嵌].mkv')).toMatchObject({
      category: 'chs_jp',
      hasChs: true,
      hasCht: false,
      isChsJp: true,
    });
    expect(detectSubtitleLanguage('[Sub] Anime - 05 [1080p][繁日双语].mkv')).toMatchObject({
      category: 'cht_jp',
      hasCht: true,
      hasChs: false,
      isChtJp: true,
    });
    expect(detectSubtitleLanguage('[Sub] Anime - 05 [1080p][RAW][JPN].mkv')).toMatchObject({
      category: 'raw',
      isRawOrJpnOnly: true,
      hasChs: false,
      hasCht: false,
    });
    // Ensure "1.2 GB" and "Disc" do NOT false-match GB/SC
    expect(detectSubtitleLanguage('[Sub] Episode 01 [1080p Disc 1.2 GB].mkv')).toMatchObject({
      category: 'unknown',
      hasChs: false,
      hasCht: false,
      isBilingual: false,
    });
    expect(detectSubtitleLanguage('[Raw] Episode 01 [1080p Disc 1.2 GB].mkv')).toMatchObject({
      category: 'raw',
      hasChs: false,
      hasCht: false,
      isBilingual: false,
    });

    expect(matchesSubtitleLanguage('[Sub] Ep 01 [GB][1080p]', 'chs')).toBe(true);
    expect(matchesSubtitleLanguage('[Sub] Ep 01 [BIG5][1080p]', 'chs')).toBe(false);
    // Strict mutually-exclusive matching: 简日 belongs ONLY to chs_jp, 简繁 belongs ONLY to bilingual
    expect(matchesSubtitleLanguage('[Sub] Ep 01 [简日][1080p]', 'chs_jp')).toBe(true);
    expect(matchesSubtitleLanguage('[Sub] Ep 01 [简日][1080p]', 'chs')).toBe(false);
    expect(matchesSubtitleLanguage('[Sub] Ep 01 [简繁][1080p]', 'bilingual')).toBe(true);
    expect(matchesSubtitleLanguage('[Sub] Ep 01 [简繁][1080p]', 'chs')).toBe(false);

    expect(
      inferCommonSubtitleLanguage([
        '[Sub] Anime - 01 [1080p][简日]',
        '[Sub] Anime - 02 [1080p][简日]',
      ]),
    ).toBe('chs_jp');
    expect(
      inferCommonSubtitleLanguage([
        '[Sub] Anime - 01 [1080p][CHS]',
        '[Sub] Anime - 01 [1080p][CHT]',
      ]),
    ).toBe('all');
  });

  it('classifies real FX战士久留美 and seasonal Mikan releases cleanly without overlapping counts', () => {
    // 悠哈璃羽字幕社 sample: CHS_JP, CHT_JP, and CHS_JP&CHT_JP[简繁日内封]
    const youhaTitles = [
      '【悠哈璃羽字幕社】[FX战士久留美 / FX Senshi Kurumi-chan][08][1080p HEVC][CHT_JP][繁日内嵌]',
      '【悠哈璃羽字幕社】[FX战士久留美 / FX Senshi Kurumi-chan][08][1080p HEVC][CHS_JP][简日内嵌]',
      '【悠哈璃羽字幕社】[FX战士久留美 / FX Senshi Kurumi-chan][04][1080p HEVC][CHS_JP&CHT_JP][简繁日内封]',
    ];
    expect(countSubtitleLanguages(youhaTitles).map((c) => [c.id, c.count])).toEqual([
      ['chs_jp', 1],
      ['cht_jp', 1],
      ['bilingual', 1],
    ]);

    // 北宇治字幕组 / 绿茶字幕组: [简繁日内封] MUST classify as bilingual, NOT cht_jp
    const kitaujiTitles = [
      '[北宇治字幕组] FX战士久留美 / FX战士久留美 / FX Senshi Kurumi-chan [03][WebRip][HEVC_AAC][简繁日内封]',
      '[北宇治字幕组] FX战士久留美 / FX Senshi Kurumi-chan [03][WebRip][HEVC_AAC][繁日内嵌]',
      '[北宇治字幕组] FX战士久留美 / FX Senshi Kurumi-chan [03][WebRip][HEVC_AAC][简日内嵌]',
    ];
    expect(classifySubtitleLanguage(kitaujiTitles[0])).toBe('bilingual');
    expect(classifySubtitleLanguage(kitaujiTitles[1])).toBe('cht_jp');
    expect(classifySubtitleLanguage(kitaujiTitles[2])).toBe('chs_jp');
    expect(countSubtitleLanguages(kitaujiTitles).map((c) => [c.id, c.count])).toEqual([
      ['chs_jp', 1],
      ['cht_jp', 1],
      ['bilingual', 1],
    ]);

    // 桜都字幕组: pure 简体 / pure 繁体 / 简繁内封
    const sakuratoTitles = [
      '[桜都字幕组] FX战士久留美 / FX Senshi Kurumi-chan [06][1080P][简繁内封]',
      '[桜都字幕组] FX战士久留美 / FX Senshi Kurumi-chan [06][1080P][繁体内嵌]',
      '[桜都字幕组] FX战士久留美 / FX Senshi Kurumi-chan [06][1080P][简体内嵌]',
    ];
    expect(countSubtitleLanguages(sakuratoTitles).map((c) => [c.id, c.count])).toEqual([
      ['chs', 1],
      ['cht', 1],
      ['bilingual', 1],
    ]);

    // LoliHouse [ASSx2], DBD-Raws [简繁外挂], DBFC [中日双语字幕], 黒ネズミたち (ABEMA / 日配版)
    expect(
      classifySubtitleLanguage('[LoliHouse] FX战士久留美 / FX Senshi Kurumi-chan - 02 [WebRip 1080p HEVC-10bit AAC ASSx2]'),
    ).toBe('bilingual');
    expect(
      classifySubtitleLanguage('[DBD-Raws][名侦探柯南剧场版29][1080P][BDRip][HEVC-10bit][简繁外挂][FLACx3][MKV]'),
    ).toBe('bilingual');
    expect(
      classifySubtitleLanguage('【DBFC字幕组】【龙珠超 比鲁斯】【007】【中日双语字幕】【1080P】【MP4】'),
    ).toBe('chs_jp');
    expect(
      classifySubtitleLanguage('[黒ネズミたち] FX 战士久留美 / FX Senshi Kurumi-chan - 08 (ABEMA 1920x1080 AVC AAC MKV)'),
    ).toBe('unknown');
    expect(
      classifySubtitleLanguage('[黒ネズミたち] 紫禁·御喵房（日配版） / Paws & Palaces (Japanese Dub) - 11 (ABEMA 1920x1080 AVC AAC MKV)'),
    ).toBe('unknown');
  });

  it('filters auto-chase subscription updates by languageFilter and avoids downloading duplicate language variants for the same episode', async () => {
    const animeFolder = path.join(downloadDir, 'LangFilterAnime');
    fs.mkdirSync(animeFolder, { recursive: true });

    const sub = upsertSubscription({
      bangumiId: '4100',
      bangumiTitle: '语言筛选测试番',
      subgroupId: '583',
      subgroupName: 'ANi',
      rssUrl: 'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=4100&subgroupid=583',
      savePath: animeFolder,
      startAfterEpisode: 7,
      languageFilter: 'chs_jp',
    });

    const feed: MikanRelease[] = [
      { ...makeRelease(8, '[1080p][繁日内嵌]'), id: 'ep8-chtjp', title: '[悠哈璃羽] 测试番 - 08 [1080p][繁日内嵌]' },
      { ...makeRelease(8, '[1080p][简日内嵌]'), id: 'ep8-chsjp', title: '[悠哈璃羽] 测试番 - 08 [1080p][简日内嵌]' },
      { ...makeRelease(8, '[1080p][简日内嵌 v2]'), id: 'ep8-chsjp-v2', title: '[悠哈璃羽] 测试番 - 08 [1080p][简日内嵌]' },
      { ...makeRelease(9, '[1080p][简繁日内封]'), id: 'ep9-bilingual', title: '[悠哈璃羽] 测试番 - 09 [1080p][简繁日内封]' },
    ];

    const pushedTitles: string[] = [];
    const addMock = vi.fn(async (req: { title: string }) => {
      pushedTitles.push(req.title);
      return { ok: true, savePath: animeFolder };
    });
    const summary = await checkSubscriptions(sub.id, {
      fetchRss: async () => feed,
      getTorrentsFn: async () => [],
      testConnFn: async () => ({ ok: true, connected: true, qbRunning: true, exeExists: true }),
      addDownloadFn: addMock,
      notifyFn: vi.fn(),
    });

    // Only ONE 简日双语 variant of Ep 8 is downloaded; 繁日内嵌 Ep 8 & 简繁日内封 Ep 9 are skipped, and second 简日 Ep 8 is deduplicated
    expect(summary.newDownloads).toBe(1);
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(pushedTitles[0]).toContain('08');
    expect(pushedTitles[0]).toContain('简日内嵌');
  });

  it('preserves concurrent subscription additions/edits made while RSS checks are in-flight', async () => {
    const animeFolder = path.join(downloadDir, 'ConcurrentAnime');
    fs.mkdirSync(animeFolder, { recursive: true });

    const subA = upsertSubscription({
      bangumiId: '4201',
      bangumiTitle: '并发测试番A',
      subgroupId: '100',
      subgroupName: 'SubA',
      rssUrl: 'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=4201&subgroupid=100',
      savePath: animeFolder,
      startAfterEpisode: 0,
    });

    let releaseRssFetch!: (items: MikanRelease[]) => void;
    const rssPromise = new Promise<MikanRelease[]>((resolve) => {
      releaseRssFetch = resolve;
    });

    const checkPromise = checkSubscriptions(undefined, {
      fetchRss: async () => rssPromise,
      getTorrentsFn: async () => [],
      testConnFn: async () => ({ ok: true, connected: true, qbRunning: true, exeExists: true }),
      addDownloadFn: async () => ({ ok: true, savePath: animeFolder }),
      notifyFn: vi.fn(),
    });

    // Simulate user adding a second subscription and updating includeKeywords while RSS fetch is still in flight
    await new Promise((r) => setTimeout(r, 20));
    upsertSubscription({
      id: subA.id,
      bangumiId: '4201',
      bangumiTitle: '并发测试番A',
      subgroupId: '100',
      subgroupName: 'SubA',
      rssUrl: 'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=4201&subgroupid=100',
      savePath: animeFolder,
      startAfterEpisode: 0,
      includeKeywords: 'HEVC',
    });
    const subB = upsertSubscription({
      bangumiId: '4202',
      bangumiTitle: '并发测试番B',
      subgroupId: '200',
      subgroupName: 'SubB',
      rssUrl: 'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=4202&subgroupid=200',
      savePath: animeFolder,
      startAfterEpisode: 0,
    });

    releaseRssFetch([makeRelease(1)]);
    const summary = await checkPromise;
    expect(summary.newDownloads).toBe(1);

    const allAfter = listSubscriptions();
    expect(allAfter.some((s) => s.id === subB.id)).toBe(true);
    expect(allAfter.find((s) => s.id === subA.id)?.includeKeywords).toBe('HEVC');
    expect(allAfter.find((s) => s.id === subA.id)?.totalAutoDownloaded).toBe(1);
  });

  it('async detects nested local episode directories without missing deeper season folders', async () => {
    const nestedDir = path.join(downloadDir, 'NestedProgress', 'Season 2');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, '[ANi] Sample - 11 [1080P].mp4'), 'ep11');
    fs.writeFileSync(path.join(nestedDir, '[ANi] Sample - 12 [1080P].mp4'), 'ep12');

    const hint = await detectLocalProgress('4300', 'NestedProgress', path.join(downloadDir, 'NestedProgress'));
    expect(hint.episodeCount).toBe(2);
    expect(hint.maxEpisodeNumber).toBe(12);
    expect(hint.detectedSubgroup).toBe('ANi');
  });
});

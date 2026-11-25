import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recordDownloadMeta,
  setDataDirForTesting,
  updateSettings,
} from '../../electron/services/configStore';
import {
  cleanSearchQueryForScrape,
  cleanSeriesTitleFromFileName,
  getHiddenLibraryCount,
  parseEpisodeNumber,
  pickBestBangumiMatch,
  playEpisode,
  removeEpisodeFromLibrary,
  removeSeriesFromLibrary,
  restoreHiddenLibraryItems,
  scanLibrary,
  scrapeSeries,
  toggleWatched,
} from '../../electron/services/libraryService';
import type { FetchLike } from '../../electron/services/mikanService';

describe('libraryService', () => {
  let tmpDir: string;
  let mainRoot: string;
  let extraRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikanvault-lib-test-'));
    mainRoot = path.join(tmpDir, 'MikanVault');
    extraRoot = path.join(tmpDir, 'ExtraAnime');
    fs.mkdirSync(mainRoot, { recursive: true });
    fs.mkdirSync(extraRoot, { recursive: true });

    setDataDirForTesting(path.join(tmpDir, 'app-data'));
    updateSettings({
      downloadRootDir: mainRoot,
      extraLibraryDirs: [extraRoot],
      playerMode: 'system',
      googleDriveEnabled: false,
      googleDriveDir: '',
      googleDriveIncludeInLibrary: false,
    });
  });

  afterEach(() => {
    setDataDirForTesting(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parseEpisodeNumber & cleanSeriesTitleFromFileName', () => {
    it('parses diverse fansub episode patterns accurately without matching resolutions or years', () => {
      expect(
        parseEpisodeNumber('[LoliHouse] 转生就是剑 S2 - 05 [WebRip 1080p HEVC-10bit][简繁].mkv'),
      ).toBe(5);
      expect(parseEpisodeNumber('[ANi] 葬送的芙莉莲 [12][1080P][Baha].mp4')).toBe(12);
      expect(parseEpisodeNumber('Frieren.S01E08.1080p.WEB-DL.x265.mkv')).toBe(8);
      expect(parseEpisodeNumber('名侦探柯南 第03话 1080P.mp4')).toBe(3);
      expect(parseEpisodeNumber('[Sub] Special - 12.5v2 [2160p].mkv')).toBe(12.5);
      expect(parseEpisodeNumber('[Raw] Movie 2026 [1080p x265].mkv')).toBeUndefined();
    });

    it('derives clean series title from loose fansub filename', () => {
      expect(
        cleanSeriesTitleFromFileName('[ANi] 胆大党 - 01 [1080P][Baha][WEB-DL][AAC AVC][CHT].mp4'),
      ).toBe('胆大党');
      expect(cleanSeriesTitleFromFileName('Frieren.S01E02.1080p.mkv')).toBe('Frieren');
    });
  });

  describe('scanLibrary, metadata matching & watched state', () => {
    it('scans multiple roots, groups series, attaches Mikan cover metadata, sorts episodes numerically, and tracks watched state', async () => {
      const seriesDir = path.join(mainRoot, '转生就是剑 第二季');
      fs.mkdirSync(seriesDir, { recursive: true });

      const ep10 = path.join(seriesDir, '[LoliHouse] 转生就是剑 S2 - 10 [WebRip 1080p HEVC].mkv');
      const ep02 = path.join(seriesDir, '[LoliHouse] 转生就是剑 S2 - 02 [WebRip 1080p HEVC].mkv');
      const ep01 = path.join(seriesDir, '[LoliHouse] 转生就是剑 S2 - 01 [WebRip 1080p HEVC].mkv');
      const subtitleFile = path.join(seriesDir, 'ep01.ass');

      fs.writeFileSync(ep10, 'video-10');
      fs.writeFileSync(ep02, 'video-02');
      fs.writeFileSync(ep01, 'video-01');
      fs.writeFileSync(subtitleFile, 'subtitle-ignored');

      // Loose video files in extra root
      const loose1 = path.join(extraRoot, '[ANi] 胆大党 - 01 [1080P][简中].mp4');
      const loose2 = path.join(extraRoot, '[ANi] 胆大党 - 02 [1080P][简中].mp4');
      fs.writeFileSync(loose1, 'loose-1');
      fs.writeFileSync(loose2, 'loose-2');

      // Record Mikan cover metadata for the downloaded folder
      recordDownloadMeta({
        title: '[LoliHouse] 转生就是剑 S2 - 01',
        bangumiId: '4056',
        bangumiTitle: '转生就是剑 第二季',
        coverUrl: 'https://mikanani.kas.pub/images/Bangumi/202610/6c0b660f.jpg',
        savePath: seriesDir,
      });

      const series = await scanLibrary();
      expect(series).toHaveLength(2);

      const sword = series.find((s) => s.title === '转生就是剑 第二季');
      expect(sword).toBeDefined();
      expect(sword!.bangumiId).toBe('4056');
      expect(sword!.coverUrl).toBe('https://mikanani.kas.pub/images/Bangumi/202610/6c0b660f.jpg');
      expect(sword!.totalEpisodes).toBe(3);
      expect(sword!.watchedCount).toBe(0);
      expect(sword!.episodes.map((e) => e.episodeNumber)).toEqual([1, 2, 10]);
      expect(sword!.episodes[0].resolution).toBe('1080P');
      expect(sword!.episodes[0].tags).toContain('HEVC');

      const dandadan = series.find((s) => s.title === '胆大党');
      expect(dandadan).toBeDefined();
      expect(dandadan!.totalEpisodes).toBe(2);

      // Mark ep01 watched via toggleWatched and ep02 via playEpisode
      const toggleRes = await toggleWatched(ep01, true);
      expect(toggleRes.ok).toBe(true);

      const playRes = await playEpisode(ep02);
      expect(playRes.ok).toBe(true);

      const rescanned = await scanLibrary();
      const swordAfter = rescanned.find((s) => s.title === '转生就是剑 第二季')!;
      expect(swordAfter.watchedCount).toBe(2);
      expect(swordAfter.episodes[0].watched).toBe(true);
      expect(swordAfter.episodes[1].watched).toBe(true);
      expect(swordAfter.episodes[1].lastPlayedAt).toBeGreaterThan(0);
      expect(swordAfter.episodes[2].watched).toBe(false);

      // Missing file returns error cleanly
      const missingRes = await playEpisode(path.join(seriesDir, 'does-not-exist.mkv'));
      expect(missingRes.ok).toBe(false);
    });
  });

  describe('scraping metadata & safe right-click removal', () => {
    it('cleans folder titles for scraping and scores best Mikan candidate', () => {
      expect(
        cleanSearchQueryForScrape('[VCB-Studio] 命运石之门 / Steins;Gate [Ma10p_1080p][BDRip][简繁外挂] (2011)'),
      ).toBe('命运石之门 / Steins;Gate');

      const best = pickBestBangumiMatch('命运石之门', [
        { id: '1859', title: '命运石之门 0', coverUrl: '', updateDay: -1, hasUpdate: false },
        { id: '1610', title: '命运石之门', coverUrl: '', updateDay: -1, hasUpdate: false },
      ]);
      expect(best?.id).toBe('1610');

      expect(cleanSearchQueryForScrape('[百冬练习组][1080p][简体内嵌]（05）')).toBe('');
      expect(cleanSearchQueryForScrape('Look Back（剧场版）')).toBe('Look Back');
      expect(
        pickBestBangumiMatch('Look Back', [
          { id: '327', title: '龙珠改 魔人布欧篇', coverUrl: '', updateDay: -1, hasUpdate: false },
        ]),
      ).toBeNull();
    });

    it('falls back to video filename inside folder when folder name has no anime title', async () => {
      const seriesDir = path.join(mainRoot, '[百冬练习组][1080p][简体内嵌]（05）');
      fs.mkdirSync(seriesDir, { recursive: true });
      fs.writeFileSync(
        path.join(seriesDir, '[hyakuhuyu][BanG Dream Yumemita][01][1080p AVC AAC][CHS].mp4'),
        'video',
      );

      const initial = await scanLibrary();
      expect(initial).toHaveLength(1);

      const mockFetch: FetchLike = vi.fn(async (url: string) => {
        if (url.includes('/Home/Search') && url.includes('BanG')) {
          return new Response(
            `<ul class="an-ul"><li><a href="/Home/Bangumi/4038"><span data-src="/images/Bangumi/2026/ym.jpg"></span><div class="an-text">BanG Dream! YUME∞MITA</div></a></li></ul>`,
            { status: 200 },
          );
        }
        if (url.includes('/Home/Bangumi/4038')) {
          return new Response(
            `<div class="bangumi-poster" style="background-image: url('/images/Bangumi/2026/ym.jpg');"></div><p class="bangumi-title">BanG Dream! YUME∞MITA</p>`,
            { status: 200 },
          );
        }
        return new Response('', { status: 404 });
      });

      const res = await scrapeSeries(
        {
          seriesId: initial[0].seriesId,
          folderPath: initial[0].folderPath,
          currentTitle: initial[0].title,
        },
        mockFetch,
      );

      expect(res.ok).toBe(true);
      expect(res.bangumiId).toBe('4038');
      expect(res.matchedTitle).toBe('BanG Dream! YUME∞MITA');
    });

    it('scrapes series metadata via Mikan and persists across scanLibrary()', async () => {
      const seriesDir = path.join(mainRoot, '[VCB-Studio] 命运石之门 [1080p][BDRip]');
      fs.mkdirSync(seriesDir, { recursive: true });
      const ep01 = path.join(seriesDir, 'Steins.Gate.01.mkv');
      fs.writeFileSync(ep01, 'sg-01');

      const initial = await scanLibrary();
      expect(initial).toHaveLength(1);
      expect(initial[0].coverUrl).toBeUndefined();

      const mockFetch: FetchLike = vi.fn(async (url: string) => {
        if (url.includes('/Home/Search')) {
          return new Response(
            `<ul class="an-ul"><li><a href="/Home/Bangumi/1610"><span data-src="/images/Bangumi/2011/sg.jpg"></span><div class="an-text">命运石之门</div></a></li></ul>`,
            { status: 200 },
          );
        }
        if (url.includes('/Home/Bangumi/1610')) {
          return new Response(
            `
              <div class="bangumi-poster" style="background-image: url('/images/Bangumi/2011/sg.jpg');"></div>
              <p class="bangumi-title">命运石之门</p>
              <p class="bangumi-info">放送开始：2011-04-06</p>
              <p class="bangumi-info">总集数：24</p>
            `,
            { status: 200 },
          );
        }
        return new Response('', { status: 404 });
      });

      const scrapeRes = await scrapeSeries(
        {
          seriesId: initial[0].seriesId,
          folderPath: initial[0].folderPath,
          currentTitle: initial[0].title,
        },
        mockFetch,
      );

      expect(scrapeRes.ok).toBe(true);
      expect(scrapeRes.matchedTitle).toBe('命运石之门');
      expect(scrapeRes.bangumiId).toBe('1610');

      const rescanned = await scanLibrary();
      expect(rescanned).toHaveLength(1);
      expect(rescanned[0].title).toBe('命运石之门');
      expect(rescanned[0].bangumiId).toBe('1610');
      expect(rescanned[0].coverUrl).toBe('https://mikanani.kas.pub/images/Bangumi/2011/sg.jpg');
      expect(rescanned[0].airDate).toBe('2011-04-06');
      expect(rescanned[0].scrapedAt).toBeGreaterThan(0);
    });

    it('safely hides removed series and episodes without deleting local files, and restores them on demand', async () => {
      const seriesDir = path.join(mainRoot, '轻音少女');
      fs.mkdirSync(seriesDir, { recursive: true });
      const ep01 = path.join(seriesDir, 'K-ON - 01.mkv');
      const ep02 = path.join(seriesDir, 'K-ON - 02.mkv');
      fs.writeFileSync(ep01, 'kon-01');
      fs.writeFileSync(ep02, 'kon-02');

      const list1 = await scanLibrary();
      expect(list1).toHaveLength(1);
      expect(list1[0].totalEpisodes).toBe(2);

      // Remove single episode without deleting file
      const rmEp = await removeEpisodeFromLibrary({ filePath: ep01, deleteFile: false });
      expect(rmEp.ok).toBe(true);
      expect(fs.existsSync(ep01)).toBe(true);
      expect(getHiddenLibraryCount()).toBe(1);

      const list2 = await scanLibrary();
      expect(list2[0].totalEpisodes).toBe(1);
      expect(list2[0].episodes[0].filePath).toBe(ep02);

      // Remove entire series without deleting files
      const rmSeries = await removeSeriesFromLibrary({
        seriesId: list2[0].seriesId,
        folderPath: list2[0].folderPath,
        filePaths: [ep01, ep02],
        deleteFiles: false,
      });
      expect(rmSeries.ok).toBe(true);
      expect(fs.existsSync(ep02)).toBe(true);
      expect(getHiddenLibraryCount()).toBe(2);
      expect(await scanLibrary()).toHaveLength(0);

      // Restore hidden items
      const restoreRes = restoreHiddenLibraryItems();
      expect(restoreRes.ok).toBe(true);
      expect(getHiddenLibraryCount()).toBe(0);
      const list3 = await scanLibrary();
      expect(list3).toHaveLength(1);
      expect(list3[0].totalEpisodes).toBe(2);
    });
  });
});

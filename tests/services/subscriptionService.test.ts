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
});

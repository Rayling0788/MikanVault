import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDataDirForTesting } from '../../electron/services/configStore';
import {
  expandSubgroupEpisodes,
  extractReleaseTags,
  getSchedule,
  mikanFetch,
  parseBangumiDetailHtml,
  parseExpandedEpisodesHtml,
  parseRssXml,
  parseScheduleHtml,
  parseSearchHtml,
  proxyImage,
  resolveMikanUrl,
  type FetchLike,
} from '../../electron/services/mikanService';

const BASE_URL = 'https://mikanani.kas.pub';

describe('mikanService', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikanvault-mikan-test-'));
    setDataDirForTesting(tmpDir);
  });

  afterEach(() => {
    setDataDirForTesting(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('extractReleaseTags', () => {
    it('extracts subgroup, resolution, source, codec, bit depth, and subtitle tags cleanly', () => {
      const title =
        '[DBD-Raws][名侦探柯南剧场版29][1080P][BDRip][HEVC-10bit][简繁外挂][FLACx3][MKV]';
      const tags = extractReleaseTags(title, 'DBD-Raws');
      expect(tags).toEqual(['DBD-Raws', '1080P', 'BDRip', 'HEVC', '10bit', '简繁', '外挂']);
    });

    it('detects 4K, AV1, WebRip, and 简繁日内封 without duplicates', () => {
      const title =
        '[LoliHouse] 转生就是剑 第二季 - 05 [WebRip 2160p AV1 10-bit][简繁日内封字幕]';
      const tags = extractReleaseTags(title, 'LoliHouse');
      expect(tags).toEqual(['LoliHouse', '4K', 'WebRip', 'AV1', '10bit', '简繁日', '内封']);
    });

    it('detects 简日内嵌 and 720P', () => {
      const title = '[ANi] 葬送的芙莉莲 - 12 [720p][x264][简日内嵌]';
      const tags = extractReleaseTags(title);
      expect(tags).toEqual(['720P', 'AVC', '简日', '内嵌']);
    });
  });

  describe('parseScheduleHtml', () => {
    it('parses seasonal schedule blocks in weekday order and decodes HTML entities', () => {
      const html = `
        <div class="sk-bangumi" data-dayofweek="7">
          <ul>
            <li>
              <span data-src="/images/Bangumi/202610/movie.jpg?width=400&amp;height=400" data-bangumiid="9001"></span>
              <div class="an-info">
                <a href="/Home/Bangumi/9001" class="an-text" title="剧场版示例">剧场版示例</a>
              </div>
            </li>
          </ul>
        </div>
        <div class="sk-bangumi" data-dayofweek="1">
          <ul>
            <li>
              <span data-src="/images/Bangumi/202610/6c0b660f.jpg?width=400&amp;height=400&amp;format=webp" data-bangumiid="4056"></span>
              <div class="num-node text-center">3</div>
              <div class="an-info">
                <div class="date-text">2026/11/24 更新</div>
                <a href="/Home/Bangumi/4056" class="an-text" title="转生就是剑 &amp; 魔法">转生就是剑 &amp; 魔法</a>
              </div>
            </li>
            <li>
              <span data-src="/images/Bangumi/202610/6c0b660f.jpg?width=400&amp;height=400&amp;format=webp" data-bangumiid="4056"></span>
              <a href="/Home/Bangumi/4056" class="an-text">Duplicate Should Be Skipped</a>
            </li>
          </ul>
        </div>
      `;

      const result = parseScheduleHtml(html, BASE_URL);
      expect(result.groups.map((g) => g.dayOfWeek)).toEqual([1, 7]);
      expect(result.groups[0].label).toBe('周一');
      expect(result.groups[0].items).toHaveLength(1);
      expect(result.groups[0].items[0]).toMatchObject({
        id: '4056',
        title: '转生就是剑 & 魔法',
        coverUrl: 'https://mikanani.kas.pub/images/Bangumi/202610/6c0b660f.jpg?width=400&height=400&format=webp',
        updateDay: 1,
        hasUpdate: true,
        updateDate: '2026/11/24 更新',
      });
      expect(result.groups[1].label).toBe('剧场版');
      expect(result.groups[1].items[0].hasUpdate).toBe(false);
    });
  });

  describe('parseBangumiDetailHtml', () => {
    it('parses detail poster, info lines, subgroup names without dropdown noise, and episode tables', () => {
      const html = `
        <div class="bangumi-poster" style="background-image: url('/images/Bangumi/202610/6c0b660f.jpg?width=400&amp;height=560');"></div>
        <p class="bangumi-title">转生就是剑 第二季</p>
        <p class="bangumi-info">放送日期：星期三</p>
        <p class="bangumi-info">总集数：12</p>

        <div class="subgroup-text" id="370">
          <a href="/Home/PublishGroup/223">LoliHouse</a>
          <a href="/RSS/Bangumi?bangumiId=4056&amp;subgroupid=370" class="mikan-rss"></a>
          <span class="subscribed">已订阅 订阅设置 繁中 简中 全部</span>
        </div>
        <div class="episode-table">
          <table>
            <tbody>
              <tr>
                <td>
                  <input type="checkbox" class="js-episode-select" data-magnet="magnet:?xt=urn:btih:0602be295ee6fe87ae70098c6a90f1ec62029f46&amp;tr=http://tracker.test" />
                </td>
                <td>
                  <a href="/Home/Episode/0602be295ee6fe87ae70098c6a90f1ec62029f46" class="magnet-link-wrap">[LoliHouse] 转生就是剑 S2 - 05 [WebRip 1080p HEVC-10bit][简繁日内封]</a>
                </td>
                <td>720.5MB</td>
                <td>2026/11/24 21:53</td>
                <td><a href="/Download/20261124/0602be295ee6fe87ae70098c6a90f1ec62029f46.torrent">dl</a></td>
                <td>play</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="subgroup-text" id="202">
          生肉/不明字幕
          <a href="/RSS/Bangumi?bangumiId=4056&amp;subgroupid=202" class="mikan-rss"></a>
        </div>
        <table>
          <tbody>
            <tr>
              <td>
                <a href="/Home/Episode/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" class="magnet-link-wrap">[Raw] Episode 05 [1080p]</a>
                <a class="js-magnet" data-clipboard-text="magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">[复制磁连]</a>
              </td>
              <td>1.2GB</td>
              <td>2026/11/24 20:00</td>
              <td><a href="/Download/20261124/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.torrent">dl</a></td>
            </tr>
          </tbody>
        </table>
      `;

      const detail = parseBangumiDetailHtml(html, '4056', BASE_URL);
      expect(detail.id).toBe('4056');
      expect(detail.title).toBe('转生就是剑 第二季');
      expect(detail.coverUrl).toBe(
        'https://mikanani.kas.pub/images/Bangumi/202610/6c0b660f.jpg?width=400&height=560',
      );
      expect(detail.infoLines).toEqual(['放送日期：星期三', '总集数：12']);
      expect(detail.subgroups).toHaveLength(2);

      // Subgroup 1: kas.pub 6-column layout with .episode-table wrapper
      expect(detail.subgroups[0].name).toBe('LoliHouse');
      expect(detail.subgroups[0].rssUrl).toBe(
        'https://mikanani.kas.pub/RSS/Bangumi?bangumiId=4056&subgroupid=370',
      );
      expect(detail.subgroups[0].episodes).toHaveLength(1);
      expect(detail.subgroups[0].episodes[0]).toMatchObject({
        id: '0602be295ee6fe87ae70098c6a90f1ec62029f46',
        size: '720.5MB',
        pubDate: '2026/11/24 21:53',
        torrentUrl:
          'https://mikanani.kas.pub/Download/20261124/0602be295ee6fe87ae70098c6a90f1ec62029f46.torrent',
        magnetUrl:
          'magnet:?xt=urn:btih:0602be295ee6fe87ae70098c6a90f1ec62029f46&tr=http://tracker.test',
      });
      expect(detail.subgroups[0].episodes[0].tags).toContain('HEVC');
      expect(detail.subgroups[0].episodes[0].tags).toContain('10bit');

      // Subgroup 2: classic 5-column layout without checkbox
      expect(detail.subgroups[1].name).toBe('生肉/不明字幕');
      expect(detail.subgroups[1].episodes).toHaveLength(1);
      expect(detail.subgroups[1].episodes[0].size).toBe('1.2GB');
      expect(detail.subgroups[1].episodes[0].magnetUrl).toBe(
        'magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      );
    });
  });

  describe('parseSearchHtml', () => {
    it('parses both bangumi cards and release rows', () => {
      const html = `
        <ul class="an-ul">
          <li>
            <a href="/Home/Bangumi/227">
              <span data-src="/images/Bangumi/201310/91d95f43.jpg"></span>
              <div class="an-text" title="名侦探柯南">名侦探柯南</div>
            </a>
          </li>
        </ul>
        <table>
          <tbody>
            <tr class="js-search-results-row">
              <td><input type="checkbox" data-magnet="magnet:?xt=urn:btih:3b181c8e8888d0e079886a26662d5e49d55bfc2a" /></td>
              <td><a href="/Home/Episode/3b181c8e8888d0e079886a26662d5e49d55bfc2a" class="magnet-link-wrap">[DBD-Raws][名侦探柯南][1080P][BDRip][HEVC]</a></td>
              <td>6.5GB</td>
              <td>2026/11/25 13:58</td>
              <td><a href="/Download/20261125/3b181c8e8888d0e079886a26662d5e49d55bfc2a.torrent">dl</a></td>
            </tr>
          </tbody>
        </table>
      `;

      const res = parseSearchHtml(html, '柯南', BASE_URL);
      expect(res.query).toBe('柯南');
      expect(res.bangumis).toHaveLength(1);
      expect(res.bangumis[0].id).toBe('227');
      expect(res.bangumis[0].title).toBe('名侦探柯南');
      expect(res.releases).toHaveLength(1);
      expect(res.releases[0].subgroup).toBe('DBD-Raws');
      expect(res.releases[0].size).toBe('6.5GB');
      expect(res.releases[0].sizeBytes).toBeGreaterThan(6_000_000_000);
    });
  });

  describe('parseRssXml', () => {
    it('parses Mikan RSS XML items with contentLength, pubDate, enclosure, and derived magnet', () => {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
        <rss version="2.0">
          <channel>
            <title>Mikan Project - 列表模式</title>
            <item>
              <title>[LoliHouse] 葬送的芙莉莲 - 01 [WebRip 1080p HEVC-10bit][简繁内封]</title>
              <link>https://mikanani.kas.pub/Home/Episode/1111222233334444555566667777888899990000</link>
              <description>[LoliHouse] 葬送的芙莉莲 - 01 [540MB]</description>
              <enclosure type="application/x-bittorrent" length="566231040" url="https://mikanani.kas.pub/Download/20261125/1111222233334444555566667777888899990000.torrent" />
              <torrent xmlns="https://mikanani.kas.pub/0.1/">
                <link>https://mikanani.kas.pub/Home/Episode/1111222233334444555566667777888899990000</link>
                <contentLength>566231040</contentLength>
                <pubDate>2026-11-25T13:58:00</pubDate>
              </torrent>
            </item>
          </channel>
        </rss>`;

      const items = parseRssXml(xml, BASE_URL);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: '1111222233334444555566667777888899990000',
        subgroup: 'LoliHouse',
        size: '540.0 MB',
        sizeBytes: 566231040,
        pubDate: '2026-11-25T13:58:00',
        torrentUrl:
          'https://mikanani.kas.pub/Download/20261125/1111222233334444555566667777888899990000.torrent',
        magnetUrl: 'magnet:?xt=urn:btih:1111222233334444555566667777888899990000',
      });
      expect(items[0].tags).toContain('1080P');
      expect(items[0].tags).toContain('HEVC');
      expect(items[0].tags).toContain('简繁');
    });
  });

  describe('resolveMikanUrl & proxyImage', () => {
    it('resolves bangumi, episode, RSS, and unknown URLs properly', async () => {
      const mockFetch: FetchLike = vi.fn(async (url: string) => {
        if (url.includes('/Home/Bangumi/4056')) {
          return new Response('<p class="bangumi-title">转生就是剑</p>', { status: 200 });
        }
        if (url.includes('/Home/Episode/')) {
          return new Response(
            `
            <p class="episode-title">[ANi] 示例 - 01 [1080P]</p>
            <p class="bangumi-title"><a href="/Home/Bangumi/4056">转生就是剑</a></p>
            <p class="bangumi-info">字幕组：ANi</p>
            <p class="bangumi-info">文件大小：420MB</p>
            <a href="magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12">magnet</a>
            <a href="/Download/20261125/abcdef1234567890abcdef1234567890abcdef12.torrent">dl</a>
            `,
            { status: 200 },
          );
        }
        if (url.includes('/RSS/')) {
          return new Response(
            '<rss version="2.0"><channel><item><title>[ANi] Test - 01</title><link>https://mikanani.kas.pub/Home/Episode/abcdef1234567890abcdef1234567890abcdef12</link></item></channel></rss>',
            { status: 200 },
          );
        }
        return new Response('Not found', { status: 404 });
      });

      const bangumiRes = await resolveMikanUrl(
        'https://mikanani.kas.pub/Home/Bangumi/4056',
        mockFetch,
      );
      expect(bangumiRes.kind).toBe('bangumi');
      if (bangumiRes.kind === 'bangumi') {
        expect(bangumiRes.bangumiId).toBe('4056');
        expect(bangumiRes.detail?.title).toBe('转生就是剑');
      }

      const epRes = await resolveMikanUrl(
        'https://mikanani.kas.pub/Home/Episode/abcdef1234567890abcdef1234567890abcdef12',
        mockFetch,
      );
      expect(epRes.kind).toBe('episode');
      if (epRes.kind === 'episode') {
        expect(epRes.bangumiId).toBe('4056');
        expect(epRes.release?.subgroup).toBe('ANi');
        expect(epRes.release?.size).toBe('420MB');
      }

      const rssRes = await resolveMikanUrl('https://mikanani.kas.pub/RSS/Classic', mockFetch);
      expect(rssRes.kind).toBe('rss');
      if (rssRes.kind === 'rss') {
        expect(rssRes.releases).toHaveLength(1);
      }

      const badRes = await resolveMikanUrl('https://example.com/random/page', mockFetch);
      expect(badRes.kind).toBe('unknown');
    });

    it('proxies image to data URL and serves subsequent calls from disk cache', async () => {
      const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const mockFetch = vi.fn(async () => {
        return new Response(fakePng, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      });

      const imgUrl = 'https://mikanani.kas.pub/images/Bangumi/202610/test.png';
      const dataUrl1 = await proxyImage(imgUrl, mockFetch);
      const dataUrl2 = await proxyImage(imgUrl, mockFetch);

      expect(dataUrl1).toBe(`data:image/png;base64,${fakePng.toString('base64')}`);
      expect(dataUrl2).toBe(dataUrl1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries transient socket/proxy errors up to 2 times and respects caller abort', async () => {
      let attempts = 0;
      const flakyFetch: FetchLike = vi.fn(async () => {
        attempts += 1;
        if (attempts <= 2) {
          throw new Error('net::ERR_CONNECTION_CLOSED');
        }
        return new Response('recovered', { status: 200 });
      });

      const res = await mikanFetch('https://mikanani.kas.pub/', {}, flakyFetch, [0, 0]);
      expect(res.ok).toBe(true);
      expect(await res.text()).toBe('recovered');
      expect(attempts).toBe(3);

      // Caller-aborted request must not retry
      const abortController = new AbortController();
      abortController.abort();
      const abortFetch: FetchLike = vi.fn(async () => {
        throw new Error('net::ERR_CONNECTION_CLOSED');
      });
      await expect(
        mikanFetch('https://mikanani.kas.pub/', { signal: abortController.signal }, abortFetch, [0, 0]),
      ).rejects.toThrow('ERR_CONNECTION_CLOSED');
      expect(abortFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('historical seasons & subgroup episode expansion', () => {
    it('extracts availableSeasons from schedule HTML and fetches historical seasons', async () => {
      const html = `
        <ul>
          <li><a data-year="2026" data-season="&#x79CB;">2026 秋</a></li>
          <li><a data-year="2020" data-season="&#x79CB;">2020 秋</a></li>
          <li><a data-year="2020" data-season="&#x79CB;">Duplicate</a></li>
        </ul>
        <div class="sk-bangumi" data-dayofweek="4">
          <ul>
            <li>
              <span data-src="/images/Bangumi/202010/1433.jpg" data-bangumiid="1433"></span>
              <a href="/Home/Bangumi/1433" class="an-text">老番示例</a>
            </li>
          </ul>
        </div>
      `;

      const parsed = parseScheduleHtml(html, BASE_URL, { year: 2020, season: '秋' });
      expect(parsed.year).toBe(2020);
      expect(parsed.season).toBe('秋');
      expect(parsed.availableSeasons).toEqual([
        { year: 2026, season: '秋' },
        { year: 2020, season: '秋' },
      ]);

      const mockFetch: FetchLike = vi.fn(async (url: string) => {
        expect(url).toContain('/Home/BangumiCoverFlowByDayOfWeek?year=2020&seasonStr=%E7%A7%8B');
        return new Response(html, { status: 200 });
      });
      const fetched = await getSchedule(2020, '秋', mockFetch);
      expect(fetched.groups[0].items[0].title).toBe('老番示例');
    });

    it('detects js-expand-episode hasMore flag and parses expanded episode fragments', async () => {
      const detailHtml = `
        <p class="bangumi-title">进击的巨人</p>
        <div class="subgroup-text" id="370">
          <a href="/Home/PublishGroup/223">LoliHouse</a>
        </div>
        <div class="episode-table">
          <table><tbody>
            <tr>
              <td><input type="checkbox" data-magnet="magnet:?xt=urn:btih:1111111111111111111111111111111111111111" /></td>
              <td><a href="/Home/Episode/1111111111111111111111111111111111111111" class="magnet-link-wrap">[LoliHouse] AOT - 15</a></td>
              <td>500MB</td>
              <td>2020/12/01</td>
              <td><a href="/Download/2020/1111.torrent">dl</a></td>
            </tr>
          </tbody></table>
        </div>
        <a class="js-expand-episode" data-bangumiid="2335" data-subtitlegroupid="370">展开</a>
      `;

      const detail = parseBangumiDetailHtml(detailHtml, '2335', BASE_URL);
      expect(detail.subgroups[0].hasMore).toBe(true);

      const fragmentHtml = `
        <table><tbody>
          <tr>
            <td><input type="checkbox" data-magnet="magnet:?xt=urn:btih:2222222222222222222222222222222222222222" /></td>
            <td><a href="/Home/Episode/2222222222222222222222222222222222222222" class="magnet-link-wrap">[LoliHouse] AOT - 01</a></td>
            <td>480MB</td>
            <td>2020/10/01</td>
            <td><a href="/Download/2020/2222.torrent">dl</a></td>
          </tr>
        </tbody></table>
      `;
      const directParsed = parseExpandedEpisodesHtml(fragmentHtml, '2335', '370', BASE_URL);
      expect(directParsed).toHaveLength(1);
      expect(directParsed[0].title).toBe('[LoliHouse] AOT - 01');

      const mockFetch: FetchLike = vi.fn(async (url: string) => {
        expect(url).toContain('/Home/ExpandEpisodeTable?bangumiId=2335&subtitleGroupId=370&take=200');
        return new Response(fragmentHtml, { status: 200 });
      });
      const expanded = await expandSubgroupEpisodes('2335', '370', 200, mockFetch);
      expect(expanded).toHaveLength(1);
      expect(expanded[0].id).toBe('2222222222222222222222222222222222222222');
    });
  });

  describe('proxyImage cache poisoning guards', () => {
    it('rejects and does not cache HTTP 200 text/html responses or empty bodies', async () => {
      let attempt = 0;
      const imageUrl = 'https://mikanani.kas.pub/images/Bangumi/202611/test-cover.jpg';
      const mockFetch: FetchLike = vi.fn(async () => {
        attempt += 1;
        if (attempt === 1) {
          return new Response('<html>Cloudflare challenge</html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        if (attempt === 2) {
          return new Response(new Uint8Array(0), {
            status: 200,
            headers: { 'Content-Type': 'image/jpeg' },
          });
        }
        return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        });
      });

      expect(await proxyImage(imageUrl, mockFetch)).toBe('');
      expect(await proxyImage(imageUrl, mockFetch)).toBe('');
      const okDataUrl = await proxyImage(imageUrl, mockFetch);
      expect(okDataUrl).toMatch(/^data:image\/jpeg;base64,/);
      expect(attempt).toBe(3);
    });
  });
});

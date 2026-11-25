import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSeriesMeta,
  parseQbIniContent,
  setDataDirForTesting,
  updateSettings,
} from '../../electron/services/configStore';
import type { FetchLike } from '../../electron/services/mikanService';
import {
  addDownload,
  addDownloadsBatch,
  clearQbSessionCache,
  controlTorrent,
  getTorrents,
  sanitizeFolderName,
  testConnection,
} from '../../electron/services/qbService';

describe('qbService & configStore', () => {
  let tmpDir: string;
  let downloadDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikanvault-qb-test-'));
    downloadDir = path.join(tmpDir, 'downloads');
    fs.mkdirSync(downloadDir, { recursive: true });
    setDataDirForTesting(tmpDir);
    clearQbSessionCache();
    updateSettings({
      qbUrl: 'http://127.0.0.1:8080',
      qbUsername: 'admin',
      qbPassword: 'secret',
      qbCategory: 'MikanVault',
      downloadRootDir: downloadDir,
    });
  });

  afterEach(() => {
    clearQbSessionCache();
    setDataDirForTesting(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses qBittorrent.ini WebUI port, username, and HTTPS flag safely', () => {
    const ini = `
      [Preferences]
      WebUI\\Enabled=true
      WebUI\\Port=9091
      WebUI\\Username="otaku"
      WebUI\\Address=*
      WebUI\\HTTPS\\Enabled=false
    `;
    expect(parseQbIniContent(ini)).toEqual({
      qbUrl: 'http://127.0.0.1:9091',
      qbUsername: 'otaku',
    });
  });

  it('sanitizes Windows-illegal folder characters cleanly', () => {
    expect(sanitizeFolderName('Re:从零开始的异世界生活? / 第3季*')).toBe(
      'Re 从零开始的异世界生活 第3季',
    );
  });

  it('authenticates with SID cookie and returns version on testConnection', async () => {
    const mockFetch: FetchLike = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v2/auth/login')) {
        expect(init?.method).toBe('POST');
        return new Response('Ok.', {
          status: 200,
          headers: { 'set-cookie': 'SID=test-sid-123; HttpOnly; Path=/' },
        });
      }
      if (url.endsWith('/api/v2/app/version')) {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Cookie).toBe('SID=test-sid-123');
        return new Response('v5.0.3', { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const status = await testConnection(undefined, mockFetch);
    expect(status.ok).toBe(true);
    expect(status.connected).toBe(true);
    expect(status.version).toBe('v5.0.3');
  });

  it('handles authentication failures and offline network errors gracefully', async () => {
    const failAuthFetch: FetchLike = vi.fn(async () => new Response('Fails.', { status: 200 }));
    const authStatus = await testConnection({ qbPassword: 'wrong' }, failAuthFetch);
    expect(authStatus.ok).toBe(false);
    expect(authStatus.connected).toBe(false);
    expect(authStatus.qbRunning).toBe(true);
    expect(authStatus.error).toContain('认证失败');

    const offlineFetch: FetchLike = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:8080');
    });
    const offlineStatus = await testConnection(undefined, offlineFetch);
    expect(offlineStatus.ok).toBe(false);
    expect(offlineStatus.connected).toBe(false);

    // getTorrents must not throw when offline
    const torrents = await getTorrents(offlineFetch);
    expect(torrents).toEqual([]);
  });

  it('auto re-authenticates when session expires with HTTP 403', async () => {
    let loginCount = 0;
    let infoCalls = 0;

    const mockFetch: FetchLike = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v2/auth/login')) {
        loginCount += 1;
        return new Response('Ok.', {
          status: 200,
          headers: { 'set-cookie': `SID=sid-${loginCount}; Path=/` },
        });
      }
      if (url.includes('/api/v2/torrents/info')) {
        infoCalls += 1;
        const headers = init?.headers as Record<string, string>;
        if (infoCalls === 1) {
          expect(headers.Cookie).toBe('SID=sid-1');
          return new Response('Forbidden', { status: 403 });
        }
        expect(headers.Cookie).toBe('SID=sid-2');
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('', { status: 404 });
    });

    const list = await getTorrents(mockFetch);
    expect(list).toEqual([]);
    expect(loginCount).toBe(2);
    expect(infoCalls).toBe(2);
  });

  it('downloads .torrent binary, uploads multipart to qB, records series metadata, and enriches getTorrents', async () => {
    let capturedFormData: FormData | null = null;
    const validBencodedTorrent = Buffer.from('d8:announce25:http://tracker.local/test4:infod4:name4:testee');
    const hash = '0602be295ee6fe87ae70098c6a90f1ec62029f46';

    const mockTorrentFetch: FetchLike = vi.fn(async () => {
      return new Response(validBencodedTorrent, {
        status: 200,
        headers: { 'Content-Type': 'application/x-bittorrent' },
      });
    });

    const mockQbFetch: FetchLike = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v2/auth/login')) {
        return new Response('Ok.', {
          status: 200,
          headers: { 'set-cookie': 'SID=sid-ok; Path=/' },
        });
      }
      if (url.endsWith('/api/v2/torrents/add')) {
        capturedFormData = init?.body as FormData;
        return new Response('Ok.', { status: 200 });
      }
      if (url.includes('/api/v2/torrents/info')) {
        return new Response(
          JSON.stringify([
            {
              hash,
              name: '[LoliHouse] 转生就是剑 S2 - 05.mkv',
              state: 'downloading',
              progress: 0.42,
              size: 755_000_000,
              dlspeed: 5_200_000,
              upspeed: 120_000,
              eta: 84,
              save_path: path.join(downloadDir, '转生就是剑 第二季'),
              category: 'MikanVault',
              added_on: 1764000000,
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('', { status: 404 });
    });

    const addRes = await addDownload(
      {
        title: '[LoliHouse] 转生就是剑 S2 - 05',
        bangumiId: '4056',
        bangumiTitle: '转生就是剑 第二季',
        coverUrl: 'https://mikanani.kas.pub/images/Bangumi/202610/6c0b660f.jpg',
        torrentUrl: `https://mikanani.kas.pub/Download/20261124/${hash}.torrent`,
        magnetUrl: `magnet:?xt=urn:btih:${hash}`,
      },
      mockQbFetch,
      mockTorrentFetch,
    );

    expect(addRes.ok).toBe(true);
    expect(addRes.hash).toBe(hash);
    expect(addRes.savePath).toBe(path.join(downloadDir, '转生就是剑 第二季'));
    expect(capturedFormData).not.toBeNull();
    expect(capturedFormData!.get('category')).toBe('MikanVault');
    expect(capturedFormData!.get('torrents')).toBeTruthy();
    expect(capturedFormData!.get('urls')).toBeNull();

    // Verify metadata persisted for library cover matching
    const seriesMeta = getSeriesMeta(addRes.savePath);
    expect(seriesMeta?.bangumiId).toBe('4056');
    expect(seriesMeta?.coverUrl).toContain('6c0b660f.jpg');

    // Verify getTorrents enriches metadata
    const torrents = await getTorrents(mockQbFetch);
    expect(torrents).toHaveLength(1);
    expect(torrents[0].bangumiId).toBe('4056');
    expect(torrents[0].bangumiTitle).toBe('转生就是剑 第二季');
    expect(torrents[0].coverUrl).toContain('6c0b660f.jpg');
  });

  it('falls back to magnetUrl when .torrent download fails', async () => {
    let capturedFormData: FormData | null = null;
    const mockTorrentFetch: FetchLike = vi.fn(async () => new Response('<html>error</html>', { status: 500 }));
    const mockQbFetch: FetchLike = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v2/auth/login')) {
        return new Response('Ok.', {
          status: 200,
          headers: { 'set-cookie': 'SID=sid-fallback; Path=/' },
        });
      }
      if (url.endsWith('/api/v2/torrents/add')) {
        capturedFormData = init?.body as FormData;
        return new Response('Ok.', { status: 200 });
      }
      return new Response('', { status: 404 });
    });

    const magnet = 'magnet:?xt=urn:btih:1111222233334444555566667777888899990000';
    const res = await addDownload(
      {
        title: 'Fallback Test',
        torrentUrl: 'https://mikanani.kas.pub/Download/bad.torrent',
        magnetUrl: magnet,
      },
      mockQbFetch,
      mockTorrentFetch,
    );

    expect(res.ok).toBe(true);
    expect(capturedFormData!.get('urls')).toBe(magnet);
    expect(capturedFormData!.get('torrents')).toBeNull();
  });

  it('supports pause/resume fallback from qB v5 (/stop,/start) to v4 (/pause,/resume) and delete', async () => {
    const calledUrls: string[] = [];
    const mockQbFetch: FetchLike = vi.fn(async (url: string) => {
      calledUrls.push(url);
      if (url.endsWith('/api/v2/auth/login')) {
        return new Response('Ok.', {
          status: 200,
          headers: { 'set-cookie': 'SID=sid-ctrl; Path=/' },
        });
      }
      if (url.endsWith('/api/v2/torrents/stop') || url.endsWith('/api/v2/torrents/start')) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response('', { status: 200 });
    });

    const pRes = await controlTorrent('abcd', 'pause', mockQbFetch);
    const rRes = await controlTorrent('abcd', 'resume', mockQbFetch);
    const dRes = await controlTorrent('abcd', 'deleteWithFiles', mockQbFetch);

    expect(pRes.ok).toBe(true);
    expect(rRes.ok).toBe(true);
    expect(dRes.ok).toBe(true);
    expect(calledUrls.some((u) => u.endsWith('/api/v2/torrents/stop'))).toBe(true);
    expect(calledUrls.some((u) => u.endsWith('/api/v2/torrents/pause'))).toBe(true);
    expect(calledUrls.some((u) => u.endsWith('/api/v2/torrents/start'))).toBe(true);
    expect(calledUrls.some((u) => u.endsWith('/api/v2/torrents/resume'))).toBe(true);
    expect(calledUrls.some((u) => u.endsWith('/api/v2/torrents/delete'))).toBe(true);
  });

  it('submits batch downloads and aggregates partial successes accurately', async () => {
    const validTorrent = Buffer.from('d8:announce25:http://tracker.local/test4:infod4:name4:testee');
    const mockTorrentFetch: FetchLike = vi.fn(async () => {
      return new Response(validTorrent, {
        status: 200,
        headers: { 'Content-Type': 'application/x-bittorrent' },
      });
    });

    const mockQbFetch: FetchLike = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v2/auth/login')) {
        return new Response('Ok.', {
          status: 200,
          headers: { 'set-cookie': 'SID=sid-batch; Path=/' },
        });
      }
      if (url.endsWith('/api/v2/torrents/add')) {
        return new Response('Ok.', { status: 200 });
      }
      return new Response('', { status: 404 });
    });

    const batchRes = await addDownloadsBatch(
      [
        {
          title: 'Ep 01',
          bangumiId: '1859',
          bangumiTitle: '命运石之门',
          torrentUrl: 'https://mikanani.kas.pub/Download/1111111111111111111111111111111111111111.torrent',
        },
        {
          title: 'Ep 02 (no links)',
          // Intentionally missing torrentUrl & magnetUrl to test partial failure isolation
        },
        {
          title: 'Ep 03',
          bangumiId: '1859',
          bangumiTitle: '命运石之门',
          magnetUrl: 'magnet:?xt=urn:btih:3333333333333333333333333333333333333333',
        },
      ],
      mockQbFetch,
      mockTorrentFetch,
    );

    expect(batchRes.total).toBe(3);
    expect(batchRes.succeeded).toBe(2);
    expect(batchRes.failed).toBe(1);
    expect(batchRes.results[0].ok).toBe(true);
    expect(batchRes.results[1].ok).toBe(false);
    expect(batchRes.results[2].ok).toBe(true);
  });

  it('automatically derives an anime subfolder from release title when bangumiTitle and savePath are omitted', async () => {
    const mockQbFetch: FetchLike = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v2/auth/login')) {
        return new Response('Ok.', {
          status: 200,
          headers: { 'set-cookie': 'SID=sid-sub; Path=/' },
        });
      }
      if (url.endsWith('/api/v2/torrents/add')) {
        return new Response('Ok.', { status: 200 });
      }
      return new Response('', { status: 404 });
    });

    const res = await addDownload(
      {
        title: '[LoliHouse] 葬送的芙莉莲 第二季 / Sousou no Frieren S2 - 12 [WebRip 1080p HEVC]',
        magnetUrl: 'magnet:?xt=urn:btih:4444444444444444444444444444444444444444',
      },
      mockQbFetch,
    );

    expect(res.ok).toBe(true);
    expect(res.savePath).toBe(path.join(downloadDir, '葬送的芙莉莲 第二季'));
  });
});

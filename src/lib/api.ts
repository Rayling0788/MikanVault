import type {
  ActionResult,
  AddDownloadRequest,
  AddDownloadResult,
  AppSettings,
  BatchAddDownloadResult,
  CloudDriveStatus,
  CloudTransferJob,
  CloudUploadLibraryRequest,
  CloudUploadLibraryResult,
  LibraryRemoveEpisodeRequest,
  LibraryRemoveSeriesRequest,
  LibraryScrapeAllResult,
  LibraryScrapeSeriesRequest,
  LibraryScrapeSeriesResult,
  LibrarySeries,
  LocalProgressHint,
  McpServerInfo,
  MikanApi,
  MikanBangumiDetail,
  MikanRelease,
  MikanResolvedUrl,
  MikanScheduleResponse,
  MikanSearchResult,
  MikanSeasonName,
  QbConnectionOverride,
  QbConnectionStatus,
  QbControlAction,
  QbLaunchResult,
  QbTorrentItem,
  SubscriptionCheckSummary,
  SubscriptionItem,
  SubscriptionLogEntry,
  UpsertSubscriptionRequest,
} from '@shared/types';
import {
  MOCK_LIBRARY,
  MOCK_RSS_RELEASES,
  MOCK_SCHEDULE,
  MOCK_SETTINGS,
  MOCK_TORRENTS,
  createMockBangumiDetail,
} from './mockData';
import { joinSavePath } from './format';

export const isElectronRuntime =
  typeof window !== 'undefined' && typeof window.mikanApi !== 'undefined';

// Stateful browser-preview fallback so UI inspection in Vite preview works seamlessly
let mockSettings: AppSettings = { ...MOCK_SETTINGS };
let mockTorrents: QbTorrentItem[] = MOCK_TORRENTS.map((t) => ({ ...t }));
let mockLibrary: LibrarySeries[] = MOCK_LIBRARY.map((s) => ({
  ...s,
  episodes: s.episodes.map((e) => ({ ...e })),
}));
let mockHiddenSeriesIds = new Set<string>();
let mockHiddenFilePaths = new Set<string>();
let mockSubscriptions: SubscriptionItem[] = [];
let mockSubLogs: SubscriptionLogEntry[] = [];
let mockQbConnected = true;

const mockApi: MikanApi = {
  async getSchedule(year?: number, season?: MikanSeasonName): Promise<MikanScheduleResponse> {
    return {
      ...MOCK_SCHEDULE,
      year: year ?? 2026,
      season: season ?? '秋',
      availableSeasons: [
        { year: 2026, season: '秋' },
        { year: 2026, season: '夏' },
        { year: 2026, season: '春' },
        { year: 2026, season: '冬' },
        { year: 2025, season: '秋' },
        { year: 2024, season: '秋' },
        { year: 2020, season: '秋' },
      ],
    };
  },

  async getBangumiDetail(id: string): Promise<MikanBangumiDetail> {
    return createMockBangumiDetail(id);
  },

  async expandSubgroupEpisodes(
    bangumiId: string,
    subgroupId: string,
    _take?: number,
  ): Promise<MikanRelease[]> {
    const detail = createMockBangumiDetail(bangumiId);
    const sg = detail.subgroups.find((s) => s.id === subgroupId) ?? detail.subgroups[0];
    return sg ? sg.episodes : [];
  },

  async searchMikan(query: string): Promise<MikanSearchResult> {
    const q = query.trim().toLowerCase();
    const allBangumis = MOCK_SCHEDULE.groups.flatMap((g) => g.items);
    const bangumis = q
      ? allBangumis.filter((b) => b.title.toLowerCase().includes(q))
      : allBangumis.slice(0, 6);
    const releases = q
      ? MOCK_RSS_RELEASES.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            (r.subgroup && r.subgroup.toLowerCase().includes(q))
        )
      : MOCK_RSS_RELEASES;
    return {
      query,
      bangumis: bangumis.length > 0 ? bangumis : allBangumis.slice(0, 3),
      releases: releases.length > 0 ? releases : MOCK_RSS_RELEASES.slice(0, 3),
    };
  },

  async getRssFeed(_rssUrl?: string): Promise<MikanRelease[]> {
    return MOCK_RSS_RELEASES;
  },

  async resolveMikanUrl(url: string): Promise<MikanResolvedUrl> {
    const trimmed = url.trim();
    const bangumiMatch = trimmed.match(/\/Home\/Bangumi\/(\d+)/i);
    if (bangumiMatch) {
      const id = bangumiMatch[1];
      return {
        kind: 'bangumi',
        bangumiId: id,
        url: trimmed,
        detail: createMockBangumiDetail(id),
      };
    }
    if (/\/RSS\//i.test(trimmed)) {
      return {
        kind: 'rss',
        rssUrl: trimmed,
        releases: MOCK_RSS_RELEASES,
      };
    }
    const epMatch = trimmed.match(/\/Home\/Episode\/([a-zA-Z0-9_-]+)/i);
    if (epMatch) {
      return {
        kind: 'episode',
        episodeHash: epMatch[1],
        url: trimmed,
        release: MOCK_RSS_RELEASES[0],
      };
    }
    return {
      kind: 'unknown',
      url: trimmed,
      error: '无法识别该蜜柑计划链接，请粘贴番剧主页、单集详情或 RSS 地址',
    };
  },

  async proxyImage(url: string): Promise<string> {
    return url;
  },

  async qbTestConnection(_override?: QbConnectionOverride): Promise<QbConnectionStatus> {
    return {
      ok: mockQbConnected,
      connected: mockQbConnected,
      version: mockQbConnected ? 'v5.0.3 (Preview)' : undefined,
      error: mockQbConnected ? undefined : '预览模式：qBittorrent 未连接',
      qbRunning: mockQbConnected,
      exeExists: true,
    };
  },

  async qbLaunch(): Promise<QbLaunchResult> {
    mockQbConnected = true;
    return { ok: true };
  },

  async qbAddDownload(req: AddDownloadRequest): Promise<AddDownloadResult> {
    const savePath = req.savePath || joinSavePath(mockSettings.downloadRootDir, req.bangumiTitle);
    const hash = `preview-${Date.now().toString(16)}`;
    mockTorrents = [
      {
        hash,
        name: req.title,
        state: 'downloading',
        progress: 0.04,
        size: 620_000_000,
        downloaded: 24_800_000,
        dlspeed: 5_200_000,
        upspeed: 180_000,
        eta: 114,
        ratio: 0,
        savePath,
        category: req.category || mockSettings.qbCategory || 'mikan',
        addedOn: Math.floor(Date.now() / 1000),
        bangumiId: req.bangumiId,
        bangumiTitle: req.bangumiTitle,
        coverUrl: req.coverUrl,
      },
      ...mockTorrents,
    ];
    return { ok: true, hash, savePath };
  },

  async qbAddDownloadBatch(requests: AddDownloadRequest[]): Promise<BatchAddDownloadResult> {
    const results = [];
    for (const req of requests) {
      const res = await this.qbAddDownload(req);
      results.push({
        title: req.title,
        ok: res.ok,
        hash: res.hash,
        savePath: res.savePath,
        error: res.error,
      });
    }
    const succeeded = results.filter((r) => r.ok).length;
    return {
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
      results,
    };
  },

  async qbGetTorrents(): Promise<QbTorrentItem[]> {
    if (!mockQbConnected) return [];
    return mockTorrents;
  },

  async qbControlTorrent(hash: string, action: QbControlAction): Promise<ActionResult> {
    if (action === 'delete' || action === 'deleteWithFiles') {
      mockTorrents = mockTorrents.filter((t) => t.hash !== hash);
      return { ok: true };
    }
    mockTorrents = mockTorrents.map((t) => {
      if (t.hash !== hash) return t;
      if (action === 'pause') {
        return { ...t, state: 'pausedDL', dlspeed: 0, upspeed: 0 };
      }
      return { ...t, state: t.progress >= 1 ? 'uploading' : 'downloading', dlspeed: t.progress >= 1 ? 0 : 4_200_000 };
    });
    return { ok: true };
  },

  async libraryScan(): Promise<LibrarySeries[]> {
    return mockLibrary
      .filter((s) => !mockHiddenSeriesIds.has(s.seriesId))
      .map((s) => {
        const episodes = s.episodes
          .filter((e) => !mockHiddenFilePaths.has(e.filePath))
          .map((e) => ({ ...e }));
        return {
          ...s,
          episodes,
          totalEpisodes: episodes.length,
          watchedCount: episodes.filter((e) => e.watched).length,
        };
      })
      .filter((s) => s.episodes.length > 0);
  },

  async libraryPlay(filePath: string): Promise<ActionResult> {
    mockLibrary = mockLibrary.map((s) => {
      const episodes = s.episodes.map((e) =>
        e.filePath === filePath ? { ...e, watched: true, lastPlayedAt: Date.now() } : e
      );
      return {
        ...s,
        episodes,
        watchedCount: episodes.filter((e) => e.watched).length,
      };
    });
    return { ok: true };
  },

  async libraryToggleWatched(filePath: string, watched: boolean): Promise<ActionResult> {
    mockLibrary = mockLibrary.map((s) => {
      const episodes = s.episodes.map((e) => (e.filePath === filePath ? { ...e, watched } : e));
      return {
        ...s,
        episodes,
        watchedCount: episodes.filter((e) => e.watched).length,
      };
    });
    return { ok: true };
  },

  async libraryOpenFolder(_targetPath: string): Promise<ActionResult> {
    return { ok: true };
  },

  async libraryScrapeSeries(req: LibraryScrapeSeriesRequest): Promise<LibraryScrapeSeriesResult> {
    const allBangumis = MOCK_SCHEDULE.groups.flatMap((g) => g.items);
    const matched =
      (req.bangumiId ? allBangumis.find((b) => b.id === req.bangumiId) : undefined) ||
      allBangumis[0];
    mockLibrary = mockLibrary.map((s) =>
      s.seriesId === req.seriesId
        ? {
            ...s,
            title: matched?.title || req.currentTitle,
            bangumiId: matched?.id,
            coverUrl: matched?.coverUrl || s.coverUrl,
            infoLines: ['放送日期：每周五 23:00', '蜜柑计划元数据已刮削'],
            rating: 8.6,
            airDate: '2026-04-03',
            scrapedAt: Date.now(),
          }
        : s
    );
    return {
      ok: true,
      matchedTitle: matched?.title || req.currentTitle,
      bangumiId: matched?.id,
      coverUrl: matched?.coverUrl,
    };
  },

  async libraryScrapeAll(forceAll = false): Promise<LibraryScrapeAllResult> {
    const targets = forceAll ? mockLibrary : mockLibrary.filter((s) => !s.scrapedAt);
    const results = [];
    for (const s of targets) {
      const r = await this.libraryScrapeSeries({
        seriesId: s.seriesId,
        folderPath: s.folderPath,
        currentTitle: s.title,
      });
      results.push({
        seriesId: s.seriesId,
        title: s.title,
        ok: r.ok,
        matchedTitle: r.matchedTitle,
        error: r.error,
      });
    }
    return {
      total: mockLibrary.length,
      matched: results.filter((r) => r.ok).length,
      skipped: mockLibrary.length - targets.length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  },

  async libraryRemoveSeries(req: LibraryRemoveSeriesRequest): Promise<ActionResult> {
    mockHiddenSeriesIds.add(req.seriesId);
    return { ok: true };
  },

  async libraryRemoveEpisode(req: LibraryRemoveEpisodeRequest): Promise<ActionResult> {
    mockHiddenFilePaths.add(req.filePath);
    return { ok: true };
  },

  async libraryRestoreHidden(): Promise<ActionResult> {
    mockHiddenSeriesIds = new Set();
    mockHiddenFilePaths = new Set();
    return { ok: true };
  },

  async libraryGetHiddenCount(): Promise<number> {
    return mockHiddenSeriesIds.size + mockHiddenFilePaths.size;
  },

  async subList(): Promise<SubscriptionItem[]> {
    return [...mockSubscriptions];
  },

  async subUpsert(req: UpsertSubscriptionRequest): Promise<SubscriptionItem> {
    const id = req.id || `${req.bangumiId}:${req.subgroupId}`;
    const existing = mockSubscriptions.find((s) => s.id === id);
    const next: SubscriptionItem = {
      id,
      bangumiId: req.bangumiId,
      bangumiTitle: req.bangumiTitle,
      coverUrl: req.coverUrl ?? existing?.coverUrl,
      subgroupId: req.subgroupId,
      subgroupName: req.subgroupName,
      rssUrl: req.rssUrl,
      savePath: req.savePath || joinSavePath(mockSettings.downloadRootDir, req.bangumiTitle),
      category: req.category || mockSettings.qbCategory || 'MikanVault',
      startAfterEpisode: req.startAfterEpisode ?? 0,
      languageFilter:
        req.languageFilter === undefined
          ? existing?.languageFilter
          : req.languageFilter === 'all'
            ? undefined
            : req.languageFilter,
      includeKeywords: req.includeKeywords,
      excludeKeywords: req.excludeKeywords,
      enabled: req.enabled ?? existing?.enabled ?? true,
      downloadedReleaseIds: [
        ...(existing?.downloadedReleaseIds || []),
        ...(req.initialSkipReleaseIds || []),
      ],
      createdAt: existing?.createdAt ?? Date.now(),
      lastCheckedAt: existing?.lastCheckedAt,
      lastTriggeredAt: existing?.lastTriggeredAt,
      totalAutoDownloaded: existing?.totalAutoDownloaded ?? 0,
    };
    mockSubscriptions = [next, ...mockSubscriptions.filter((s) => s.id !== id)];
    return next;
  },

  async subDelete(id: string): Promise<ActionResult> {
    mockSubscriptions = mockSubscriptions.filter((s) => s.id !== id);
    return { ok: true };
  },

  async subCheckNow(subscriptionId?: string): Promise<SubscriptionCheckSummary> {
    const targets = subscriptionId
      ? mockSubscriptions.filter((s) => s.id === subscriptionId)
      : mockSubscriptions.filter((s) => s.enabled);
    mockSubscriptions = mockSubscriptions.map((s) =>
      targets.some((t) => t.id === s.id) ? { ...s, lastCheckedAt: Date.now() } : s
    );
    return {
      checkedCount: targets.length,
      newDownloads: 0,
      errors: 0,
      items: targets.map((t) => ({
        subscriptionId: t.id,
        bangumiTitle: t.bangumiTitle,
        added: 0,
      })),
    };
  },

  async subGetLogs(): Promise<SubscriptionLogEntry[]> {
    return [...mockSubLogs];
  },

  async subDetectLocalProgress(
    bangumiId: string,
    bangumiTitle: string,
    savePath?: string,
  ): Promise<LocalProgressHint> {
    const found = mockLibrary.find(
      (s) => s.bangumiId === bangumiId || s.title === bangumiTitle
    );
    if (found) {
      const maxEp = found.episodes.reduce((m, e) => Math.max(m, e.episodeNumber ?? 0), 0);
      return {
        savePath: found.folderPath,
        maxEpisodeNumber: maxEp || found.totalEpisodes,
        episodeCount: found.totalEpisodes,
      };
    }
    return {
      savePath: savePath || joinSavePath(mockSettings.downloadRootDir, bangumiTitle),
      maxEpisodeNumber: 0,
      episodeCount: 0,
    };
  },

  onSubscriptionsUpdated(): () => void {
    return () => {};
  },

  async cloudGetStatus(): Promise<CloudDriveStatus> {
    const dir = mockSettings.googleDriveDir || 'J:\\我的云端硬盘\\MikanVault';
    return {
      detected: true,
      mountRoot: 'J:\\我的云端硬盘',
      defaultTargetDir: 'J:\\我的云端硬盘\\MikanVault',
      configuredDir: dir,
      configuredAccessible: Boolean(dir),
      freeBytes: 143 * 1024 * 1024 * 1024,
      totalBytes: 200 * 1024 * 1024 * 1024,
    };
  },

  async cloudListJobs(): Promise<CloudTransferJob[]> {
    return [];
  },

  async cloudProcessNow(): Promise<{ processed: number; moved: number; failed: number }> {
    return { processed: 0, moved: 0, failed: 0 };
  },

  async cloudClearFinished(): Promise<ActionResult> {
    return { ok: true };
  },

  async cloudUploadLibrary(
    req: CloudUploadLibraryRequest,
  ): Promise<CloudUploadLibraryResult> {
    const cloudRoot = mockSettings.googleDriveDir || 'J:\\我的云端硬盘\\MikanVault';
    const targetDir = joinSavePath(cloudRoot, req.seriesTitle);
    return {
      ok: true,
      jobId: `mock-job-${Date.now()}`,
      queued: Boolean(req.background),
      targetDir,
      copiedFiles: req.background ? 0 : req.filePaths.length,
      totalBytes: req.filePaths.length * 600_000_000,
      deletedLocal: req.background ? false : req.deleteLocal,
      cloudSeriesId: `mock-cloud-${req.seriesId}`,
    };
  },

  async cloudRemoveJob(): Promise<ActionResult> {
    return { ok: true };
  },

  async cloudRetryJob(): Promise<ActionResult> {
    return { ok: true };
  },

  async cloudCancelJob(): Promise<ActionResult> {
    return { ok: true };
  },

  async mcpGetInfo(): Promise<McpServerInfo> {
    return {
      entryPath: 'C:\\Path\\To\\MikanVault\\dist-mcp\\mikanvault-mcp.cjs',
      dataDir: 'C:\\Users\\<YourName>\\AppData\\Roaming\\mikan-vault',
      exists: true,
      configJson: JSON.stringify(
        {
          mcpServers: {
            mikanvault: {
              command: 'node',
              args: ['C:\\Path\\To\\MikanVault\\dist-mcp\\mikanvault-mcp.cjs'],
              env: {
                MIKANVAULT_DATA_DIR: 'C:\\Users\\<YourName>\\AppData\\Roaming\\mikan-vault',
              },
            },
          },
        },
        null,
        2,
      ),
    };
  },

  async settingsGet(): Promise<AppSettings> {
    return { ...mockSettings };
  },

  async settingsUpdate(patch: Partial<AppSettings>): Promise<AppSettings> {
    mockSettings = { ...mockSettings, ...patch };
    return { ...mockSettings };
  },

  async dialogPickFolder(): Promise<string | null> {
    return null;
  },

  async dialogPickExecutable(): Promise<string | null> {
    return null;
  },

  async openExternal(url: string): Promise<ActionResult> {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    return { ok: true };
  },
};

export const api: MikanApi = isElectronRuntime ? window.mikanApi! : mockApi;

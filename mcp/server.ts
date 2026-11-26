import path from 'node:path';
import type {
  AddDownloadRequest,
  MikanSeasonName,
  QbControlAction,
  SubtitleLanguageFilter,
} from '../src/shared/types';
import { matchesSubtitleLanguage } from '../src/shared/subtitleLanguage';
import {
  cancelCloudJob,
  getCloudDriveStatus,
  listCloudJobs,
  processCloudTransferQueue,
  resolveCloudSeriesTargetDir,
  uploadLibraryToCloud,
} from '../electron/services/cloudService';
import { getDataDir, getSettings } from '../electron/services/configStore';
import { scanLibrary, scrapeAllUnscraped, scrapeSeries } from '../electron/services/libraryService';
import {
  expandSubgroupEpisodes,
  getBangumiDetail,
  getSchedule,
  searchMikan,
} from '../electron/services/mikanService';
import {
  addDownload,
  addDownloadsBatch,
  controlTorrent,
  getTorrents,
  launchQbittorrent,
  sanitizeFolderName,
  testConnection,
} from '../electron/services/qbService';
import {
  checkSubscriptions,
  getSubscriptionLogsList,
  listSubscriptions,
  upsertSubscription,
} from '../electron/services/subscriptionService';
import { createMcpServer, formatToolJson } from './protocol';

function buildMcpGuideMarkdown(): string {
  return `# MikanVault MCP Assistant Guide

MikanVault shares a live state directory (\`${getDataDir()}\`) between the desktop Electron app and this MCP server.

## Recommended Workflows

1. **Find & Download Anime**
   - Call \`mikan_search\` (or \`mikan_get_schedule\`) to find the \`bangumiId\`.
   - Call \`mikan_get_bangumi_detail\` to inspect available subgroups and release torrents/magnets.
   - Check \`qb_status\` (and call \`qb_launch\` if qBittorrent is not running).
   - Call \`qb_add_download\` with the chosen releases. Pass \`offloadToGoogleDrive: true\` if the user wants completed downloads moved to Google Drive and local files cleaned up automatically.

2. **Auto-Subscribe Future Episodes**
   - Call \`subscription_upsert\` with \`bangumiId\`, \`bangumiTitle\`, \`subgroupId\`, \`subgroupName\`, and \`startAfterEpisode\`.
   - Optionally call \`subscription_check_now\` right away to grab new releases.

3. **Upload Existing Local Library Series to Google Drive**
   - Call \`library_scan\` with \`onlyLocal: true\` to see local series, their \`seriesId\`, \`folderPath\`, and episodes.
   - Confirm whether the user wants \`deleteLocal: true\` (free local space after byte-size verification) or \`deleteLocal: false\` (keep both copies).
   - Call \`cloud_upload_library\`. To cancel an active upload job, call \`cloud_cancel_job\`.
`;
}

function matchSeriesFuzzy(
  seriesList: Awaited<ReturnType<typeof scanLibrary>>,
  seriesId?: string,
  seriesTitle?: string,
) {
  if (seriesId?.trim()) {
    const exact = seriesList.find((s) => s.seriesId === seriesId.trim());
    if (exact) return exact;
  }
  const q = seriesTitle?.trim().toLowerCase();
  if (!q) return undefined;
  return (
    seriesList.find(
      (s) =>
        s.title.toLowerCase() === q ||
        (s.originalTitle && s.originalTitle.toLowerCase() === q),
    ) ??
    seriesList.find(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.originalTitle && s.originalTitle.toLowerCase().includes(q)),
    )
  );
}

export function createMikanVaultMcpServer() {
  return createMcpServer({
    name: 'mikanvault-mcp',
    version: '0.2.1',
    instructions:
      'Use these tools to search anime on Mikan Project, manage qBittorrent downloads and RSS auto-subscriptions, organize/scrape the local anime library, and upload or offload anime to Google Drive.',
    tools: [
      {
        definition: {
          name: 'mikan_search',
          description:
            'Search anime titles, bangumi IDs, and recent release torrents on Mikan Project (蜜柑计划).',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Anime keyword (e.g. 葬送的芙莉莲, 钢之炼金术师)' },
              limit: { type: 'number', description: 'Max releases to return (default 20)' },
            },
            required: ['query'],
          },
        },
        handler: async (args) => {
          const query = String(args.query || '').trim();
          if (!query) return formatToolJson({ ok: false, error: 'query is required' }, true);
          const limit = typeof args.limit === 'number' ? Math.max(1, args.limit) : 20;
          const res = await searchMikan(query);
          return {
            query: res.query,
            bangumisCount: res.bangumis.length,
            bangumis: res.bangumis.slice(0, 20),
            releasesCount: res.releases.length,
            releases: res.releases.slice(0, limit),
          };
        },
      },
      {
        definition: {
          name: 'mikan_get_schedule',
          description: 'Get the seasonal anime broadcast schedule table from Mikan Project.',
          inputSchema: {
            type: 'object',
            properties: {
              year: { type: 'number', description: 'Optional year (e.g. 2026)' },
              season: {
                type: 'string',
                enum: ['春', '夏', '秋', '冬'],
                description: 'Optional season name (春/夏/秋/冬)',
              },
            },
          },
        },
        handler: async (args) => {
          const year = typeof args.year === 'number' ? args.year : undefined;
          const season =
            typeof args.season === 'string' ? (args.season as MikanSeasonName) : undefined;
          return getSchedule(year, season);
        },
      },
      {
        definition: {
          name: 'mikan_get_bangumi_detail',
          description:
            'Get full bangumi details including cover, overview, all subgroups, RSS URLs, and episode torrents. Optionally expand a specific subgroup.',
          inputSchema: {
            type: 'object',
            properties: {
              bangumiId: { type: 'string', description: 'Mikan bangumi ID' },
              subgroupId: {
                type: 'string',
                description: 'Optional subgroup ID to filter or expand',
              },
              expandEpisodes: {
                type: 'boolean',
                description: 'If true with subgroupId, fetch full episode history via ExpandEpisodeTable',
              },
              languageFilter: {
                type: 'string',
                enum: ['all', 'chs', 'cht', 'bilingual', 'chs_jp', 'cht_jp', 'raw'],
                description: 'Optional subtitle language filter for returned episodes',
              },
            },
            required: ['bangumiId'],
          },
        },
        handler: async (args) => {
          const bangumiId = String(args.bangumiId || '').trim();
          if (!bangumiId) return formatToolJson({ ok: false, error: 'bangumiId is required' }, true);
          const detail = await getBangumiDetail(bangumiId);
          const subgroupId =
            typeof args.subgroupId === 'string' ? args.subgroupId.trim() : undefined;
          const languageFilter =
            typeof args.languageFilter === 'string'
              ? (args.languageFilter as SubtitleLanguageFilter)
              : undefined;

          let subgroups = detail.subgroups;
          if (subgroupId && args.expandEpisodes) {
            const expanded = await expandSubgroupEpisodes(bangumiId, subgroupId, 200);
            subgroups = subgroups.map((sg) =>
              sg.id === subgroupId && expanded.length > 0 ? { ...sg, episodes: expanded } : sg,
            );
          }
          if (subgroupId) {
            subgroups = subgroups.filter((sg) => sg.id === subgroupId);
          }
          if (languageFilter && languageFilter !== 'all') {
            subgroups = subgroups.map((sg) => ({
              ...sg,
              episodes: sg.episodes.filter((ep) => matchesSubtitleLanguage(ep.title, languageFilter)),
            }));
          }
          return { ...detail, subgroups };
        },
      },
      {
        definition: {
          name: 'qb_status',
          description: 'Check local qBittorrent WebUI connection status and list download tasks.',
          inputSchema: {
            type: 'object',
            properties: {
              filter: {
                type: 'string',
                enum: ['all', 'downloading', 'completed', 'paused'],
                description: 'Optional queue filter (default all)',
              },
            },
          },
        },
        handler: async (args) => {
          const status = await testConnection();
          if (!status.connected) {
            return { status, torrents: [] };
          }
          const torrents = await getTorrents();
          const filter = typeof args.filter === 'string' ? args.filter : 'all';
          const filtered = torrents.filter((t) => {
            if (filter === 'downloading') return t.progress < 0.999 && !/paused|stopped/i.test(t.state);
            if (filter === 'completed') return t.progress >= 0.999;
            if (filter === 'paused') return /paused|stopped/i.test(t.state);
            return true;
          });
          return { status, total: filtered.length, torrents: filtered };
        },
      },
      {
        definition: {
          name: 'qb_launch',
          description: 'Launch the local qBittorrent desktop client if it is not currently running.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        handler: async () => launchQbittorrent(),
      },
      {
        definition: {
          name: 'qb_add_download',
          description:
            'Push one or more torrent/magnet downloads to qBittorrent. Automatically creates per-anime folders and optionally queues completed files for Google Drive offload.',
          inputSchema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                description: 'Download items to enqueue',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    torrentUrl: { type: 'string' },
                    magnetUrl: { type: 'string' },
                    bangumiId: { type: 'string' },
                    bangumiTitle: { type: 'string' },
                    coverUrl: { type: 'string' },
                    subgroup: { type: 'string' },
                    savePath: { type: 'string' },
                    category: { type: 'string' },
                  },
                  required: ['title'],
                },
              },
              offloadToGoogleDrive: {
                type: 'boolean',
                description:
                  'If true, once qB finishes downloading, copy to Google Drive and optionally delete local copy',
              },
              deleteLocalAfterCloudMove: {
                type: 'boolean',
                description: 'When offloadToGoogleDrive=true, delete local copy after verified copy (default true)',
              },
            },
            required: ['items'],
          },
        },
        handler: async (args) => {
          const rawItems = Array.isArray(args.items) ? args.items : [];
          if (rawItems.length === 0) {
            return formatToolJson({ ok: false, error: 'items must be a non-empty array' }, true);
          }
          const settings = getSettings();
          const offload = Boolean(args.offloadToGoogleDrive);
          const deleteLocalAfterCloudMove =
            typeof args.deleteLocalAfterCloudMove === 'boolean'
              ? args.deleteLocalAfterCloudMove
              : settings.googleDriveAutoDeleteLocal;
          const cloudRoot =
            settings.googleDriveDir?.trim() || getCloudDriveStatus().defaultTargetDir || '';

          if (offload && !cloudRoot) {
            return formatToolJson(
              { ok: false, error: 'Google Drive directory is not detected or configured' },
              true,
            );
          }

          const requests: AddDownloadRequest[] = rawItems.map((raw) => {
            const item = (raw || {}) as Record<string, unknown>;
            const title = String(item.title || 'Untitled');
            const bangumiTitle =
              typeof item.bangumiTitle === 'string' && item.bangumiTitle.trim()
                ? item.bangumiTitle.trim()
                : undefined;
            const savePath =
              typeof item.savePath === 'string' && item.savePath.trim()
                ? item.savePath.trim()
                : bangumiTitle
                  ? path.join(settings.downloadRootDir, sanitizeFolderName(bangumiTitle))
                  : undefined;
            const cloudTargetDir = offload
              ? resolveCloudSeriesTargetDir(cloudRoot, bangumiTitle, title)
              : undefined;
            return {
              title,
              torrentUrl: typeof item.torrentUrl === 'string' ? item.torrentUrl : undefined,
              magnetUrl: typeof item.magnetUrl === 'string' ? item.magnetUrl : undefined,
              bangumiId: typeof item.bangumiId === 'string' ? item.bangumiId : undefined,
              bangumiTitle,
              coverUrl: typeof item.coverUrl === 'string' ? item.coverUrl : undefined,
              subgroup: typeof item.subgroup === 'string' ? item.subgroup : undefined,
              savePath,
              category: typeof item.category === 'string' ? item.category : settings.qbCategory,
              cloudTargetDir,
              deleteLocalAfterCloudMove,
            };
          });

          if (requests.length === 1) {
            return addDownload(requests[0]);
          }
          return addDownloadsBatch(requests);
        },
      },
      {
        definition: {
          name: 'qb_control_torrent',
          description: 'Pause, resume, or delete a torrent in qBittorrent by infohash.',
          inputSchema: {
            type: 'object',
            properties: {
              hash: { type: 'string', description: 'Torrent infohash' },
              action: {
                type: 'string',
                enum: ['pause', 'resume', 'delete', 'deleteWithFiles'],
              },
            },
            required: ['hash', 'action'],
          },
        },
        handler: async (args) => {
          const hash = String(args.hash || '').trim();
          const action = String(args.action || '').trim() as QbControlAction;
          return controlTorrent(hash, action);
        },
      },
      {
        definition: {
          name: 'library_scan',
          description:
            'Scan local download directories and Google Drive library directory, returning anime series, episode counts, watched state, and cloud badge.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Optional case-insensitive title/path filter' },
              onlyLocal: { type: 'boolean', description: 'Return only local (non-cloud) series' },
              onlyCloud: { type: 'boolean', description: 'Return only Google Drive cloud series' },
            },
          },
        },
        handler: async (args) => {
          let list = await scanLibrary();
          if (args.onlyLocal) list = list.filter((s) => !s.isCloud);
          if (args.onlyCloud) list = list.filter((s) => Boolean(s.isCloud));
          const q = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
          if (q) {
            list = list.filter(
              (s) =>
                s.title.toLowerCase().includes(q) ||
                (s.originalTitle && s.originalTitle.toLowerCase().includes(q)) ||
                s.folderPath.toLowerCase().includes(q),
            );
          }
          return {
            totalSeries: list.length,
            series: list.map((s) => ({
              seriesId: s.seriesId,
              title: s.title,
              originalTitle: s.originalTitle,
              bangumiId: s.bangumiId,
              isCloud: Boolean(s.isCloud),
              folderPath: s.folderPath,
              totalEpisodes: s.totalEpisodes,
              watchedCount: s.watchedCount,
              rating: s.rating,
              episodes: s.episodes.map((e) => ({
                id: e.id,
                episodeNumber: e.episodeNumber,
                fileName: e.fileName,
                filePath: e.filePath,
                sizeBytes: e.sizeBytes,
                watched: e.watched,
              })),
            })),
          };
        },
      },
      {
        definition: {
          name: 'library_scrape',
          description:
            'Scrape Mikan covers, ratings, and metadata for one series (by seriesId) or all unscraped series.',
          inputSchema: {
            type: 'object',
            properties: {
              seriesId: { type: 'string', description: 'Optional specific seriesId to scrape' },
              query: { type: 'string', description: 'Optional search title override when scraping one series' },
              scrapeAll: { type: 'boolean', description: 'If true, scrape all unscraped series' },
              forceAll: { type: 'boolean', description: 'Used with scrapeAll to re-scrape all series' },
            },
          },
        },
        handler: async (args) => {
          if (args.scrapeAll || !args.seriesId) {
            return scrapeAllUnscraped(Boolean(args.forceAll));
          }
          const seriesId = String(args.seriesId).trim();
          const list = await scanLibrary();
          const target = list.find((s) => s.seriesId === seriesId);
          if (!target) {
            return formatToolJson({ ok: false, error: `Series not found: ${seriesId}` }, true);
          }
          return scrapeSeries({
            seriesId: target.seriesId,
            folderPath: target.folderPath,
            currentTitle: target.title,
            bangumiId: target.bangumiId,
            query: typeof args.query === 'string' ? args.query : undefined,
          });
        },
      },
      {
        definition: {
          name: 'subscription_list',
          description: 'List all configured auto-download RSS subscriptions and optional recent logs.',
          inputSchema: {
            type: 'object',
            properties: {
              includeLogs: { type: 'boolean', description: 'Include recent subscription check logs' },
            },
          },
        },
        handler: async (args) => ({
          subscriptions: listSubscriptions(),
          ...(args.includeLogs ? { logs: getSubscriptionLogsList() } : {}),
        }),
      },
      {
        definition: {
          name: 'subscription_upsert',
          description:
            'Create or update an auto-chase anime subscription rule (with optional Google Drive auto-offload).',
          inputSchema: {
            type: 'object',
            properties: {
              bangumiId: { type: 'string' },
              bangumiTitle: { type: 'string' },
              subgroupId: { type: 'string' },
              subgroupName: { type: 'string' },
              rssUrl: { type: 'string' },
              startAfterEpisode: {
                type: 'number',
                description: 'Skip episodes <= this number (0 downloads all)',
              },
              savePath: { type: 'string' },
              category: { type: 'string' },
              languageFilter: {
                type: 'string',
                enum: ['all', 'chs', 'cht', 'bilingual', 'chs_jp', 'cht_jp', 'raw'],
                description: 'Subtitle language filter (all, chs, cht, bilingual, chs_jp, cht_jp, raw)',
              },
              includeKeywords: { type: 'string' },
              excludeKeywords: { type: 'string' },
              offloadToGoogleDrive: { type: 'boolean' },
              deleteLocalAfterCloudMove: { type: 'boolean' },
              enabled: { type: 'boolean' },
            },
            required: ['bangumiId', 'bangumiTitle', 'subgroupId', 'subgroupName'],
          },
        },
        handler: async (args) => {
          const settings = getSettings();
          const bangumiId = String(args.bangumiId || '').trim();
          const bangumiTitle = String(args.bangumiTitle || '').trim();
          const subgroupId = String(args.subgroupId || '').trim();
          const subgroupName = String(args.subgroupName || '').trim();
          const rssUrl =
            typeof args.rssUrl === 'string' && args.rssUrl.trim()
              ? args.rssUrl.trim()
              : `${settings.mikanBaseUrl}/RSS/Bangumi?bangumiId=${encodeURIComponent(bangumiId)}&subgroupid=${encodeURIComponent(subgroupId)}`;
          const savePath =
            typeof args.savePath === 'string' && args.savePath.trim()
              ? args.savePath.trim()
              : path.join(settings.downloadRootDir, sanitizeFolderName(bangumiTitle));

          let cloudTargetDir: string | undefined;
          if (args.offloadToGoogleDrive) {
            const cloudRoot =
              settings.googleDriveDir?.trim() || getCloudDriveStatus().defaultTargetDir || '';
            if (cloudRoot) {
              cloudTargetDir = resolveCloudSeriesTargetDir(cloudRoot, bangumiTitle);
            }
          }

          return upsertSubscription({
            bangumiId,
            bangumiTitle,
            subgroupId,
            subgroupName,
            rssUrl,
            savePath,
            category: typeof args.category === 'string' ? args.category : settings.qbCategory,
            startAfterEpisode:
              typeof args.startAfterEpisode === 'number' ? args.startAfterEpisode : 0,
            languageFilter:
              typeof args.languageFilter === 'string'
                ? (args.languageFilter as SubtitleLanguageFilter)
                : undefined,
            includeKeywords:
              typeof args.includeKeywords === 'string' ? args.includeKeywords : undefined,
            excludeKeywords:
              typeof args.excludeKeywords === 'string' ? args.excludeKeywords : undefined,
            cloudTargetDir,
            deleteLocalAfterCloudMove:
              typeof args.deleteLocalAfterCloudMove === 'boolean'
                ? args.deleteLocalAfterCloudMove
                : settings.googleDriveAutoDeleteLocal,
            enabled: typeof args.enabled === 'boolean' ? args.enabled : true,
          });
        },
      },
      {
        definition: {
          name: 'subscription_check_now',
          description: 'Trigger an immediate RSS check for new episodes across active subscriptions.',
          inputSchema: {
            type: 'object',
            properties: {
              subscriptionId: {
                type: 'string',
                description: 'Optional single subscription ID to check',
              },
            },
          },
        },
        handler: async (args) => {
          const subscriptionId =
            typeof args.subscriptionId === 'string' ? args.subscriptionId.trim() : undefined;
          return checkSubscriptions(subscriptionId || undefined);
        },
      },
      {
        definition: {
          name: 'cloud_status',
          description:
            'Inspect Google Drive mount detection, buffer disk space, and all cloud upload / offload transfer jobs.',
          inputSchema: {
            type: 'object',
            properties: {
              statusFilter: {
                type: 'string',
                enum: ['all', 'queued', 'copying', 'completed', 'failed', 'cancelled'],
              },
            },
          },
        },
        handler: async (args) => {
          const status = getCloudDriveStatus();
          let jobs = listCloudJobs();
          const filter = typeof args.statusFilter === 'string' ? args.statusFilter : 'all';
          if (filter !== 'all') {
            jobs = jobs.filter((j) => j.status === filter);
          }
          return { status, totalJobs: jobs.length, jobs };
        },
      },
      {
        definition: {
          name: 'cloud_upload_library',
          description:
            'Upload a local media library anime series (or specific episode numbers) to Google Drive with post-copy size verification, metadata retention, and optional local deletion.',
          inputSchema: {
            type: 'object',
            properties: {
              seriesId: { type: 'string', description: 'Series ID from library_scan' },
              seriesTitle: {
                type: 'string',
                description: 'Series title (fuzzy matched against local library when seriesId omitted)',
              },
              episodeNumbers: {
                type: 'array',
                items: { type: 'number' },
                description: 'Optional list of episode numbers to upload instead of the whole series',
              },
              deleteLocal: {
                type: 'boolean',
                description: 'Required: true to delete local files after verified cloud copy; false to keep local copy',
              },
              background: {
                type: 'boolean',
                description: 'Optional: true to enqueue asynchronously; false (default) waits and returns copy stats',
              },
            },
            required: ['deleteLocal'],
          },
        },
        handler: async (args) => {
          const allSeries = await scanLibrary();
          const localOnly = allSeries.filter((s) => !s.isCloud);
          const seriesId = typeof args.seriesId === 'string' ? args.seriesId : undefined;
          const seriesTitle = typeof args.seriesTitle === 'string' ? args.seriesTitle : undefined;
          const target = matchSeriesFuzzy(localOnly, seriesId, seriesTitle);

          if (!target) {
            return formatToolJson(
              {
                ok: false,
                error: '未在本地媒体库找到匹配的未上云番剧（请先调用 library_scan 查看 local series）',
              },
              true,
            );
          }

          const epFilter = Array.isArray(args.episodeNumbers)
            ? new Set(
                args.episodeNumbers
                  .map((n) => Number(n))
                  .filter((n) => Number.isFinite(n)),
              )
            : null;
          const selectedEpisodes =
            epFilter && epFilter.size > 0
              ? target.episodes.filter(
                  (ep) => ep.episodeNumber !== undefined && epFilter.has(ep.episodeNumber),
                )
              : target.episodes;

          if (selectedEpisodes.length === 0) {
            return formatToolJson({ ok: false, error: '没有匹配到要上传的集数文件' }, true);
          }

          return uploadLibraryToCloud({
            kind: epFilter && epFilter.size > 0 && selectedEpisodes.length === 1 ? 'episode' : 'series',
            seriesId: target.seriesId,
            seriesTitle: target.title,
            folderPath: target.folderPath,
            filePaths: selectedEpisodes.map((e) => e.filePath),
            bangumiId: target.bangumiId,
            coverUrl: target.coverUrl,
            deleteLocal: Boolean(args.deleteLocal),
            background: Boolean(args.background),
          });
        },
      },
      {
        definition: {
          name: 'cloud_cancel_job',
          description:
            'Cancel a queued or actively copying Google Drive upload job without deleting local source files.',
          inputSchema: {
            type: 'object',
            properties: {
              jobId: { type: 'string', description: 'Cloud transfer job ID from cloud_status' },
            },
            required: ['jobId'],
          },
        },
        handler: async (args) => {
          const jobId = String(args.jobId || '').trim();
          return cancelCloudJob(jobId);
        },
      },
      {
        definition: {
          name: 'cloud_process_now',
          description:
            'Check all queued/failed qBittorrent-to-Google-Drive offload jobs and move completed downloads immediately.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        handler: async () => processCloudTransferQueue({}, true),
      },
    ],
    resources: [
      {
        definition: {
          uri: 'mikanvault://guide',
          name: 'MikanVault MCP Usage Guide',
          description: 'Agent instructions and workflow overview for MikanVault MCP tools',
          mimeType: 'text/markdown',
        },
        reader: async () => buildMcpGuideMarkdown(),
      },
      {
        definition: {
          uri: 'mikanvault://settings',
          name: 'MikanVault Settings',
          description: 'Current MikanVault configuration (with qBittorrent password redacted)',
          mimeType: 'application/json',
        },
        reader: async () => {
          const settings = getSettings();
          return JSON.stringify(
            {
              dataDir: getDataDir(),
              settings: {
                ...settings,
                qbPassword: settings.qbPassword ? '***' : '',
              },
            },
            null,
            2,
          );
        },
      },
      {
        definition: {
          uri: 'mikanvault://library',
          name: 'MikanVault Media Library',
          description: 'Current scanned local and Google Drive anime library summary',
          mimeType: 'application/json',
        },
        reader: async () => JSON.stringify(await scanLibrary(), null, 2),
      },
      {
        definition: {
          uri: 'mikanvault://torrents',
          name: 'qBittorrent Queue Snapshot',
          description: 'qBittorrent WebUI connection status and current torrents',
          mimeType: 'application/json',
        },
        reader: async () => {
          const status = await testConnection();
          const torrents = status.connected ? await getTorrents() : [];
          return JSON.stringify({ status, torrents }, null, 2);
        },
      },
      {
        definition: {
          uri: 'mikanvault://cloud-jobs',
          name: 'Google Drive Transfer Queue',
          description: 'Google Drive mount status and all cloud offload/upload jobs',
          mimeType: 'application/json',
        },
        reader: async () =>
          JSON.stringify(
            {
              status: getCloudDriveStatus(),
              jobs: listCloudJobs(),
            },
            null,
            2,
          ),
      },
      {
        definition: {
          uri: 'mikanvault://subscriptions',
          name: 'Auto-Chase Subscriptions',
          description: 'Configured RSS anime subscriptions and recent logs',
          mimeType: 'application/json',
        },
        reader: async () =>
          JSON.stringify(
            {
              subscriptions: listSubscriptions(),
              logs: getSubscriptionLogsList(),
            },
            null,
            2,
          ),
      },
    ],
    prompts: [
      {
        definition: {
          name: 'find_and_download_anime',
          description: 'Search an anime on Mikan, pick subgroup/episodes, and push to qBittorrent (optionally offloading to Google Drive).',
          arguments: [
            { name: 'query', description: 'Anime title or keyword to search', required: true },
            { name: 'to_cloud', description: 'Whether to offload to Google Drive after download (true/false)' },
          ],
        },
        render: async (args) => ({
          description: 'Search and download anime via MikanVault MCP',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please search MikanVault for "${args.query || ''}", list the matching bangumis and best subgroups/resolutions, confirm which subgroup and episodes I want, check qb_status, and enqueue the download via qb_add_download (offloadToGoogleDrive=${args.to_cloud === 'true' ? 'true' : 'false'}).`,
              },
            },
          ],
        }),
      },
      {
        definition: {
          name: 'offload_local_library_to_cloud',
          description: 'Inspect local anime library and upload selected series to Google Drive cleanly.',
          arguments: [
            { name: 'title', description: 'Optional local anime title filter' },
            { name: 'delete_local', description: 'true to free local space after verification, false to keep local copy' },
          ],
        },
        render: async (args) => ({
          description: 'Upload local library anime to Google Drive via MikanVault MCP',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Scan my local anime library with library_scan(onlyLocal=true${args.title ? `, query="${args.title}"` : ''}), check cloud_status to verify Google Drive capacity, and upload the requested anime via cloud_upload_library (deleteLocal=${args.delete_local === 'false' ? 'false' : 'true'}).`,
              },
            },
          ],
        }),
      },
    ],
  });
}

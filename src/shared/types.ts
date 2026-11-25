// Single source-of-truth TypeScript contract for MikanVault IPC & domain models

export const IPC_CHANNELS = {
  // Mikan
  MIKAN_GET_SCHEDULE: 'mikan:get-schedule',
  MIKAN_GET_BANGUMI_DETAIL: 'mikan:get-bangumi-detail',
  MIKAN_EXPAND_SUBGROUP: 'mikan:expand-subgroup',
  MIKAN_SEARCH: 'mikan:search',
  MIKAN_GET_RSS_FEED: 'mikan:get-rss-feed',
  MIKAN_RESOLVE_URL: 'mikan:resolve-url',
  MIKAN_PROXY_IMAGE: 'mikan:proxy-image',

  // qBittorrent
  QB_TEST_CONNECTION: 'qb:test-connection',
  QB_LAUNCH: 'qb:launch',
  QB_ADD_DOWNLOAD: 'qb:add-download',
  QB_ADD_DOWNLOAD_BATCH: 'qb:add-download-batch',
  QB_GET_TORRENTS: 'qb:get-torrents',
  QB_CONTROL_TORRENT: 'qb:control-torrent',

  // Media Library
  LIBRARY_SCAN: 'library:scan',
  LIBRARY_PLAY: 'library:play',
  LIBRARY_TOGGLE_WATCHED: 'library:toggle-watched',
  LIBRARY_OPEN_FOLDER: 'library:open-folder',
  LIBRARY_SCRAPE_SERIES: 'library:scrape-series',
  LIBRARY_SCRAPE_ALL: 'library:scrape-all',
  LIBRARY_REMOVE_SERIES: 'library:remove-series',
  LIBRARY_REMOVE_EPISODE: 'library:remove-episode',
  LIBRARY_RESTORE_HIDDEN: 'library:restore-hidden',
  LIBRARY_GET_HIDDEN_COUNT: 'library:get-hidden-count',

  // Auto Subscriptions
  SUB_LIST: 'sub:list',
  SUB_UPSERT: 'sub:upsert',
  SUB_DELETE: 'sub:delete',
  SUB_CHECK_NOW: 'sub:check-now',
  SUB_LOGS: 'sub:logs',
  SUB_DETECT_LOCAL: 'sub:detect-local',
  SUB_UPDATED_EVENT: 'sub:updated-event',

  // Google Drive Cloud Offload
  CLOUD_STATUS: 'cloud:status',
  CLOUD_LIST_JOBS: 'cloud:list-jobs',
  CLOUD_PROCESS_NOW: 'cloud:process-now',
  CLOUD_CLEAR_FINISHED: 'cloud:clear-finished',
  CLOUD_UPLOAD_LIBRARY: 'cloud:upload-library',
  CLOUD_REMOVE_JOB: 'cloud:remove-job',
  CLOUD_RETRY_JOB: 'cloud:retry-job',
  CLOUD_CANCEL_JOB: 'cloud:cancel-job',
  MCP_GET_INFO: 'mcp:get-info',

  // Settings & System
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  DIALOG_PICK_FOLDER: 'dialog:pick-folder',
  DIALOG_PICK_EXECUTABLE: 'dialog:pick-executable',
  SHELL_OPEN_EXTERNAL: 'shell:open-external',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// ---------------------------------------------------------------------------
// Mikan Domain Models
// ---------------------------------------------------------------------------

/** 0 = Sun, 1 = Mon ... 6 = Sat, 7 = Theater (剧场版), 8 = OVA */
export type MikanDayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const MIKAN_DAY_LABELS: Record<number, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  0: '周日',
  7: '剧场版',
  8: 'OVA',
};

export interface MikanBangumiCard {
  id: string;
  title: string;
  coverUrl: string;
  /** 0-6 (Sun-Sat), 7 (Theater), 8 (OVA), -1 if unknown */
  updateDay: number;
  hasUpdate: boolean;
  updateDate?: string;
}

export interface MikanScheduleGroup {
  dayOfWeek: number;
  label: string;
  items: MikanBangumiCard[];
}

export type MikanSeasonName = '冬' | '春' | '夏' | '秋';

export interface MikanSeasonOption {
  year: number;
  season: MikanSeasonName;
}

export interface MikanScheduleResponse {
  groups: MikanScheduleGroup[];
  fetchedAt: number;
  year?: number;
  season?: MikanSeasonName;
  availableSeasons?: MikanSeasonOption[];
}

export interface MikanRelease {
  id: string;
  title: string;
  bangumiTitle?: string;
  bangumiId?: string;
  subgroup?: string;
  subgroupId?: string;
  size: string;
  sizeBytes?: number;
  pubDate: string;
  torrentUrl: string;
  magnetUrl?: string;
  episodeUrl: string;
  tags: string[];
}

export interface MikanSubgroup {
  id: string;
  name: string;
  rssUrl: string;
  episodes: MikanRelease[];
  hasMore?: boolean;
}

export interface MikanBangumiDetail {
  id: string;
  title: string;
  coverUrl: string;
  mikanUrl: string;
  infoLines: string[];
  subgroups: MikanSubgroup[];
}

export interface MikanSearchResult {
  query: string;
  bangumis: MikanBangumiCard[];
  releases: MikanRelease[];
}

export type MikanResolvedUrl =
  | {
      kind: 'bangumi';
      bangumiId: string;
      url: string;
      detail?: MikanBangumiDetail;
    }
  | {
      kind: 'episode';
      episodeHash: string;
      url: string;
      bangumiId?: string;
      release?: MikanRelease;
    }
  | {
      kind: 'rss';
      rssUrl: string;
      releases?: MikanRelease[];
    }
  | {
      kind: 'unknown';
      url: string;
      error: string;
    };

// ---------------------------------------------------------------------------
// qBittorrent Domain Models
// ---------------------------------------------------------------------------

export interface QbConnectionOverride {
  qbUrl?: string;
  qbUsername?: string;
  qbPassword?: string;
  qbExePath?: string;
}

export interface QbConnectionStatus {
  ok: boolean;
  connected: boolean;
  version?: string;
  error?: string;
  qbRunning: boolean;
  exeExists: boolean;
}

export interface QbLaunchResult {
  ok: boolean;
  error?: string;
  alreadyRunning?: boolean;
}

export interface AddDownloadRequest {
  torrentUrl?: string;
  magnetUrl?: string;
  title: string;
  bangumiId?: string;
  bangumiTitle?: string;
  coverUrl?: string;
  subgroup?: string;
  savePath?: string;
  category?: string;
  /** If set, completed torrent files are copied to this cloud directory after download */
  cloudTargetDir?: string;
  /** Whether to remove torrent task & delete local copy after verified cloud copy (default true) */
  deleteLocalAfterCloudMove?: boolean;
}

export interface AddDownloadResult {
  ok: boolean;
  hash?: string;
  savePath: string;
  error?: string;
}

export interface BatchAddDownloadItemResult {
  title: string;
  ok: boolean;
  hash?: string;
  savePath: string;
  error?: string;
}

export interface BatchAddDownloadResult {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchAddDownloadItemResult[];
}

export interface QbTorrentItem {
  hash: string;
  name: string;
  state: string;
  /** 0..1 */
  progress: number;
  /** bytes */
  size: number;
  /** bytes */
  downloaded?: number;
  /** bytes/sec */
  dlspeed: number;
  /** bytes/sec */
  upspeed: number;
  /** seconds (8640000 means infinity in qBittorrent) */
  eta: number;
  ratio?: number;
  savePath: string;
  contentPath?: string;
  category: string;
  /** unix timestamp in seconds */
  addedOn: number;
  bangumiId?: string;
  bangumiTitle?: string;
  coverUrl?: string;
}

export type QbControlAction = 'pause' | 'resume' | 'delete' | 'deleteWithFiles';

// ---------------------------------------------------------------------------
// Media Library Domain Models
// ---------------------------------------------------------------------------

export interface LibraryEpisode {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  episodeNumber?: number;
  resolution?: string;
  tags: string[];
  sizeBytes: number;
  watched: boolean;
  lastPlayedAt?: number;
  addedAt: number;
}

export interface LibrarySeries {
  seriesId: string;
  title: string;
  originalTitle?: string;
  bangumiId?: string;
  coverUrl?: string;
  infoLines?: string[];
  overview?: string;
  rating?: number;
  airDate?: string;
  scrapedAt?: number;
  folderPath: string;
  totalEpisodes: number;
  watchedCount: number;
  lastUpdated: number;
  episodes: LibraryEpisode[];
  isCloud?: boolean;
}

export interface LibraryScrapeSeriesRequest {
  seriesId: string;
  folderPath: string;
  currentTitle: string;
  bangumiId?: string;
  query?: string;
}

export interface LibraryScrapeSeriesResult {
  ok: boolean;
  matchedTitle?: string;
  bangumiId?: string;
  coverUrl?: string;
  error?: string;
}

export interface LibraryScrapeAllResult {
  total: number;
  matched: number;
  skipped: number;
  failed: number;
  results: Array<{
    seriesId: string;
    title: string;
    ok: boolean;
    matchedTitle?: string;
    error?: string;
  }>;
}

export interface LibraryRemoveSeriesRequest {
  seriesId: string;
  folderPath: string;
  filePaths: string[];
  deleteFiles?: boolean;
}

export interface LibraryRemoveEpisodeRequest {
  filePath: string;
  deleteFile?: boolean;
}

// ---------------------------------------------------------------------------
// Settings & Shared Result Models
// ---------------------------------------------------------------------------

export type PlayerMode = 'system' | 'custom';

export interface AppSettings {
  mikanBaseUrl: string;
  qbUrl: string;
  qbUsername: string;
  qbPassword: string;
  qbExePath: string;
  qbCategory: string;
  downloadRootDir: string;
  extraLibraryDirs: string[];
  playerMode: PlayerMode;
  customPlayerPath: string;
  subscriptionCheckIntervalMin: number;
  subscriptionAutoLaunchQb: boolean;
  googleDriveEnabled: boolean;
  googleDriveDir: string;
  googleDriveAutoDeleteLocal: boolean;
  googleDriveIncludeInLibrary: boolean;
}

export type SubtitleLanguageFilter =
  | 'all'
  | 'chs'
  | 'cht'
  | 'bilingual'
  | 'chs_jp'
  | 'cht_jp'
  | 'raw';

export interface SubscriptionItem {
  id: string;
  bangumiId: string;
  bangumiTitle: string;
  coverUrl?: string;
  subgroupId: string;
  subgroupName: string;
  rssUrl: string;
  savePath: string;
  category: string;
  /** Auto-download episodes strictly greater than this number (0 = all) */
  startAfterEpisode: number;
  languageFilter?: SubtitleLanguageFilter;
  includeKeywords?: string;
  excludeKeywords?: string;
  cloudTargetDir?: string;
  deleteLocalAfterCloudMove?: boolean;
  enabled: boolean;
  downloadedReleaseIds: string[];
  lastDownloadedEpisode?: number;
  createdAt: number;
  lastCheckedAt?: number;
  lastTriggeredAt?: number;
  lastError?: string;
  totalAutoDownloaded: number;
}

export interface UpsertSubscriptionRequest {
  id?: string;
  bangumiId: string;
  bangumiTitle: string;
  coverUrl?: string;
  subgroupId: string;
  subgroupName: string;
  rssUrl: string;
  savePath: string;
  category?: string;
  startAfterEpisode: number;
  languageFilter?: SubtitleLanguageFilter;
  includeKeywords?: string;
  excludeKeywords?: string;
  cloudTargetDir?: string;
  deleteLocalAfterCloudMove?: boolean;
  enabled?: boolean;
  /** Optional release IDs currently in feed to mark as already seen */
  initialSkipReleaseIds?: string[];
}

export interface SubscriptionLogEntry {
  id: string;
  subscriptionId: string;
  bangumiTitle: string;
  releaseTitle: string;
  episodeNumber?: number;
  ok: boolean;
  message: string;
  timestamp: number;
}

export interface SubscriptionCheckSummary {
  checkedCount: number;
  newDownloads: number;
  errors: number;
  items: Array<{
    subscriptionId: string;
    bangumiTitle: string;
    added: number;
    error?: string;
  }>;
}

export interface LocalProgressHint {
  savePath?: string;
  maxEpisodeNumber: number;
  episodeCount: number;
  detectedSubgroup?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Google Drive Cloud Offload Domain Models
// ---------------------------------------------------------------------------

export interface CloudDriveStatus {
  detected: boolean;
  mountRoot?: string;
  defaultTargetDir?: string;
  configuredDir: string;
  configuredAccessible: boolean;
  freeBytes?: number;
  totalBytes?: number;
}

export type CloudTransferStatus = 'queued' | 'copying' | 'completed' | 'failed' | 'cancelled';

export interface CloudTransferJob {
  id: string;
  source?: 'download' | 'library';
  seriesId?: string;
  sourceFilePaths?: string[];
  cancelling?: boolean;
  torrentHash?: string;
  torrentName: string;
  bangumiId?: string;
  bangumiTitle?: string;
  coverUrl?: string;
  subgroup?: string;
  localSavePath: string;
  cloudTargetDir: string;
  deleteLocalAfterMove: boolean;
  status: CloudTransferStatus;
  progress?: number;
  transferredBytes?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  copiedFiles?: number;
  totalFiles?: number;
  totalBytes?: number;
  currentFileName?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface CloudUploadLibraryRequest {
  kind: 'series' | 'episode';
  seriesId: string;
  seriesTitle: string;
  folderPath: string;
  filePaths: string[];
  bangumiId?: string;
  coverUrl?: string;
  deleteLocal: boolean;
  background?: boolean;
}

export interface CloudUploadLibraryResult {
  ok: boolean;
  jobId?: string;
  queued?: boolean;
  targetDir?: string;
  copiedFiles: number;
  totalBytes: number;
  deletedLocal: boolean;
  cloudSeriesId?: string;
  warning?: string;
  error?: string;
}

export interface McpServerInfo {
  entryPath: string;
  dataDir: string;
  exists: boolean;
  configJson: string;
}

// ---------------------------------------------------------------------------
// Preload Bridge API (`window.mikanApi`)
// ---------------------------------------------------------------------------

export interface MikanApi {
  // Mikan
  getSchedule: (year?: number, season?: MikanSeasonName) => Promise<MikanScheduleResponse>;
  getBangumiDetail: (id: string) => Promise<MikanBangumiDetail>;
  expandSubgroupEpisodes: (
    bangumiId: string,
    subgroupId: string,
    take?: number,
  ) => Promise<MikanRelease[]>;
  searchMikan: (query: string) => Promise<MikanSearchResult>;
  getRssFeed: (rssUrl?: string) => Promise<MikanRelease[]>;
  resolveMikanUrl: (url: string) => Promise<MikanResolvedUrl>;
  proxyImage: (url: string) => Promise<string>;

  // qBittorrent
  qbTestConnection: (override?: QbConnectionOverride) => Promise<QbConnectionStatus>;
  qbLaunch: () => Promise<QbLaunchResult>;
  qbAddDownload: (req: AddDownloadRequest) => Promise<AddDownloadResult>;
  qbAddDownloadBatch: (requests: AddDownloadRequest[]) => Promise<BatchAddDownloadResult>;
  qbGetTorrents: () => Promise<QbTorrentItem[]>;
  qbControlTorrent: (hash: string, action: QbControlAction) => Promise<ActionResult>;

  // Media Library
  libraryScan: () => Promise<LibrarySeries[]>;
  libraryPlay: (filePath: string) => Promise<ActionResult>;
  libraryToggleWatched: (filePath: string, watched: boolean) => Promise<ActionResult>;
  libraryOpenFolder: (targetPath: string) => Promise<ActionResult>;
  libraryScrapeSeries: (req: LibraryScrapeSeriesRequest) => Promise<LibraryScrapeSeriesResult>;
  libraryScrapeAll: (forceAll?: boolean) => Promise<LibraryScrapeAllResult>;
  libraryRemoveSeries: (req: LibraryRemoveSeriesRequest) => Promise<ActionResult>;
  libraryRemoveEpisode: (req: LibraryRemoveEpisodeRequest) => Promise<ActionResult>;
  libraryRestoreHidden: () => Promise<ActionResult>;
  libraryGetHiddenCount: () => Promise<number>;

  // Auto Subscriptions
  subList: () => Promise<SubscriptionItem[]>;
  subUpsert: (req: UpsertSubscriptionRequest) => Promise<SubscriptionItem>;
  subDelete: (id: string) => Promise<ActionResult>;
  subCheckNow: (subscriptionId?: string) => Promise<SubscriptionCheckSummary>;
  subGetLogs: () => Promise<SubscriptionLogEntry[]>;
  subDetectLocalProgress: (
    bangumiId: string,
    bangumiTitle: string,
    savePath?: string,
  ) => Promise<LocalProgressHint>;
  onSubscriptionsUpdated?: (cb: () => void) => () => void;

  // Google Drive Cloud Offload
  cloudGetStatus: () => Promise<CloudDriveStatus>;
  cloudListJobs: () => Promise<CloudTransferJob[]>;
  cloudProcessNow: () => Promise<{ processed: number; moved: number; failed: number }>;
  cloudClearFinished: () => Promise<ActionResult>;
  cloudUploadLibrary: (req: CloudUploadLibraryRequest) => Promise<CloudUploadLibraryResult>;
  cloudRemoveJob: (jobId: string) => Promise<ActionResult>;
  cloudRetryJob: (jobId: string) => Promise<ActionResult>;
  cloudCancelJob: (jobId: string) => Promise<ActionResult>;
  mcpGetInfo: () => Promise<McpServerInfo>;

  // Settings & System
  settingsGet: () => Promise<AppSettings>;
  settingsUpdate: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  dialogPickFolder: () => Promise<string | null>;
  dialogPickExecutable: () => Promise<string | null>;
  openExternal: (url: string) => Promise<ActionResult>;
}

declare global {
  interface Window {
    mikanApi?: MikanApi;
  }
}

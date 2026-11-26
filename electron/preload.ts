import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type AddDownloadRequest,
  type AppSettings,
  type CloudUploadLibraryRequest,
  type LibraryRemoveEpisodeRequest,
  type LibraryRemoveSeriesRequest,
  type LibraryScrapeSeriesRequest,
  type MikanApi,
  type MikanSeasonName,
  type QbConnectionOverride,
  type QbControlAction,
  type ResolvedTheme,
  type UpsertSubscriptionRequest,
} from '../src/shared/types';

const mikanApi: MikanApi = {
  // Mikan
  getSchedule: (year?: number, season?: MikanSeasonName) =>
    ipcRenderer.invoke(IPC_CHANNELS.MIKAN_GET_SCHEDULE, year, season),
  getBangumiDetail: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.MIKAN_GET_BANGUMI_DETAIL, id),
  expandSubgroupEpisodes: (bangumiId: string, subgroupId: string, take?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.MIKAN_EXPAND_SUBGROUP, bangumiId, subgroupId, take),
  searchMikan: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.MIKAN_SEARCH, query),
  getRssFeed: (rssUrl?: string) => ipcRenderer.invoke(IPC_CHANNELS.MIKAN_GET_RSS_FEED, rssUrl),
  resolveMikanUrl: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.MIKAN_RESOLVE_URL, url),
  proxyImage: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.MIKAN_PROXY_IMAGE, url),

  // qBittorrent
  qbTestConnection: (override?: QbConnectionOverride) =>
    ipcRenderer.invoke(IPC_CHANNELS.QB_TEST_CONNECTION, override),
  qbLaunch: () => ipcRenderer.invoke(IPC_CHANNELS.QB_LAUNCH),
  qbAddDownload: (req: AddDownloadRequest) => ipcRenderer.invoke(IPC_CHANNELS.QB_ADD_DOWNLOAD, req),
  qbAddDownloadBatch: (requests: AddDownloadRequest[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.QB_ADD_DOWNLOAD_BATCH, requests),
  qbGetTorrents: () => ipcRenderer.invoke(IPC_CHANNELS.QB_GET_TORRENTS),
  qbControlTorrent: (hash: string, action: QbControlAction) =>
    ipcRenderer.invoke(IPC_CHANNELS.QB_CONTROL_TORRENT, hash, action),

  // Media Library
  libraryScan: () => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_SCAN),
  libraryPlay: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_PLAY, filePath),
  libraryToggleWatched: (filePath: string, watched: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_TOGGLE_WATCHED, filePath, watched),
  libraryOpenFolder: (targetPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_OPEN_FOLDER, targetPath),
  libraryScrapeSeries: (req: LibraryScrapeSeriesRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_SCRAPE_SERIES, req),
  libraryScrapeAll: (forceAll?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_SCRAPE_ALL, forceAll),
  libraryRemoveSeries: (req: LibraryRemoveSeriesRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_REMOVE_SERIES, req),
  libraryRemoveEpisode: (req: LibraryRemoveEpisodeRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_REMOVE_EPISODE, req),
  libraryRestoreHidden: () => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_RESTORE_HIDDEN),
  libraryGetHiddenCount: () => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_GET_HIDDEN_COUNT),

  // Auto Subscriptions
  subList: () => ipcRenderer.invoke(IPC_CHANNELS.SUB_LIST),
  subUpsert: (req: UpsertSubscriptionRequest) => ipcRenderer.invoke(IPC_CHANNELS.SUB_UPSERT, req),
  subDelete: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.SUB_DELETE, id),
  subCheckNow: (subscriptionId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SUB_CHECK_NOW, subscriptionId),
  subGetLogs: () => ipcRenderer.invoke(IPC_CHANNELS.SUB_LOGS),
  subDetectLocalProgress: (bangumiId: string, bangumiTitle: string, savePath?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.SUB_DETECT_LOCAL, bangumiId, bangumiTitle, savePath),
  onSubscriptionsUpdated: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(IPC_CHANNELS.SUB_UPDATED_EVENT, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.SUB_UPDATED_EVENT, listener);
  },

  // Google Drive Cloud Offload
  cloudGetStatus: () => ipcRenderer.invoke(IPC_CHANNELS.CLOUD_STATUS),
  cloudListJobs: () => ipcRenderer.invoke(IPC_CHANNELS.CLOUD_LIST_JOBS),
  cloudProcessNow: () => ipcRenderer.invoke(IPC_CHANNELS.CLOUD_PROCESS_NOW),
  cloudClearFinished: () => ipcRenderer.invoke(IPC_CHANNELS.CLOUD_CLEAR_FINISHED),
  cloudUploadLibrary: (req: CloudUploadLibraryRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.CLOUD_UPLOAD_LIBRARY, req),
  cloudRemoveJob: (jobId: string) => ipcRenderer.invoke(IPC_CHANNELS.CLOUD_REMOVE_JOB, jobId),
  cloudRetryJob: (jobId: string) => ipcRenderer.invoke(IPC_CHANNELS.CLOUD_RETRY_JOB, jobId),
  cloudCancelJob: (jobId: string) => ipcRenderer.invoke(IPC_CHANNELS.CLOUD_CANCEL_JOB, jobId),
  mcpGetInfo: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_GET_INFO),

  // Settings & System
  settingsGet: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  settingsUpdate: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, patch),
  dialogPickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_PICK_FOLDER),
  dialogPickExecutable: () => ipcRenderer.invoke(IPC_CHANNELS.DIALOG_PICK_EXECUTABLE),
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url),
  windowSetTheme: (theme: ResolvedTheme) =>
    ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SET_THEME, theme),
};

contextBridge.exposeInMainWorld('mikanApi', mikanApi);

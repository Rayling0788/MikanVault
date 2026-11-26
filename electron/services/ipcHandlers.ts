import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import {
  IPC_CHANNELS,
  type ActionResult,
  type AddDownloadRequest,
  type AppSettings,
  type CloudUploadLibraryRequest,
  type LibraryRemoveEpisodeRequest,
  type LibraryRemoveSeriesRequest,
  type LibraryScrapeSeriesRequest,
  type McpServerInfo,
  type MikanSeasonName,
  type QbConnectionOverride,
  type QbControlAction,
  type ResolvedTheme,
  type UpsertSubscriptionRequest,
} from '../../src/shared/types';
import {
  cancelCloudJob,
  clearFinishedCloudJobs,
  getCloudDriveStatus,
  listCloudJobs,
  processCloudTransferQueue,
  removeCloudJob,
  retryCloudJob,
  uploadLibraryToCloud,
} from './cloudService';
import { getDataDir, getSettings, updateSettings } from './configStore';
import {
  getHiddenLibraryCount,
  openFolder,
  playEpisode,
  removeEpisodeFromLibrary,
  removeSeriesFromLibrary,
  restoreHiddenLibraryItems,
  scanLibrary,
  scrapeAllUnscraped,
  scrapeSeries,
  toggleWatched,
} from './libraryService';
import {
  expandSubgroupEpisodes,
  getBangumiDetail,
  getRssFeed,
  getSchedule,
  proxyImage,
  resolveMikanUrl,
  searchMikan,
} from './mikanService';
import {
  addDownload,
  addDownloadsBatch,
  controlTorrent,
  getTorrents,
  launchQbittorrent,
  testConnection,
} from './qbService';
import {
  checkSubscriptions,
  deleteSubscription,
  detectLocalProgress,
  getSubscriptionLogsList,
  listSubscriptions,
  restartSubscriptionScheduler,
  upsertSubscription,
} from './subscriptionService';

let registered = false;

function getActiveWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

export function registerIpcHandlers(): void {
  if (registered) return;
  registered = true;

  // -------------------------------------------------------------------------
  // Mikan
  // -------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.MIKAN_GET_SCHEDULE,
    async (_event, year?: number, season?: MikanSeasonName) => {
      return getSchedule(year, season);
    },
  );

  ipcMain.handle(IPC_CHANNELS.MIKAN_GET_BANGUMI_DETAIL, async (_event, id: string) => {
    return getBangumiDetail(id);
  });

  ipcMain.handle(
    IPC_CHANNELS.MIKAN_EXPAND_SUBGROUP,
    async (_event, bangumiId: string, subgroupId: string, take?: number) => {
      return expandSubgroupEpisodes(bangumiId, subgroupId, take);
    },
  );

  ipcMain.handle(IPC_CHANNELS.MIKAN_SEARCH, async (_event, query: string) => {
    return searchMikan(query);
  });

  ipcMain.handle(IPC_CHANNELS.MIKAN_GET_RSS_FEED, async (_event, rssUrl?: string) => {
    return getRssFeed(rssUrl);
  });

  ipcMain.handle(IPC_CHANNELS.MIKAN_RESOLVE_URL, async (_event, url: string) => {
    return resolveMikanUrl(url);
  });

  ipcMain.handle(IPC_CHANNELS.MIKAN_PROXY_IMAGE, async (_event, url: string) => {
    return proxyImage(url);
  });

  // -------------------------------------------------------------------------
  // qBittorrent
  // -------------------------------------------------------------------------
  ipcMain.handle(
    IPC_CHANNELS.QB_TEST_CONNECTION,
    async (_event, override?: QbConnectionOverride) => {
      return testConnection(override);
    },
  );

  ipcMain.handle(IPC_CHANNELS.QB_LAUNCH, async () => {
    return launchQbittorrent();
  });

  ipcMain.handle(IPC_CHANNELS.QB_ADD_DOWNLOAD, async (_event, req: AddDownloadRequest) => {
    return addDownload(req);
  });

  ipcMain.handle(
    IPC_CHANNELS.QB_ADD_DOWNLOAD_BATCH,
    async (_event, requests: AddDownloadRequest[]) => {
      return addDownloadsBatch(requests);
    },
  );

  ipcMain.handle(IPC_CHANNELS.QB_GET_TORRENTS, async () => {
    return getTorrents();
  });

  ipcMain.handle(
    IPC_CHANNELS.QB_CONTROL_TORRENT,
    async (_event, hash: string, action: QbControlAction) => {
      return controlTorrent(hash, action);
    },
  );

  // -------------------------------------------------------------------------
  // Media Library
  // -------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.LIBRARY_SCAN, async () => {
    return scanLibrary();
  });

  ipcMain.handle(IPC_CHANNELS.LIBRARY_PLAY, async (_event, filePath: string) => {
    return playEpisode(filePath);
  });

  ipcMain.handle(
    IPC_CHANNELS.LIBRARY_TOGGLE_WATCHED,
    async (_event, filePath: string, watched: boolean) => {
      return toggleWatched(filePath, watched);
    },
  );

  ipcMain.handle(IPC_CHANNELS.LIBRARY_OPEN_FOLDER, async (_event, targetPath: string) => {
    return openFolder(targetPath);
  });

  ipcMain.handle(
    IPC_CHANNELS.LIBRARY_SCRAPE_SERIES,
    async (_event, req: LibraryScrapeSeriesRequest) => {
      return scrapeSeries(req);
    },
  );

  ipcMain.handle(IPC_CHANNELS.LIBRARY_SCRAPE_ALL, async (_event, forceAll?: boolean) => {
    return scrapeAllUnscraped(forceAll);
  });

  ipcMain.handle(
    IPC_CHANNELS.LIBRARY_REMOVE_SERIES,
    async (_event, req: LibraryRemoveSeriesRequest) => {
      return removeSeriesFromLibrary(req);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.LIBRARY_REMOVE_EPISODE,
    async (_event, req: LibraryRemoveEpisodeRequest) => {
      return removeEpisodeFromLibrary(req);
    },
  );

  ipcMain.handle(IPC_CHANNELS.LIBRARY_RESTORE_HIDDEN, async () => {
    return restoreHiddenLibraryItems();
  });

  ipcMain.handle(IPC_CHANNELS.LIBRARY_GET_HIDDEN_COUNT, async () => {
    return getHiddenLibraryCount();
  });

  // -------------------------------------------------------------------------
  // Auto Subscriptions
  // -------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.SUB_LIST, async () => {
    return listSubscriptions();
  });

  ipcMain.handle(IPC_CHANNELS.SUB_UPSERT, async (_event, req: UpsertSubscriptionRequest) => {
    return upsertSubscription(req);
  });

  ipcMain.handle(IPC_CHANNELS.SUB_DELETE, async (_event, id: string) => {
    return deleteSubscription(id);
  });

  ipcMain.handle(IPC_CHANNELS.SUB_CHECK_NOW, async (_event, subscriptionId?: string) => {
    return checkSubscriptions(subscriptionId);
  });

  ipcMain.handle(IPC_CHANNELS.SUB_LOGS, async () => {
    return getSubscriptionLogsList();
  });

  ipcMain.handle(
    IPC_CHANNELS.SUB_DETECT_LOCAL,
    async (_event, bangumiId: string, bangumiTitle: string, savePath?: string) => {
      return detectLocalProgress(bangumiId, bangumiTitle, savePath);
    },
  );

  // -------------------------------------------------------------------------
  // Google Drive Cloud Offload
  // -------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.CLOUD_STATUS, async () => {
    return getCloudDriveStatus();
  });

  ipcMain.handle(IPC_CHANNELS.CLOUD_LIST_JOBS, async () => {
    return listCloudJobs();
  });

  ipcMain.handle(IPC_CHANNELS.CLOUD_PROCESS_NOW, async () => {
    return processCloudTransferQueue({}, true);
  });

  ipcMain.handle(IPC_CHANNELS.CLOUD_CLEAR_FINISHED, async () => {
    return clearFinishedCloudJobs();
  });

  ipcMain.handle(
    IPC_CHANNELS.CLOUD_UPLOAD_LIBRARY,
    async (_event, req: CloudUploadLibraryRequest) => {
      return uploadLibraryToCloud(req);
    },
  );

  ipcMain.handle(IPC_CHANNELS.CLOUD_REMOVE_JOB, async (_event, jobId: string) => {
    return removeCloudJob(jobId);
  });

  ipcMain.handle(IPC_CHANNELS.CLOUD_RETRY_JOB, async (_event, jobId: string) => {
    return retryCloudJob(jobId);
  });

  ipcMain.handle(IPC_CHANNELS.CLOUD_CANCEL_JOB, async (_event, jobId: string) => {
    return cancelCloudJob(jobId);
  });

  ipcMain.handle(IPC_CHANNELS.MCP_GET_INFO, async (): Promise<McpServerInfo> => {
    const candidates = [
      ...(app.isPackaged
        ? [path.join(process.resourcesPath, 'mcp', 'mikanvault-mcp.cjs')]
        : []),
      path.join(process.cwd(), 'dist-mcp', 'mikanvault-mcp.cjs'),
      path.join(app.getAppPath(), 'dist-mcp', 'mikanvault-mcp.cjs'),
      path.resolve(app.getAppPath(), '..', '..', 'dist-mcp', 'mikanvault-mcp.cjs'),
      path.join(process.resourcesPath, 'mcp', 'mikanvault-mcp.cjs'),
    ];
    const resolvedEntry = candidates.find((p) => fs.existsSync(p)) || candidates[0];
    const dataDir = getDataDir();
    const configJson = JSON.stringify(
      {
        mcpServers: {
          mikanvault: {
            command: 'node',
            args: [resolvedEntry],
            env: {
              MIKANVAULT_DATA_DIR: dataDir,
            },
          },
        },
      },
      null,
      2,
    );
    return {
      entryPath: resolvedEntry,
      dataDir,
      exists: fs.existsSync(resolvedEntry),
      configJson,
    };
  });

  // -------------------------------------------------------------------------
  // Settings & System
  // -------------------------------------------------------------------------
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
    return getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_UPDATE, async (_event, patch: Partial<AppSettings>) => {
    const prev = getSettings().subscriptionCheckIntervalMin;
    const next = updateSettings(patch);
    if (next.subscriptionCheckIntervalMin !== prev) {
      restartSubscriptionScheduler();
    }
    return next;
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG_PICK_FOLDER, async (): Promise<string | null> => {
    const win = getActiveWindow();
    const opts: Electron.OpenDialogOptions = {
      title: '选择文件夹',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle(IPC_CHANNELS.DIALOG_PICK_EXECUTABLE, async (): Promise<string | null> => {
    const win = getActiveWindow();
    const opts: Electron.OpenDialogOptions = {
      title: '选择可执行程序',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [
              { name: '可执行文件', extensions: ['exe', 'bat', 'cmd'] },
              { name: '所有文件', extensions: ['*'] },
            ]
          : [{ name: '所有文件', extensions: ['*'] }],
    };
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle(
    IPC_CHANNELS.SHELL_OPEN_EXTERNAL,
    async (_event, url: string): Promise<ActionResult> => {
      const trimmed = url?.trim();
      if (
        !trimmed ||
        (!trimmed.startsWith('http://') &&
          !trimmed.startsWith('https://') &&
          !trimmed.startsWith('magnet:'))
      ) {
        return { ok: false, error: '仅允许打开 http、https 或 magnet 链接' };
      }
      try {
        await shell.openExternal(trimmed);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : '打开外部链接失败',
        };
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.WINDOW_SET_THEME, (_event, theme: ResolvedTheme) => {
    const isLight = theme === 'light';
    const bgColor = isLight ? '#F3F5FA' : '#090B10';
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.setBackgroundColor(bgColor);
      } catch {
        // Ignore on platforms/states that reject backgroundColor update
      }
      if (process.platform === 'win32') {
        try {
          win.setTitleBarOverlay({
            color: bgColor,
            symbolColor: isLight ? '#475569' : '#94A3B8',
            height: 53,
          });
        } catch {
          // Ignore if titleBarOverlay is unavailable
        }
      }
    }
  });
}

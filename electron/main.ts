import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, net, protocol, shell } from 'electron';
import { registerIpcHandlers } from './services/ipcHandlers';
import { getImageCacheDir } from './services/configStore';
import {
  startCloudTransferWatcher,
  stopCloudTransferWatcher,
} from './services/cloudService';
import {
  startSubscriptionScheduler,
  stopSubscriptionScheduler,
} from './services/subscriptionService';

// Register custom image proxy protocol privileges before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mikan-img',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;
const inFlightImageFetches = new Map<
  string,
  Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | { status: number }>
>();

function guessMimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.avif':
      return 'image/avif';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'image/jpeg';
  }
}

async function pruneImageCache(maxEntries = 600, maxTotalBytes = 120 * 1024 * 1024): Promise<void> {
  try {
    const cacheDir = getImageCacheDir();
    const names = await fsp.readdir(cacheDir);
    const binNames = names.filter((n) => n.endsWith('.bin'));
    if (binNames.length <= maxEntries) {
      let quickBytes = 0;
      const statsList = await Promise.all(
        binNames.map(async (name) => {
          try {
            const st = await fsp.stat(path.join(cacheDir, name));
            quickBytes += st.size;
            return { name, size: st.size, mtimeMs: st.mtimeMs };
          } catch {
            return null;
          }
        }),
      );
      if (quickBytes <= maxTotalBytes) return;
      const valid = statsList.filter(
        (x): x is { name: string; size: number; mtimeMs: number } => x !== null,
      );
      valid.sort((a, b) => a.mtimeMs - b.mtimeMs);
      let remainingBytes = quickBytes;
      for (const item of valid) {
        if (remainingBytes <= maxTotalBytes) break;
        const hash = item.name.slice(0, -4);
        await fsp.rm(path.join(cacheDir, item.name), { force: true }).catch(() => {});
        await fsp.rm(path.join(cacheDir, `${hash}.meta.json`), { force: true }).catch(() => {});
        remainingBytes -= item.size;
      }
      return;
    }

    const statsList = (
      await Promise.all(
        binNames.map(async (name) => {
          try {
            const st = await fsp.stat(path.join(cacheDir, name));
            return { name, size: st.size, mtimeMs: st.mtimeMs };
          } catch {
            return null;
          }
        }),
      )
    ).filter((x): x is { name: string; size: number; mtimeMs: number } => x !== null);

    statsList.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let totalBytes = statsList.reduce((sum, s) => sum + s.size, 0);
    let remainingCount = statsList.length;

    for (const item of statsList) {
      if (remainingCount <= maxEntries && totalBytes <= maxTotalBytes) break;
      const hash = item.name.slice(0, -4);
      await fsp.rm(path.join(cacheDir, item.name), { force: true }).catch(() => {});
      await fsp.rm(path.join(cacheDir, `${hash}.meta.json`), { force: true }).catch(() => {});
      remainingCount -= 1;
      totalBytes -= item.size;
    }
  } catch {
    // Non-fatal cache prune failure
  }
}

function registerMikanImageProtocol(): void {
  protocol.handle('mikan-img', async (request) => {
    try {
      const reqUrl = new URL(request.url);
      const targetUrl = reqUrl.searchParams.get('url');
      if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
        return new Response('Invalid image url', { status: 400 });
      }

      const hash = crypto.createHash('sha1').update(targetUrl).digest('hex');
      const cacheDir = getImageCacheDir();
      const cacheDataPath = path.join(cacheDir, `${hash}.bin`);
      const cacheMetaPath = path.join(cacheDir, `${hash}.meta.json`);

      try {
        const [metaRaw, buf] = await Promise.all([
          fsp.readFile(cacheMetaPath, 'utf-8'),
          fsp.readFile(cacheDataPath),
        ]);
        const meta = JSON.parse(metaRaw) as { contentType?: string };
        return new Response(buf, {
          status: 200,
          headers: {
            'Content-Type': meta.contentType || 'image/jpeg',
            'Cache-Control': 'public, max-age=604800',
          },
        });
      } catch {
        // Cache miss or read failed; fetch from network
      }

      let fetchPromise = inFlightImageFetches.get(hash);
      if (!fetchPromise) {
        fetchPromise = (async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          try {
            const parsedTarget = new URL(targetUrl);
            const res = await net.fetch(targetUrl, {
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                Referer: `${parsedTarget.origin}/`,
                Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
              },
              signal: controller.signal,
            });

            if (!res.ok) {
              return { status: res.status };
            }

            const arrayBuf = await res.arrayBuffer();
            const bytes = new Uint8Array(arrayBuf);
            const contentType =
              (res.headers.get('content-type') || '').split(';')[0].trim() ||
              guessMimeFromExt(path.extname(parsedTarget.pathname));

            void Promise.all([
              fsp.writeFile(cacheDataPath, bytes),
              fsp.writeFile(cacheMetaPath, JSON.stringify({ contentType, url: targetUrl })),
            ]).catch(() => {});

            return { bytes, contentType };
          } finally {
            clearTimeout(timer);
          }
        })().finally(() => {
          if (inFlightImageFetches.get(hash) === fetchPromise) {
            inFlightImageFetches.delete(hash);
          }
        });
        inFlightImageFetches.set(hash, fetchPromise);
      }

      const result = await fetchPromise;
      if ('status' in result) {
        return new Response('Image fetch failed', { status: result.status });
      }

      return new Response(result.bytes, {
        status: 200,
        headers: {
          'Content-Type': result.contentType,
          'Cache-Control': 'public, max-age=604800',
        },
      });
    } catch {
      return new Response('Image proxy error', { status: 502 });
    }
  });
}

function resolveWindowIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(process.resourcesPath, 'build', 'icon.png'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function createMainWindow(): BrowserWindow {
  const isWin = process.platform === 'win32';
  const windowIcon = resolveWindowIcon();

  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'MikanVault',
    ...(windowIcon ? { icon: windowIcon } : {}),
    backgroundColor: '#EEF3FA',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(isWin
      ? {
          titleBarOverlay: {
            color: '#EEF3FA',
            symbolColor: '#334155',
            height: 53,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const isDevFlag = process.argv.includes('--dev');
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || (isDevFlag ? 'http://127.0.0.1:5173' : '');

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    const indexHtml = path.join(__dirname, '..', 'dist', 'index.html');
    void win.loadFile(indexHtml);
  }

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  return win;
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerMikanImageProtocol();
    registerIpcHandlers();
    mainWindow = createMainWindow();
    startSubscriptionScheduler();
    startCloudTransferWatcher();
    const pruneTimer = setTimeout(() => {
      void pruneImageCache();
    }, 15_000);
    pruneTimer.unref?.();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });

  app.on('before-quit', () => {
    stopSubscriptionScheduler();
    stopCloudTransferWatcher();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

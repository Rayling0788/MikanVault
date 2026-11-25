import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, net, protocol, shell } from 'electron';
import { registerIpcHandlers } from './services/ipcHandlers';
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

function getImageCacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'image-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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

      if (fs.existsSync(cacheDataPath) && fs.existsSync(cacheMetaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(cacheMetaPath, 'utf-8')) as { contentType?: string };
          const buf = fs.readFileSync(cacheDataPath);
          return new Response(buf, {
            status: 200,
            headers: {
              'Content-Type': meta.contentType || 'image/jpeg',
              'Cache-Control': 'public, max-age=604800',
            },
          });
        } catch {
          // Cache read failed; fall through to re-fetch
        }
      }

      const parsedTarget = new URL(targetUrl);
      const res = await net.fetch(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          Referer: `${parsedTarget.origin}/`,
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });

      if (!res.ok) {
        return new Response('Image fetch failed', { status: res.status });
      }

      const arrayBuf = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const contentType =
        res.headers.get('content-type') || guessMimeFromExt(path.extname(parsedTarget.pathname));

      try {
        fs.writeFileSync(cacheDataPath, buf);
        fs.writeFileSync(cacheMetaPath, JSON.stringify({ contentType, url: targetUrl }));
      } catch {
        // Ignore disk cache write errors
      }

      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=604800',
        },
      });
    } catch {
      return new Response('Image proxy error', { status: 502 });
    }
  });
}

function createMainWindow(): BrowserWindow {
  const isWin = process.platform === 'win32';

  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'MikanVault',
    backgroundColor: '#0B0D11',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    ...(isWin
      ? {
          titleBarOverlay: {
            color: '#0B0D11',
            symbolColor: '#94A3B8',
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

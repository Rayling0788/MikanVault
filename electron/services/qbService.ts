import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  ActionResult,
  AddDownloadRequest,
  AddDownloadResult,
  BatchAddDownloadItemResult,
  BatchAddDownloadResult,
  QbConnectionOverride,
  QbConnectionStatus,
  QbControlAction,
  QbLaunchResult,
  QbTorrentItem,
} from '../../src/shared/types';
import {
  findDownloadMetaInStore,
  getMetadata,
  getSettings,
  recordDownloadMeta,
} from './configStore';
import { enqueueCloudTransferJob } from './cloudService';
import { mikanFetch, type FetchLike } from './mikanService';

interface QbAuthConfig {
  qbUrl: string;
  qbUsername: string;
  qbPassword: string;
  qbExePath: string;
}

interface RawQbTorrent {
  hash: string;
  name: string;
  state: string;
  progress: number;
  size: number;
  downloaded?: number;
  amount_left?: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  ratio?: number;
  save_path: string;
  content_path?: string;
  category: string;
  added_on: number;
}

const sidCache = new Map<string, string>();
const inFlightLogins = new Map<string, Promise<string | undefined>>();
let cachedQbProcess: { running: boolean; expiresAt: number } | null = null;
let inFlightProcessCheck: Promise<boolean> | null = null;
let cachedExeCheck: { exePath: string; exists: boolean; expiresAt: number } | null = null;
const QB_PROCESS_CACHE_TTL_MS = 10_000;
const QB_EXE_CACHE_TTL_MS = 30_000;

export function clearQbSessionCache(): void {
  sidCache.clear();
  inFlightLogins.clear();
  cachedQbProcess = null;
  inFlightProcessCheck = null;
  cachedExeCheck = null;
}

function checkExeExists(exePath: string, force = false): boolean {
  if (!exePath) return false;
  const now = Date.now();
  if (
    !force &&
    cachedExeCheck &&
    cachedExeCheck.exePath === exePath &&
    cachedExeCheck.expiresAt > now
  ) {
    return cachedExeCheck.exists;
  }
  const exists = fs.existsSync(exePath);
  cachedExeCheck = { exePath, exists, expiresAt: now + QB_EXE_CACHE_TTL_MS };
  return exists;
}

export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned.slice(0, 120) || 'Unknown';
}

function getCacheKey(config: QbAuthConfig): string {
  return `${config.qbUrl}|${config.qbUsername}`;
}

function extractSidCookie(res: Response): string | undefined {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const cookies: string[] = [];
  if (typeof headers.getSetCookie === 'function') {
    cookies.push(...headers.getSetCookie());
  } else {
    const single = res.headers.get('set-cookie');
    if (single) cookies.push(single);
  }
  for (const cookie of cookies) {
    const match = cookie.match(/\bSID=([^;]+)/);
    if (match?.[1]) {
      return `SID=${match[1]}`;
    }
  }
  return undefined;
}

function resolveAuthConfig(override?: QbConnectionOverride): QbAuthConfig {
  const settings = getSettings();
  return {
    qbUrl: (override?.qbUrl ?? settings.qbUrl).trim().replace(/\/+$/, ''),
    qbUsername: override?.qbUsername ?? settings.qbUsername,
    qbPassword: override?.qbPassword ?? settings.qbPassword,
    qbExePath: override?.qbExePath ?? settings.qbExePath,
  };
}

async function qbRawFetch(
  url: string,
  init: RequestInit,
  fetchFn?: FetchLike,
  timeoutMs = 12000,
): Promise<Response> {
  const impl = fetchFn ?? ((input: string, reqInit?: RequestInit) => fetch(input, reqInit));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await impl(url, {
      ...init,
      signal: init.signal ?? controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export class QbAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QbAuthError';
  }
}

async function loginToQb(
  config: QbAuthConfig,
  fetchFn?: FetchLike,
  timeoutMs = 12000,
): Promise<string | undefined> {
  const cacheKey = getCacheKey(config);
  const existing = inFlightLogins.get(cacheKey);
  if (existing && !fetchFn) {
    return existing;
  }

  const doLogin = async (): Promise<string | undefined> => {
    const body = new URLSearchParams({
      username: config.qbUsername,
      password: config.qbPassword,
    });

    const res = await qbRawFetch(
      `${config.qbUrl}/api/v2/auth/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: config.qbUrl,
        },
        body: body.toString(),
      },
      fetchFn,
      timeoutMs,
    );

    const text = (await res.text()).trim();
    if (!res.ok || text.toLowerCase().includes('fails')) {
      throw new QbAuthError(
        res.status === 403
          ? 'qBittorrent 登录被拒绝（尝试次数过多或密码错误）'
          : 'qBittorrent WebUI 认证失败，请检查用户名和密码',
      );
    }

    const sid = extractSidCookie(res);
    if (sid) {
      sidCache.set(cacheKey, sid);
    }
    return sid;
  };

  // Deduplicate concurrent login attempts even when tests inject shared mock fetchFn
  if (existing) {
    return existing;
  }

  const loginPromise = doLogin().finally(() => {
    if (inFlightLogins.get(cacheKey) === loginPromise) {
      inFlightLogins.delete(cacheKey);
    }
  });
  inFlightLogins.set(cacheKey, loginPromise);
  return loginPromise;
}

async function requestQbApi(
  apiPath: string,
  init: RequestInit,
  config: QbAuthConfig,
  fetchFn?: FetchLike,
  timeoutMs = 12000,
): Promise<Response> {
  const cacheKey = getCacheKey(config);
  let sid = sidCache.get(cacheKey);
  if (!sid) {
    sid = await loginToQb(config, fetchFn, timeoutMs);
  }

  const buildHeaders = (cookie?: string): Record<string, string> => {
    const base: Record<string, string> = {
      Referer: config.qbUrl,
      ...(init.headers as Record<string, string> | undefined),
    };
    if (cookie) {
      base.Cookie = cookie;
    }
    return base;
  };

  let res = await qbRawFetch(
    `${config.qbUrl}${apiPath}`,
    {
      ...init,
      headers: buildHeaders(sid),
    },
    fetchFn,
    timeoutMs,
  );

  if (res.status === 403) {
    sidCache.delete(cacheKey);
    sid = await loginToQb(config, fetchFn, timeoutMs);
    res = await qbRawFetch(
      `${config.qbUrl}${apiPath}`,
      {
        ...init,
        headers: buildHeaders(sid),
      },
      fetchFn,
      timeoutMs,
    );
  }

  return res;
}

export async function isQbProcessRunning(force = false): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const now = Date.now();
  if (!force && cachedQbProcess && cachedQbProcess.expiresAt > now) {
    return cachedQbProcess.running;
  }
  if (!force && inFlightProcessCheck) {
    return inFlightProcessCheck;
  }

  const checkPromise = new Promise<boolean>((resolve) => {
    execFile(
      'tasklist',
      ['/FI', 'IMAGENAME eq qbittorrent.exe', '/NH'],
      { timeout: 3000 },
      (err, stdout) => {
        const running = err ? false : stdout.toLowerCase().includes('qbittorrent.exe');
        cachedQbProcess = {
          running,
          expiresAt: Date.now() + QB_PROCESS_CACHE_TTL_MS,
        };
        resolve(running);
      },
    );
  }).finally(() => {
    if (inFlightProcessCheck === checkPromise) {
      inFlightProcessCheck = null;
    }
  });

  inFlightProcessCheck = checkPromise;
  return checkPromise;
}

export function detectQbWebUiBindFailure(portHint?: string): string | null {
  if (process.platform !== 'win32') return null;
  const logPath = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'qBittorrent', 'logs', 'qbittorrent.log')
    : path.join(os.homedir(), 'AppData', 'Local', 'qBittorrent', 'logs', 'qbittorrent.log');
  try {
    if (!fs.existsSync(logPath)) return null;
    const stat = fs.statSync(logPath);
    const readSize = Math.min(stat.size, 8192);
    const fd = fs.openSync(logPath, 'r');
    const buf = Buffer.alloc(readSize);
    try {
      fs.readSync(fd, buf, 0, readSize, Math.max(0, stat.size - readSize));
    } finally {
      fs.closeSync(fd);
    }
    const tail = buf.toString('utf-8');
    const lines = tail.split(/\r?\n/).filter(Boolean).slice(-60);
    // Walk from newest to oldest for the latest WebUI status line
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];
      if (/Web\s*UI/i.test(line)) {
        if (/无法绑定|Unable to bind|被保护|protected|address already in use|已在运行/i.test(line)) {
          const port = portHint || line.match(/端口[：:]\s*(\d+)|port[：:]\s*(\d+)/i)?.[1] || '8080';
          return `qBittorrent 已启动，但 WebUI 端口 ${port} 被系统保留或占用（Windows 端口冲突），请在 qBittorrent「工具 → 选项 → Web UI」将端口改为 18080 后同步修改 MikanVault 设置`;
        }
        if (/使用内置\s*WebUI|Using built-in WebUI/i.test(line)) {
          break;
        }
      }
    }
  } catch {
    // Ignore log read errors
  }
  return null;
}

export async function testConnection(
  override?: QbConnectionOverride,
  fetchFn?: FetchLike,
): Promise<QbConnectionStatus> {
  const config = resolveAuthConfig(override);
  const exeExists = checkExeExists(config.qbExePath, Boolean(override));

  try {
    // When testing with explicit override, force fresh login so new credentials are verified
    if (override) {
      sidCache.delete(getCacheKey(config));
    }
    const res = await requestQbApi('/api/v2/app/version', { method: 'GET' }, config, fetchFn, 4500);
    if (!res.ok) {
      return {
        ok: false,
        connected: false,
        error: `qBittorrent WebUI 返回异常状态码 HTTP ${res.status}`,
        qbRunning: true,
        exeExists,
      };
    }
    const version = (await res.text()).trim();
    return {
      ok: true,
      connected: true,
      version,
      qbRunning: true,
      exeExists,
    };
  } catch (err) {
    if (err instanceof QbAuthError) {
      return {
        ok: false,
        connected: false,
        error: err.message,
        qbRunning: true,
        exeExists,
      };
    }
    const qbRunning = fetchFn ? false : await isQbProcessRunning(Boolean(override));
    let bindError: string | null = null;
    if (qbRunning && !fetchFn) {
      let portHint: string | undefined;
      try {
        portHint = new URL(config.qbUrl).port || undefined;
      } catch {
        portHint = undefined;
      }
      bindError = detectQbWebUiBindFailure(portHint);
    }
    return {
      ok: false,
      connected: false,
      error: qbRunning
        ? bindError || 'qBittorrent 正在运行，但无法连接 WebUI，请检查端口与 WebUI 是否已启用'
        : '无法连接到 qBittorrent WebUI，请先启动 qBittorrent',
      qbRunning,
      exeExists,
    };
  }
}

export async function launchQbittorrent(): Promise<QbLaunchResult> {
  const settings = getSettings();
  const exePath = settings.qbExePath?.trim();

  if (await isQbProcessRunning(true)) {
    return { ok: true, alreadyRunning: true };
  }

  if (!exePath || !fs.existsSync(exePath)) {
    return {
      ok: false,
      error: '未找到 qBittorrent.exe，请在设置中配置正确的本地路径',
    };
  }

  try {
    const child = spawn(exePath, [], {
      cwd: path.dirname(exePath),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });

    const spawnErr = await new Promise<Error | null>((resolve) => {
      let settled = false;
      child.once('error', (err) => {
        if (!settled) {
          settled = true;
          resolve(err);
        }
      });
      setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 250);
    });

    if (!spawnErr) {
      child.unref();
      return { ok: true, alreadyRunning: false };
    }

    // Fallback to Electron shell.openPath when direct spawn fails
    if (process.versions?.electron) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const electron = require('electron') as typeof import('electron');
      const errMsg = await electron.shell.openPath(exePath);
      if (!errMsg) {
        return { ok: true, alreadyRunning: false };
      }
      return { ok: false, error: errMsg };
    }

    return { ok: false, error: spawnErr.message };
  } catch (err) {
    if (process.versions?.electron) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const electron = require('electron') as typeof import('electron');
        const errMsg = await electron.shell.openPath(exePath);
        if (!errMsg) {
          return { ok: true, alreadyRunning: false };
        }
      } catch {
        // Ignore fallback failure
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : '启动 qBittorrent 失败',
    };
  }
}

export function normalizeTorrentHash(hash: string): string {
  const normalized = hash.toLowerCase();
  if (!/^[a-z2-7]{32}$/.test(normalized)) return normalized;

  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 255);
    }
  }
  return Buffer.from(bytes).toString('hex');
}

function extractHashFromRequest(req: AddDownloadRequest): string | undefined {
  if (req.magnetUrl) {
    const m = req.magnetUrl.match(/btih:([a-fA-F0-9]{40}|[A-Z2-7]{32})/i);
    if (m) return m[1].toLowerCase();
  }
  if (req.torrentUrl) {
    const m = req.torrentUrl.match(/\/([a-fA-F0-9]{40})\.torrent/i);
    if (m) return m[1].toLowerCase();
  }
  return undefined;
}

export function deriveFolderNameFromReleaseTitle(rawTitle: string): string {
  if (!rawTitle?.trim()) return '';
  let name = rawTitle.trim();
  name = name.replace(/^[\[【][^\]】]+[\]】]\s*/, '');
  name = name
    .replace(/\s+-\s+\d{1,4}(?:\.\d)?(?:v\d)?.*$/i, '')
    .replace(/\s*(?:S\d{1,2})?(?:EP|E)\d{1,4}.*$/i, '')
    .replace(/\s*第\s*\d{1,4}\s*[话話集回].*$/, '')
    .replace(/\s*[\[【]\d{1,4}(?:v\d)?(?:-\d{1,4})?[\]】].*$/i, '')
    .replace(/\s*[\[【](?:1080P|720P|4K|2160P|BDRip|WebRip|WEB-DL|HEVC|AVC|简|繁|正片).*$/i, '');
  name = name.trim().replace(/^[\[【]([^\]】]+)[\]】]$/, '$1');
  if (name.includes('/')) {
    const primary = name.split('/')[0].trim();
    if (primary) name = primary;
  }
  const cleaned = name.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? sanitizeFolderName(cleaned) : '';
}

function normalizeWindowsRoot(p: string): string {
  const trimmed = p.trim();
  return /^[a-zA-Z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
}

export async function addDownload(
  req: AddDownloadRequest,
  qbFetchFn?: FetchLike,
  torrentFetchFn?: FetchLike,
): Promise<AddDownloadResult> {
  const settings = getSettings();
  const config = resolveAuthConfig();

  const resolvedFolder =
    req.bangumiTitle?.trim()
      ? sanitizeFolderName(req.bangumiTitle)
      : deriveFolderNameFromReleaseTitle(req.title);

  const rootDir = path.resolve(normalizeWindowsRoot(settings.downloadRootDir));
  const savePath = req.savePath?.trim()
    ? path.resolve(normalizeWindowsRoot(req.savePath))
    : resolvedFolder
      ? path.join(rootDir, resolvedFolder)
      : rootDir;

  try {
    await fsp.mkdir(savePath, { recursive: true });
  } catch {
    // Let qBittorrent create directory if needed
  }

  const formData = new FormData();
  formData.append('savepath', savePath);

  const category = (req.category ?? settings.qbCategory ?? '').trim();
  if (category) {
    formData.append('category', category);
  }

  let attachedTorrent = false;
  if (req.torrentUrl?.trim()) {
    try {
      const torrentRes = await mikanFetch(req.torrentUrl.trim(), {}, torrentFetchFn ?? qbFetchFn);
      if (torrentRes.ok) {
        const arrayBuf = await torrentRes.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        // Valid bencoded torrent file starts with ASCII 'd' (0x64)
        if (bytes.byteLength > 20 && bytes[0] === 0x64) {
          const fileName = `${sanitizeFolderName(req.title || 'download')}.torrent`;
          formData.append(
            'torrents',
            new Blob([bytes], { type: 'application/x-bittorrent' }),
            fileName,
          );
          attachedTorrent = true;
        }
      }
    } catch {
      // Fall back to magnetUrl below
    }
  }

  if (!attachedTorrent) {
    if (req.magnetUrl?.trim()) {
      formData.append('urls', req.magnetUrl.trim());
    } else {
      return {
        ok: false,
        savePath,
        error: '无法下载 .torrent 种子文件，且未提供可用的磁力链接',
      };
    }
  }

  try {
    const res = await requestQbApi(
      '/api/v2/torrents/add',
      {
        method: 'POST',
        body: formData,
      },
      config,
      qbFetchFn,
    );

    const text = (await res.text()).trim();
    if (!res.ok || text.toLowerCase().includes('fails')) {
      return {
        ok: false,
        savePath,
        error: `qBittorrent 添加任务失败 (${text || `HTTP ${res.status}`})`,
      };
    }

    const hash = extractHashFromRequest(req);
    recordDownloadMeta({
      hash,
      title: req.title,
      bangumiId: req.bangumiId,
      bangumiTitle: req.bangumiTitle,
      coverUrl: req.coverUrl,
      subgroup: req.subgroup,
      savePath,
    });

    if (req.cloudTargetDir?.trim()) {
      enqueueCloudTransferJob({
        torrentHash: hash,
        torrentName: req.title,
        bangumiId: req.bangumiId,
        bangumiTitle: req.bangumiTitle,
        coverUrl: req.coverUrl,
        subgroup: req.subgroup,
        localSavePath: savePath,
        cloudTargetDir: req.cloudTargetDir.trim(),
        deleteLocalAfterMove: req.deleteLocalAfterCloudMove ?? true,
      });
    }

    return {
      ok: true,
      hash,
      savePath,
    };
  } catch (err) {
    return {
      ok: false,
      savePath,
      error:
        err instanceof QbAuthError
          ? err.message
          : '无法连接到 qBittorrent，请确认 qBittorrent 正在运行并已启用 WebUI',
    };
  }
}

export async function addDownloadsBatch(
  requests: AddDownloadRequest[],
  qbFetchFn?: FetchLike,
  torrentFetchFn?: FetchLike,
): Promise<BatchAddDownloadResult> {
  if (!Array.isArray(requests) || requests.length === 0) {
    return { total: 0, succeeded: 0, failed: 0, results: [] };
  }

  const results: BatchAddDownloadItemResult[] = new Array(requests.length);
  const concurrency = Math.min(3, requests.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= requests.length) break;
      const req = requests[idx];
      try {
        const res = await addDownload(req, qbFetchFn, torrentFetchFn);
        results[idx] = {
          title: req.title,
          ok: res.ok,
          hash: res.hash,
          savePath: res.savePath,
          error: res.error,
        };
      } catch (err) {
        results[idx] = {
          title: req.title,
          ok: false,
          savePath: req.savePath || '',
          error: err instanceof Error ? err.message : '添加任务异常',
        };
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const succeeded = results.filter((r) => r.ok).length;
  return {
    total: requests.length,
    succeeded,
    failed: requests.length - succeeded,
    results,
  };
}

export async function getTorrents(fetchFn?: FetchLike): Promise<QbTorrentItem[]> {
  const config = resolveAuthConfig();
  try {
    const res = await requestQbApi(
      '/api/v2/torrents/info?sort=added_on&reverse=true',
      { method: 'GET' },
      config,
      fetchFn,
    );
    if (!res.ok) {
      return [];
    }
    const rawList = (await res.json()) as RawQbTorrent[];
    if (!Array.isArray(rawList)) return [];

    const metaStore = getMetadata();
    return rawList.map((item) => {
      const meta = findDownloadMetaInStore(metaStore, item.hash, item.name, item.save_path);
      return {
        hash: item.hash,
        name: item.name,
        state: item.state,
        progress: typeof item.progress === 'number' ? item.progress : 0,
        size: typeof item.size === 'number' ? item.size : 0,
        downloaded: item.downloaded,
        amountLeft: item.amount_left,
        dlspeed: typeof item.dlspeed === 'number' ? item.dlspeed : 0,
        upspeed: typeof item.upspeed === 'number' ? item.upspeed : 0,
        eta: typeof item.eta === 'number' ? item.eta : 8640000,
        ratio: item.ratio,
        savePath: item.save_path || '',
        contentPath: item.content_path,
        category: item.category || '',
        addedOn: typeof item.added_on === 'number' ? item.added_on : 0,
        bangumiId: meta?.bangumiId,
        bangumiTitle: meta?.bangumiTitle,
        coverUrl: meta?.coverUrl,
      };
    });
  } catch {
    return [];
  }
}

export async function controlTorrent(
  hash: string,
  action: QbControlAction,
  fetchFn?: FetchLike,
): Promise<ActionResult> {
  const cleanHash = hash.trim();
  if (!cleanHash) {
    return { ok: false, error: '无效的种子哈希' };
  }

  const config = resolveAuthConfig();
  const postForm = async (apiPath: string, params: Record<string, string>): Promise<Response> => {
    const body = new URLSearchParams(params);
    return requestQbApi(
      apiPath,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
      config,
      fetchFn,
    );
  };

  try {
    let res: Response;
    if (action === 'pause') {
      // qBittorrent 5.x uses /stop; fall back to /pause for 4.x
      res = await postForm('/api/v2/torrents/stop', { hashes: cleanHash });
      if (res.status === 404) {
        res = await postForm('/api/v2/torrents/pause', { hashes: cleanHash });
      }
    } else if (action === 'resume') {
      // qBittorrent 5.x uses /start; fall back to /resume for 4.x
      res = await postForm('/api/v2/torrents/start', { hashes: cleanHash });
      if (res.status === 404) {
        res = await postForm('/api/v2/torrents/resume', { hashes: cleanHash });
      }
    } else if (action === 'delete') {
      res = await postForm('/api/v2/torrents/delete', {
        hashes: cleanHash,
        deleteFiles: 'false',
      });
    } else if (action === 'deleteWithFiles') {
      res = await postForm('/api/v2/torrents/delete', {
        hashes: cleanHash,
        deleteFiles: 'true',
      });
    } else {
      return { ok: false, error: `不支持的操作: ${String(action)}` };
    }

    if (!res.ok) {
      return { ok: false, error: `qBittorrent 操作失败 (HTTP ${res.status})` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '操作 qBittorrent 任务失败',
    };
  }
}

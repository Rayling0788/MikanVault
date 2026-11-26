import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AppSettings,
  CloudTransferJob,
  SubscriptionItem,
  SubscriptionLogEntry,
} from '../../src/shared/types';

export interface DownloadMetaRecord {
  hash?: string;
  title: string;
  bangumiId?: string;
  bangumiTitle?: string;
  coverUrl?: string;
  subgroup?: string;
  savePath: string;
  addedAt: number;
}

export interface WatchedRecord {
  watched: boolean;
  lastPlayedAt?: number;
  updatedAt: number;
}

export interface SeriesMetaRecord {
  seriesId?: string;
  folderPath: string;
  title: string;
  originalTitle?: string;
  bangumiId?: string;
  coverUrl?: string;
  infoLines?: string[];
  overview?: string;
  rating?: number;
  airDate?: string;
  scrapedAt?: number;
  updatedAt: number;
}

export interface MetadataStore {
  downloadsMap: Record<string, DownloadMetaRecord>;
  watchedMap: Record<string, WatchedRecord>;
  seriesMetaMap: Record<string, SeriesMetaRecord>;
  hiddenSeriesIds: string[];
  hiddenFilePaths: string[];
  subscriptions: SubscriptionItem[];
  subscriptionLogs: SubscriptionLogEntry[];
  cloudTransferJobs: CloudTransferJob[];
}

let customDataDir: string | null = null;
let cachedSettings: AppSettings | null = null;
let cachedSettingsSig: string | null = null;
let cachedMetadata: MetadataStore | null = null;
let cachedMetadataSig: string | null = null;
let cachedDriveMount: {
  value: { mountRoot?: string; defaultTargetDir?: string };
  expiresAt: number;
} | null = null;
let atomicWriteSeq = 0;

const DRIVE_MOUNT_CACHE_TTL_MS = 15_000;
const MAX_DOWNLOADS_META_ENTRIES = 400;

function getFileSignature(filePath: string): string | null {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

function getDefaultStandaloneDataDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'mikan-vault');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'mikan-vault');
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'mikan-vault');
}

function getElectronApp(): typeof import('electron').app | null {
  if (!process.versions?.electron) {
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron') as typeof import('electron');
    return electron?.app ?? null;
  } catch {
    return null;
  }
}

export function setDataDirForTesting(dir: string | null): void {
  customDataDir = dir;
  cachedSettings = null;
  cachedSettingsSig = null;
  cachedMetadata = null;
  cachedMetadataSig = null;
  cachedDriveMount = null;
}

export function invalidateGoogleDriveMountCache(): void {
  cachedDriveMount = null;
}

export function getDataDir(): string {
  if (customDataDir) {
    fs.mkdirSync(customDataDir, { recursive: true });
    return customDataDir;
  }
  const envDataDir = process.env.MIKANVAULT_DATA_DIR?.trim();
  if (envDataDir) {
    const resolved = path.resolve(envDataDir);
    fs.mkdirSync(resolved, { recursive: true });
    return resolved;
  }
  const electronApp = getElectronApp();
  let baseDir: string;
  if (electronApp) {
    try {
      baseDir = electronApp.getPath('userData');
    } catch {
      baseDir = getDefaultStandaloneDataDir();
    }
  } else {
    baseDir = getDefaultStandaloneDataDir();
  }
  fs.mkdirSync(baseDir, { recursive: true });
  return baseDir;
}

export function getImageCacheDir(): string {
  const dir = path.join(getDataDir(), 'image-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function normalizePathKey(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function detectQbExePath(existsFn: (p: string) => boolean = fs.existsSync): string {
  const candidates = [
    'D:\\Files\\qBittorrent\\qbittorrent.exe',
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'qBittorrent', 'qbittorrent.exe'),
    path.join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'qBittorrent',
      'qbittorrent.exe',
    ),
    ...(process.env.LOCALAPPDATA
      ? [path.join(process.env.LOCALAPPDATA, 'Programs', 'qBittorrent', 'qbittorrent.exe')]
      : []),
  ];

  for (const candidate of candidates) {
    try {
      if (existsFn(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore permission or path errors
    }
  }
  return 'D:\\Files\\qBittorrent\\qbittorrent.exe';
}

export interface QbIniDefaults {
  qbUrl: string;
  qbUsername: string;
}

export function parseQbIniContent(content: string): QbIniDefaults {
  let port = 8080;
  let username = 'admin';
  let address = '127.0.0.1';
  let useHttps = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('[')) {
      continue;
    }
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const rawValue = line.slice(eqIndex + 1).trim().replace(/^"(.*)"$/, '$1');

    if (/^WebUI\\Port$/i.test(key)) {
      const parsedPort = Number.parseInt(rawValue, 10);
      if (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535) {
        port = parsedPort;
      }
    } else if (/^WebUI\\Username$/i.test(key) && rawValue) {
      username = rawValue;
    } else if (/^WebUI\\Address$/i.test(key) && rawValue) {
      if (rawValue !== '*' && rawValue !== '0.0.0.0' && rawValue !== '::') {
        address = rawValue;
      }
    } else if (/^WebUI\\HTTPS\\Enabled$/i.test(key)) {
      useHttps = rawValue.toLowerCase() === 'true';
    }
  }

  const protocol = useHttps ? 'https' : 'http';
  const formattedHost = address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
  return {
    qbUrl: `${protocol}://${formattedHost}:${port}`,
    qbUsername: username,
  };
}

export function readQbIniDefaults(iniPath?: string): QbIniDefaults {
  const targetPath =
    iniPath ||
    (process.env.APPDATA
      ? path.join(process.env.APPDATA, 'qBittorrent', 'qBittorrent.ini')
      : path.join(os.homedir(), 'AppData', 'Roaming', 'qBittorrent', 'qBittorrent.ini'));

  try {
    if (fs.existsSync(targetPath)) {
      const content = fs.readFileSync(targetPath, 'utf-8');
      return parseQbIniContent(content);
    }
  } catch {
    // Read-only best effort; fall back to defaults
  }

  return {
    qbUrl: 'http://127.0.0.1:8080',
    qbUsername: 'admin',
  };
}

export function detectGoogleDriveMount(
  forceRefresh = false,
): { mountRoot?: string; defaultTargetDir?: string } {
  const now = Date.now();
  if (!forceRefresh && cachedDriveMount && cachedDriveMount.expiresAt > now) {
    return { ...cachedDriveMount.value };
  }

  let detected: { mountRoot?: string; defaultTargetDir?: string } = {};
  if (process.platform === 'win32') {
    const driveLetters = 'DEFGHIJKLMNOPQRSTUVWXYZ';
    outer: for (const letter of driveLetters) {
      for (const folderName of ['我的云端硬盘', 'My Drive']) {
        const candidate = `${letter}:\\${folderName}`;
        try {
          if (fs.existsSync(candidate)) {
            detected = {
              mountRoot: candidate,
              defaultTargetDir: path.join(candidate, 'MikanVault'),
            };
            break outer;
          }
        } catch {
          // Ignore unreadable drives
        }
      }
    }
  }

  cachedDriveMount = {
    value: detected,
    expiresAt: now + DRIVE_MOUNT_CACHE_TTL_MS,
  };
  return { ...detected };
}

export function buildDefaultSettings(): AppSettings {
  const qbDefaults = readQbIniDefaults();
  const cloudMount = detectGoogleDriveMount();
  return {
    mikanBaseUrl: 'https://mikanani.kas.pub',
    qbUrl: qbDefaults.qbUrl,
    qbUsername: qbDefaults.qbUsername,
    qbPassword: '',
    qbExePath: detectQbExePath(),
    qbCategory: 'MikanVault',
    downloadRootDir: path.join(os.homedir(), 'Videos', 'MikanVault'),
    extraLibraryDirs: [],
    playerMode: 'system',
    customPlayerPath: '',
    subscriptionCheckIntervalMin: 15,
    subscriptionAutoLaunchQb: false,
    googleDriveEnabled: Boolean(cloudMount.defaultTargetDir),
    googleDriveDir: cloudMount.defaultTargetDir || '',
    googleDriveAutoDeleteLocal: true,
    googleDriveIncludeInLibrary: true,
  };
}

function getSettingsFilePath(): string {
  return path.join(getDataDir(), 'settings.json');
}

function getMetadataFilePath(): string {
  return path.join(getDataDir(), 'metadata.json');
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(data, null, 2);
  atomicWriteSeq = (atomicWriteSeq + 1) % 1_000_000;
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSeq}.tmp`;
  try {
    fs.writeFileSync(tmpPath, payload, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup error
    }
    fs.writeFileSync(filePath, payload, 'utf-8');
  }
}

function sanitizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function getSettings(): AppSettings {
  const filePath = getSettingsFilePath();
  const currentSig = getFileSignature(filePath);

  if (cachedSettings && currentSig !== null && currentSig === cachedSettingsSig) {
    return { ...cachedSettings, extraLibraryDirs: [...cachedSettings.extraLibraryDirs] };
  }

  const defaults = buildDefaultSettings();

  if (fs.existsSync(filePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<AppSettings>;
      cachedSettings = {
        ...defaults,
        ...raw,
        mikanBaseUrl: sanitizeBaseUrl(raw.mikanBaseUrl || defaults.mikanBaseUrl),
        qbUrl: sanitizeBaseUrl(raw.qbUrl || defaults.qbUrl),
        extraLibraryDirs: Array.isArray(raw.extraLibraryDirs)
          ? raw.extraLibraryDirs.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
          : defaults.extraLibraryDirs,
        playerMode: raw.playerMode === 'custom' ? 'custom' : 'system',
        subscriptionCheckIntervalMin:
          typeof raw.subscriptionCheckIntervalMin === 'number' &&
          Number.isFinite(raw.subscriptionCheckIntervalMin)
            ? Math.min(1440, Math.max(5, Math.round(raw.subscriptionCheckIntervalMin)))
            : defaults.subscriptionCheckIntervalMin,
        subscriptionAutoLaunchQb: Boolean(raw.subscriptionAutoLaunchQb),
        googleDriveEnabled:
          typeof raw.googleDriveEnabled === 'boolean'
            ? raw.googleDriveEnabled
            : Boolean((raw.googleDriveDir ?? defaults.googleDriveDir).trim()),
        googleDriveDir:
          typeof raw.googleDriveDir === 'string'
            ? raw.googleDriveDir.trim() ||
              (raw.googleDriveEnabled === false ? '' : defaults.googleDriveDir)
            : defaults.googleDriveDir,
        googleDriveAutoDeleteLocal:
          typeof raw.googleDriveAutoDeleteLocal === 'boolean'
            ? raw.googleDriveAutoDeleteLocal
            : defaults.googleDriveAutoDeleteLocal,
        googleDriveIncludeInLibrary:
          typeof raw.googleDriveIncludeInLibrary === 'boolean'
            ? raw.googleDriveIncludeInLibrary
            : defaults.googleDriveIncludeInLibrary,
      };
      cachedSettingsSig = getFileSignature(filePath);
      return { ...cachedSettings, extraLibraryDirs: [...cachedSettings.extraLibraryDirs] };
    } catch {
      // Corrupted JSON; recover with defaults
    }
  }

  cachedSettings = defaults;
  try {
    writeJsonAtomic(filePath, cachedSettings);
    cachedSettingsSig = getFileSignature(filePath);
  } catch {
    cachedSettingsSig = null;
  }
  return { ...cachedSettings, extraLibraryDirs: [...cachedSettings.extraLibraryDirs] };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const rawInterval = patch.subscriptionCheckIntervalMin ?? current.subscriptionCheckIntervalMin;
  const safeInterval = Number.isFinite(rawInterval)
    ? Math.min(1440, Math.max(5, Math.round(rawInterval)))
    : 15;
  const next: AppSettings = {
    ...current,
    ...patch,
    mikanBaseUrl: sanitizeBaseUrl(patch.mikanBaseUrl ?? current.mikanBaseUrl) || 'https://mikanani.kas.pub',
    qbUrl: sanitizeBaseUrl(patch.qbUrl ?? current.qbUrl) || 'http://127.0.0.1:8080',
    extraLibraryDirs: Array.isArray(patch.extraLibraryDirs)
      ? Array.from(new Set(patch.extraLibraryDirs.map((d) => d.trim()).filter(Boolean)))
      : current.extraLibraryDirs,
    playerMode: (patch.playerMode ?? current.playerMode) === 'custom' ? 'custom' : 'system',
    subscriptionCheckIntervalMin: safeInterval,
    subscriptionAutoLaunchQb: Boolean(patch.subscriptionAutoLaunchQb ?? current.subscriptionAutoLaunchQb),
    googleDriveEnabled: Boolean(patch.googleDriveEnabled ?? current.googleDriveEnabled),
    googleDriveDir:
      typeof patch.googleDriveDir === 'string'
        ? patch.googleDriveDir.trim()
        : current.googleDriveDir,
    googleDriveAutoDeleteLocal: Boolean(
      patch.googleDriveAutoDeleteLocal ?? current.googleDriveAutoDeleteLocal,
    ),
    googleDriveIncludeInLibrary: Boolean(
      patch.googleDriveIncludeInLibrary ?? current.googleDriveIncludeInLibrary,
    ),
  };

  const settingsPath = getSettingsFilePath();
  cachedSettings = next;
  writeJsonAtomic(settingsPath, next);
  cachedSettingsSig = getFileSignature(settingsPath);
  return { ...next, extraLibraryDirs: [...next.extraLibraryDirs] };
}

function emptyMetadata(): MetadataStore {
  return {
    downloadsMap: {},
    watchedMap: {},
    seriesMetaMap: {},
    hiddenSeriesIds: [],
    hiddenFilePaths: [],
    subscriptions: [],
    subscriptionLogs: [],
    cloudTransferJobs: [],
  };
}

export function getMetadata(): MetadataStore {
  const filePath = getMetadataFilePath();
  const currentSig = getFileSignature(filePath);
  if (cachedMetadata && (currentSig === cachedMetadataSig || (currentSig === null && cachedMetadataSig === null))) {
    return cachedMetadata;
  }

  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<MetadataStore>;
      cachedMetadata = {
        downloadsMap:
          parsed.downloadsMap && typeof parsed.downloadsMap === 'object' ? parsed.downloadsMap : {},
        watchedMap:
          parsed.watchedMap && typeof parsed.watchedMap === 'object' ? parsed.watchedMap : {},
        seriesMetaMap:
          parsed.seriesMetaMap && typeof parsed.seriesMetaMap === 'object' ? parsed.seriesMetaMap : {},
        hiddenSeriesIds: Array.isArray(parsed.hiddenSeriesIds)
          ? parsed.hiddenSeriesIds.filter((x): x is string => typeof x === 'string')
          : [],
        hiddenFilePaths: Array.isArray(parsed.hiddenFilePaths)
          ? parsed.hiddenFilePaths.filter((x): x is string => typeof x === 'string')
          : [],
        subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
        subscriptionLogs: Array.isArray(parsed.subscriptionLogs) ? parsed.subscriptionLogs : [],
        cloudTransferJobs: Array.isArray(parsed.cloudTransferJobs) ? parsed.cloudTransferJobs : [],
      };
      cachedMetadataSig = getFileSignature(filePath);
      return cachedMetadata;
    } catch {
      // Recover with empty store
    }
  }

  cachedMetadata = emptyMetadata();
  cachedMetadataSig = currentSig;
  return cachedMetadata;
}

function saveMetadata(store: MetadataStore): void {
  const filePath = getMetadataFilePath();
  cachedMetadata = store;
  writeJsonAtomic(filePath, store);
  cachedMetadataSig = getFileSignature(filePath);
}

export function recordDownloadMeta(entry: Omit<DownloadMetaRecord, 'addedAt'>): void {
  const store = getMetadata();
  const now = Date.now();
  const record: DownloadMetaRecord = {
    ...entry,
    addedAt: now,
  };

  if (entry.hash) {
    store.downloadsMap[`hash:${entry.hash.toLowerCase()}`] = record;
  }
  const titleKey = `title:${entry.title.trim().toLowerCase()}`;
  store.downloadsMap[titleKey] = record;

  const dlKeys = Object.keys(store.downloadsMap);
  if (dlKeys.length > MAX_DOWNLOADS_META_ENTRIES) {
    const sorted = Object.entries(store.downloadsMap)
      .sort((a, b) => (b[1].addedAt || 0) - (a[1].addedAt || 0))
      .slice(0, MAX_DOWNLOADS_META_ENTRIES);
    store.downloadsMap = Object.fromEntries(sorted);
  }

  if (entry.savePath && (entry.bangumiTitle || entry.coverUrl || entry.bangumiId)) {
    const folderKey = normalizePathKey(entry.savePath);
    const existing = store.seriesMetaMap[folderKey];
    store.seriesMetaMap[folderKey] = {
      folderPath: path.resolve(entry.savePath),
      title: entry.bangumiTitle || existing?.title || path.basename(entry.savePath),
      bangumiId: entry.bangumiId || existing?.bangumiId,
      coverUrl: entry.coverUrl || existing?.coverUrl,
      updatedAt: now,
    };
  }

  saveMetadata(store);
}

export function findDownloadMetaForTorrent(
  hash: string,
  name: string,
  savePath: string,
): { bangumiId?: string; bangumiTitle?: string; coverUrl?: string } | null {
  const store = getMetadata();

  const byHash = store.downloadsMap[`hash:${hash.toLowerCase()}`];
  if (byHash) {
    return {
      bangumiId: byHash.bangumiId,
      bangumiTitle: byHash.bangumiTitle,
      coverUrl: byHash.coverUrl,
    };
  }

  const normalizedName = name.trim().toLowerCase();
  const byTitle = store.downloadsMap[`title:${normalizedName}`];
  if (byTitle) {
    return {
      bangumiId: byTitle.bangumiId,
      bangumiTitle: byTitle.bangumiTitle,
      coverUrl: byTitle.coverUrl,
    };
  }

  if (savePath) {
    const folderKey = normalizePathKey(savePath);
    const byFolder = store.seriesMetaMap[folderKey];
    if (byFolder) {
      return {
        bangumiId: byFolder.bangumiId,
        bangumiTitle: byFolder.title,
        coverUrl: byFolder.coverUrl,
      };
    }
  }

  return null;
}

export function getSeriesMeta(folderPath: string): SeriesMetaRecord | undefined {
  const store = getMetadata();
  return store.seriesMetaMap[normalizePathKey(folderPath)];
}

export function findSeriesMetaByTitle(title: string): SeriesMetaRecord | undefined {
  const target = title.trim().toLowerCase();
  if (!target) return undefined;
  const store = getMetadata();
  for (const record of Object.values(store.seriesMetaMap)) {
    if (record.title.trim().toLowerCase() === target) {
      return record;
    }
  }
  return undefined;
}

export function getWatchedRecord(filePath: string): WatchedRecord | undefined {
  const store = getMetadata();
  return store.watchedMap[normalizePathKey(filePath)];
}

export function setWatchedRecord(
  filePath: string,
  watched: boolean,
  lastPlayedAt?: number,
): WatchedRecord {
  const store = getMetadata();
  const key = normalizePathKey(filePath);
  const existing = store.watchedMap[key];
  const record: WatchedRecord = {
    watched,
    lastPlayedAt: lastPlayedAt ?? existing?.lastPlayedAt,
    updatedAt: Date.now(),
  };
  store.watchedMap[key] = record;
  saveMetadata(store);
  return record;
}

export function getSeriesMetaById(seriesId: string): SeriesMetaRecord | undefined {
  const store = getMetadata();
  return store.seriesMetaMap[`series:${seriesId}`];
}

export function setSeriesMeta(
  seriesId: string,
  record: SeriesMetaRecord,
  alsoIndexFolderPath = false,
): void {
  const store = getMetadata();
  const normalizedRecord: SeriesMetaRecord = {
    ...record,
    seriesId,
  };
  store.seriesMetaMap[`series:${seriesId}`] = normalizedRecord;
  if (alsoIndexFolderPath && record.folderPath) {
    store.seriesMetaMap[normalizePathKey(record.folderPath)] = normalizedRecord;
  }
  saveMetadata(store);
}

export function deleteSeriesMeta(seriesId: string, folderPath?: string): void {
  const store = getMetadata();
  delete store.seriesMetaMap[`series:${seriesId}`];
  if (folderPath) {
    const folderKey = normalizePathKey(folderPath);
    const existing = store.seriesMetaMap[folderKey];
    if (!existing?.seriesId || existing.seriesId === seriesId) {
      delete store.seriesMetaMap[folderKey];
    }
  }
  saveMetadata(store);
}

export function hideSeries(seriesId: string, filePaths: string[] = []): void {
  const store = getMetadata();
  if (!store.hiddenSeriesIds.includes(seriesId)) {
    store.hiddenSeriesIds.push(seriesId);
  }
  for (const fp of filePaths) {
    const key = normalizePathKey(fp);
    if (!store.hiddenFilePaths.includes(key)) {
      store.hiddenFilePaths.push(key);
    }
  }
  saveMetadata(store);
}

export function hideFilePath(filePath: string): void {
  const store = getMetadata();
  const key = normalizePathKey(filePath);
  if (!store.hiddenFilePaths.includes(key)) {
    store.hiddenFilePaths.push(key);
  }
  saveMetadata(store);
}

export function isSeriesHidden(seriesId: string): boolean {
  const store = getMetadata();
  return store.hiddenSeriesIds.includes(seriesId);
}

export function isFileHidden(filePath: string): boolean {
  const store = getMetadata();
  return store.hiddenFilePaths.includes(normalizePathKey(filePath));
}

export function getHiddenCount(): number {
  const store = getMetadata();
  return store.hiddenSeriesIds.length + store.hiddenFilePaths.length;
}

export function restoreAllHidden(): void {
  const store = getMetadata();
  store.hiddenSeriesIds = [];
  store.hiddenFilePaths = [];
  saveMetadata(store);
}

export function getLibraryMetadataSnapshot(): {
  hiddenSeriesSet: Set<string>;
  hiddenFileSet: Set<string>;
  watchedMap: Record<string, WatchedRecord>;
  seriesMetaMap: Record<string, SeriesMetaRecord>;
  titleMetaMap: Map<string, SeriesMetaRecord>;
} {
  const store = getMetadata();
  const titleMetaMap = new Map<string, SeriesMetaRecord>();
  for (const record of Object.values(store.seriesMetaMap)) {
    const key = record.title.trim().toLowerCase();
    if (key && !titleMetaMap.has(key)) {
      titleMetaMap.set(key, record);
    }
  }
  return {
    hiddenSeriesSet: new Set(store.hiddenSeriesIds),
    hiddenFileSet: new Set(store.hiddenFilePaths),
    watchedMap: store.watchedMap,
    seriesMetaMap: store.seriesMetaMap,
    titleMetaMap,
  };
}

export function getSubscriptions(): SubscriptionItem[] {
  const store = getMetadata();
  return store.subscriptions.map((s) => ({
    ...s,
    downloadedReleaseIds: Array.isArray(s.downloadedReleaseIds) ? [...s.downloadedReleaseIds] : [],
  }));
}

export function saveSubscriptions(items: SubscriptionItem[]): void {
  const store = getMetadata();
  store.subscriptions = items;
  saveMetadata(store);
}

export function getSubscriptionLogs(): SubscriptionLogEntry[] {
  const store = getMetadata();
  return [...store.subscriptionLogs];
}

export function appendSubscriptionLog(entry: SubscriptionLogEntry): void {
  const store = getMetadata();
  store.subscriptionLogs = [entry, ...store.subscriptionLogs].slice(0, 80);
  saveMetadata(store);
}

export function getCloudTransferJobs(): CloudTransferJob[] {
  const store = getMetadata();
  return store.cloudTransferJobs.map((job) => ({ ...job }));
}

export function saveCloudTransferJobs(jobs: CloudTransferJob[]): void {
  const store = getMetadata();
  store.cloudTransferJobs = jobs.slice(0, 120);
  saveMetadata(store);
}

export function upsertCloudTransferJob(job: CloudTransferJob): void {
  const jobs = getCloudTransferJobs();
  const idx = jobs.findIndex((item) => item.id === job.id);
  if (idx >= 0) {
    jobs[idx] = { ...job };
  } else {
    jobs.unshift({ ...job });
  }
  saveCloudTransferJobs(jobs);
}

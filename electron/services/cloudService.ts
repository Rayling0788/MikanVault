import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  ActionResult,
  CloudDriveStatus,
  CloudTransferJob,
  CloudUploadLibraryRequest,
  CloudUploadLibraryResult,
  QbControlAction,
  QbTorrentItem,
} from '../../src/shared/types';
import {
  detectGoogleDriveMount,
  getCloudTransferJobs,
  getSeriesMeta,
  getSeriesMetaById,
  getSettings,
  getWatchedRecord,
  invalidateGoogleDriveMountCache,
  normalizePathKey,
  recordDownloadMeta,
  updateCloudTransferJobs,
  setSeriesMeta,
  setWatchedRecord,
  upsertCloudTransferJob,
} from './configStore';
import { controlTorrent, getTorrents, normalizeTorrentHash, sanitizeFolderName } from './qbService';

export interface CloudQueueDeps {
  getTorrentsFn?: () => Promise<QbTorrentItem[]>;
  controlTorrentFn?: (hash: string, action: QbControlAction) => Promise<ActionResult>;
}

let cloudWatcherTimer: ReturnType<typeof setInterval> | null = null;
let isProcessingQueue = false;
const liveJobProgress = new Map<string, Partial<CloudTransferJob>>();
const activeRunningJobIds = new Set<string>();
let cachedCloudStatus: { key: string; value: CloudDriveStatus; expiresAt: number } | null = null;
const completedTorrentStates = new Set([
  'uploading', 'stalledUP', 'queuedUP', 'pausedUP', 'stoppedUP', 'forcedUP',
]);
const CLOUD_STATUS_CACHE_TTL_MS = 10_000;

export function invalidateCloudStatusCache(): void {
  cachedCloudStatus = null;
  invalidateGoogleDriveMountCache();
}

class JobCancelledError extends Error {
  constructor() {
    super('已手动取消上传');
    this.name = 'JobCancelledError';
  }
}

function isPathOrParentAccessible(targetPath: string): boolean {
  const trimmed = targetPath.trim();
  if (!trimmed) return false;
  try {
    if (fs.existsSync(trimmed)) return true;
    const parent = path.dirname(trimmed);
    if (parent && parent !== trimmed && fs.existsSync(parent)) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function getExistingProbePath(targetPath: string): string | null {
  let cursor = path.resolve(targetPath);
  for (let i = 0; i < 6; i++) {
    try {
      if (fs.existsSync(cursor)) return cursor;
    } catch {
      return null;
    }
    const parent = path.dirname(cursor);
    if (!parent || parent === cursor) break;
    cursor = parent;
  }
  return null;
}

export function getCloudDriveStatus(forceRefresh = false): CloudDriveStatus {
  const settings = getSettings();
  const configuredOverride = settings.googleDriveDir?.trim() || '';
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedCloudStatus &&
    cachedCloudStatus.key === configuredOverride &&
    cachedCloudStatus.expiresAt > now
  ) {
    return { ...cachedCloudStatus.value };
  }

  const mount = detectGoogleDriveMount(forceRefresh);
  const configuredDir = configuredOverride || mount.defaultTargetDir || '';
  const configuredAccessible = configuredDir ? isPathOrParentAccessible(configuredDir) : false;

  let freeBytes: number | undefined;
  let totalBytes: number | undefined;
  const probeTarget = configuredDir || mount.mountRoot;
  if (probeTarget) {
    const existing = getExistingProbePath(probeTarget);
    if (existing && typeof fs.statfsSync === 'function') {
      try {
        const stats = fs.statfsSync(existing);
        freeBytes = Number(stats.bsize) * Number(stats.bavail);
        totalBytes = Number(stats.bsize) * Number(stats.blocks);
      } catch {
        // Ignore statfs error on virtual mounts
      }
    }
  }

  const result: CloudDriveStatus = {
    detected: Boolean(mount.mountRoot),
    mountRoot: mount.mountRoot,
    defaultTargetDir: mount.defaultTargetDir,
    configuredDir,
    configuredAccessible,
    freeBytes,
    totalBytes,
  };
  cachedCloudStatus = {
    key: configuredOverride,
    value: result,
    expiresAt: now + CLOUD_STATUS_CACHE_TTL_MS,
  };
  return { ...result };
}

export function resolveCloudSeriesTargetDir(
  cloudRootDir: string,
  bangumiTitle?: string,
  fallbackTitle?: string,
): string {
  const cleanRoot = cloudRootDir.trim();
  const folderName = sanitizeFolderName(bangumiTitle || fallbackTitle || 'Anime');
  return path.join(cleanRoot, folderName);
}

export interface EnqueueCloudJobInput {
  torrentHash?: string;
  torrentName: string;
  bangumiId?: string;
  bangumiTitle?: string;
  coverUrl?: string;
  subgroup?: string;
  localSavePath: string;
  cloudTargetDir: string;
  deleteLocalAfterMove?: boolean;
}

export function enqueueCloudTransferJob(input: EnqueueCloudJobInput): CloudTransferJob {
  return updateCloudTransferJobs((jobs) => {
    const now = Date.now();
    const torrentHash = input.torrentHash && normalizeTorrentHash(input.torrentHash);
    const existing = torrentHash && jobs.find((job) =>
      job.torrentHash && normalizeTorrentHash(job.torrentHash) === torrentHash &&
      (job.status === 'queued' || job.status === 'copying'),
    );
    if (existing) {
      if (existing.status === 'copying') return { result: existing, changed: false };
      existing.cloudTargetDir = input.cloudTargetDir;
      existing.deleteLocalAfterMove = input.deleteLocalAfterMove ?? existing.deleteLocalAfterMove;
      existing.updatedAt = now;
      return { result: existing };
    }

    const job: CloudTransferJob = {
      ...input,
      id: crypto.randomUUID(),
      source: 'download',
      torrentHash,
      deleteLocalAfterMove: input.deleteLocalAfterMove ?? true,
      status: 'queued',
      progress: 0,
      transferredBytes: 0,
      createdAt: now,
      updatedAt: now,
    };
    jobs.unshift(job);
    return { result: job };
  });
}

function hasLiveWorker(job: CloudTransferJob): boolean {
  const pid = job.workerPid;
  if (!pid || pid === process.pid) return activeRunningJobIds.has(job.id);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export function recoverStaleCloudJobs(minStaleAgeMs = 0): number {
  return updateCloudTransferJobs((jobs) => {
    const now = Date.now();
    let recovered = 0;
    for (const job of jobs) {
      if (job.status !== 'copying' || hasLiveWorker(job) ||
          now - (job.updatedAt || job.createdAt || 0) < minStaleAgeMs) continue;
      recovered += 1;
      liveJobProgress.delete(job.id);
      const cancelled = job.cancelling;
      Object.assign(job, {
        status: cancelled ? 'cancelled' : 'failed',
        workerPid: undefined,
        finalizing: undefined,
        cancelling: false,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        currentFileName: undefined,
        error: cancelled
          ? '已取消上传（已保留本地文件）'
          : '上次应用关闭导致传输中断，请点击「重新上传」继续（内容相同的文件会自动跳过）',
        updatedAt: now,
      });
    }
    return { result: recovered, changed: recovered > 0 };
  });
}

export function listCloudJobs(): CloudTransferJob[] {
  const jobs = getCloudTransferJobs();
  // Recover any stale copying jobs only when an inactive copying record exists
  if (jobs.some((j) => j.status === 'copying' && !hasLiveWorker(j))) {
    recoverStaleCloudJobs(90_000);
  }
  return getCloudTransferJobs()
    .map((job) => {
      if (job.status === 'copying') {
        const live = liveJobProgress.get(job.id);
        if (live) {
          return { ...job, ...live, cancelling: job.cancelling };
        }
      }
      return job;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function clearFinishedCloudJobs(): ActionResult {
  return updateCloudTransferJobs((jobs) => {
    for (let index = jobs.length - 1; index >= 0; index -= 1) {
      if (jobs[index].status !== 'queued' && jobs[index].status !== 'copying') {
        jobs.splice(index, 1);
      }
    }
    return { result: { ok: true } };
  });
}

export function removeCloudJob(jobId: string): ActionResult {
  return updateCloudTransferJobs<ActionResult>((jobs) => {
    const index = jobs.findIndex((job) => job.id === jobId);
    if (index < 0) {
      return { result: { ok: false, error: '找不到该云盘上传任务' }, changed: false };
    }
    if (jobs[index].status === 'copying' && hasLiveWorker(jobs[index])) {
      return { result: { ok: false, error: '正在复制传输的任务不能移除，请先取消上传' }, changed: false };
    }
    jobs.splice(index, 1);
    liveJobProgress.delete(jobId);
    return { result: { ok: true } };
  });
}

export function cancelCloudJob(jobId: string): ActionResult {
  return updateCloudTransferJobs<ActionResult>((jobs) => {
    const target = jobs.find((job) => job.id === jobId);
    if (!target || (target.status !== 'queued' && target.status !== 'copying')) {
      return { result: { ok: false, error: '找不到可取消的云盘上传任务' }, changed: false };
    }
    if (target.status === 'copying' && hasLiveWorker(target)) {
      if (target.finalizing) {
        return { result: { ok: false, error: '上传已完成，正在收尾' }, changed: false };
      }
      target.cancelling = true;
    } else {
      Object.assign(target, {
        status: 'cancelled',
        workerPid: undefined,
        finalizing: undefined,
        cancelling: false,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        currentFileName: undefined,
        error: '已取消上传（已保留本地文件）',
      });
    }
    target.updatedAt = Date.now();
    return { result: { ok: true } };
  });
}

function isJobCancelled(jobId: string): boolean {
  return getCloudTransferJobs().some((job) => job.id === jobId && job.cancelling);
}

function startFinalizing(jobId: string): void {
  const confirmed = updateCloudTransferJobs((jobs) => {
    const job = jobs.find((item) => item.id === jobId);
    if (job?.status !== 'copying' || job.workerPid !== process.pid || job.cancelling) {
      return { result: false, changed: false };
    }
    job.finalizing = true;
    job.updatedAt = Date.now();
    return { result: true };
  });
  if (!confirmed) throw new JobCancelledError();
}

function saveJobProgress(jobId: string, progress: Partial<CloudTransferJob>): void {
  updateCloudTransferJobs((jobs) => {
    const job = jobs.find((item) => item.id === jobId);
    if (job?.status !== 'copying' || job.workerPid !== process.pid) {
      return { result: undefined, changed: false };
    }
    Object.assign(job, progress, { updatedAt: Date.now() });
    return { result: undefined };
  });
}

function pathsOverlap(first: string, second: string): boolean {
  const a = normalizePathKey(first);
  const b = normalizePathKey(second);
  const aPrefix = a.endsWith(path.sep) ? a : a + path.sep;
  const bPrefix = b.endsWith(path.sep) ? b : b + path.sep;
  return a === b || a.startsWith(bPrefix) || b.startsWith(aPrefix);
}

function hasTransferConflict(jobs: CloudTransferJob[], candidate: CloudTransferJob): boolean {
  return jobs.some((job) => {
    if (job.status !== 'copying' || !hasLiveWorker(job)) return false;
    if (pathsOverlap(job.cloudTargetDir, candidate.cloudTargetDir)) return true;
    return (job.sourceFilePaths ?? []).some((file) =>
      (candidate.sourceFilePaths ?? []).some((other) => pathsOverlap(file, other)),
    );
  });
}

async function computePathStats(
  targetPath: string,
): Promise<{ totalBytes: number; totalFiles: number }> {
  const stat = await fsp.lstat(targetPath);
  if (stat.isFile()) {
    return { totalBytes: stat.size, totalFiles: 1 };
  }
  if (!stat.isDirectory()) throw new Error('不支持的源文件类型: ' + targetPath);
  const entries = await fsp.readdir(targetPath, { withFileTypes: true });
  let totalBytes = 0;
  let totalFiles = 0;
  for (const entry of entries) {
    const res = await computePathStats(path.join(targetPath, entry.name));
    totalBytes += res.totalBytes;
    totalFiles += res.totalFiles;
  }
  return { totalBytes, totalFiles };
}

function createJobProgressReporter(
  jobId: string,
  totalBytes: number,
  onCheckpoint?: (snapshot: {
    copiedFiles: number;
    transferredBytes: number;
    progress: number;
    currentFileName?: string;
  }) => void,
) {
  const startedAt = Date.now();
  let transferredBytes = 0;
  let copiedFiles = 0;

  const publish = (inFlightBytes: number, currentFileName?: string) => {
    const now = Date.now();
    const effectiveBytes = Math.min(totalBytes, transferredBytes + Math.max(0, inFlightBytes));
    const elapsedSec = Math.max(0.25, (now - startedAt) / 1000);
    const speedBytesPerSec = effectiveBytes > 0 ? Math.round(effectiveBytes / elapsedSec) : 0;
    const remaining = Math.max(0, totalBytes - effectiveBytes);
    const etaSeconds =
      speedBytesPerSec > 0 ? Math.max(0, Math.round(remaining / speedBytesPerSec)) : 0;
    const progress = totalBytes > 0 ? Math.min(0.999, effectiveBytes / totalBytes) : 0;

    liveJobProgress.set(jobId, {
      ...(liveJobProgress.get(jobId) || {}),
      progress,
      transferredBytes: effectiveBytes,
      speedBytesPerSec,
      etaSeconds,
      copiedFiles,
      currentFileName,
      updatedAt: now,
    });
    return progress;
  };

  return {
    isCancelled: () => isJobCancelled(jobId),
    onFileStart: (fileName: string) => {
      publish(0, fileName);
    },
    onFileProgress: (inFlightBytes: number, fileName: string) => {
      publish(inFlightBytes, fileName);
    },
    onFileVerified: (fileBytes: number, fileName: string) => {
      transferredBytes += fileBytes;
      copiedFiles += 1;
      const progress = publish(0, fileName);
      onCheckpoint?.({
        copiedFiles,
        transferredBytes,
        progress,
        currentFileName: fileName,
      });
    },
  };
}

export interface CopyProgressCallbacks {
  isCancelled?: () => boolean;
  onFileStart?: (fileName: string) => void;
  onFileProgress?: (inFlightBytes: number, fileName: string) => void;
  onFileVerified?: (fileBytes: number, fileName: string) => void;
  copiedDestPaths?: string[];
  verifiedFiles?: VerifiedFile[];
}

interface VerifiedFile {
  source: string;
  destination: string;
  sourceStat: fs.Stats;
  destinationStat: fs.Stats;
}

function sameFileVersion(first: fs.Stats, second: fs.Stats): boolean {
  return second.isFile() && first.dev === second.dev && first.ino === second.ino &&
    first.size === second.size && first.mtimeMs === second.mtimeMs && first.ctimeMs === second.ctimeMs;
}

async function checkVerifiedFiles(files: VerifiedFile[]): Promise<void> {
  for (const file of files) {
    const [source, destination] = await Promise.all([
      fsp.lstat(file.source), fsp.lstat(file.destination),
    ]);
    if (!sameFileVersion(file.sourceStat, source) ||
        !sameFileVersion(file.destinationStat, destination)) {
      throw new Error('文件在校验后发生变化: ' + file.source);
    }
  }
}

async function removeVerifiedSources(files: VerifiedFile[]): Promise<void> {
  await checkVerifiedFiles(files);
  for (const file of files) {
    await fsp.unlink(file.source);
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function statIfPresent(filePath: string): Promise<fs.Stats | undefined> {
  try {
    return await fsp.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

export async function copyPathCrossDrive(
  srcPath: string,
  destPath: string,
  callbacks?: CopyProgressCallbacks,
): Promise<{ copiedFiles: number; totalBytes: number }> {
  if (callbacks?.isCancelled?.()) throw new JobCancelledError();

  const srcStat = await fsp.lstat(srcPath);
  const destStat = await statIfPresent(destPath);
  if (srcStat.isDirectory()) {
    if (destStat && !destStat.isDirectory()) throw new Error('云盘存在同名文件: ' + destPath);
    await fsp.mkdir(destPath, { recursive: true });
    let copiedFiles = 0;
    let totalBytes = 0;
    for (const name of await fsp.readdir(srcPath)) {
      const result = await copyPathCrossDrive(
        path.join(srcPath, name), path.join(destPath, name), callbacks,
      );
      copiedFiles += result.copiedFiles;
      totalBytes += result.totalBytes;
    }
    return { copiedFiles, totalBytes };
  }
  if (!srcStat.isFile()) throw new Error('不支持的源文件类型: ' + srcPath);

  const fileName = path.basename(destPath);
  callbacks?.onFileStart?.(fileName);
  let created = false;
  try {
    if (!destStat) {
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      let statInFlight = false;
      let copying = true;
      const pollTimer = setInterval(() => {
        if (statInFlight) return;
        statInFlight = true;
        void fsp.stat(destPath).then((stat) => {
          if (copying) callbacks?.onFileProgress?.(Math.min(srcStat.size, stat.size), fileName);
        }).catch(() => {}).finally(() => {
          statInFlight = false;
        });
      }, 450);
      try {
        // Exclusive creation preserves an existing file even if it appears after the initial stat.
        await fsp.copyFile(srcPath, destPath, fs.constants.COPYFILE_EXCL);
        created = true;
      } finally {
        copying = false;
        clearInterval(pollTimer);
      }
    }

    const copiedStat = await fsp.lstat(destPath);
    if (!copiedStat.isFile() || copiedStat.size !== srcStat.size) {
      throw new Error('云盘文件冲突或校验失败: ' + fileName);
    }
    const [sourceHash, destHash] = await Promise.all([hashFile(srcPath), hashFile(destPath)]);
    const [sourceAfter, destAfter] = await Promise.all([fsp.lstat(srcPath), fsp.lstat(destPath)]);
    if (sourceHash !== destHash || !sameFileVersion(srcStat, sourceAfter) ||
        !sameFileVersion(copiedStat, destAfter)) {
      throw new Error('云盘文件冲突或校验失败: ' + fileName);
    }
    if (callbacks?.isCancelled?.()) throw new JobCancelledError();
    if (created) callbacks?.copiedDestPaths?.push(destPath);
    callbacks?.verifiedFiles?.push({
      source: srcPath, destination: destPath, sourceStat: sourceAfter, destinationStat: destAfter,
    });
    callbacks?.onFileVerified?.(srcStat.size, fileName);
    return { copiedFiles: 1, totalBytes: srcStat.size };
  } catch (error) {
    if (created) await fsp.rm(destPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function cleanupCancelledCloudDest(copiedDestPaths: string[]): Promise<void> {
  for (const destFile of copiedDestPaths) {
    await fsp.rm(destFile, { force: true }).catch(() => {});
  }
}

function findMatchingTorrent(
  job: CloudTransferJob,
  torrents: QbTorrentItem[],
): QbTorrentItem | undefined {
  if (job.torrentHash) {
    const hash = normalizeTorrentHash(job.torrentHash);
    return torrents.find((torrent) => normalizeTorrentHash(torrent.hash) === hash);
  }

  const savePath = normalizePathKey(job.localSavePath);
  const matches = torrents.filter((torrent) =>
    normalizePathKey(torrent.savePath) === savePath && torrent.name === job.torrentName,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

function canOffload(torrent: QbTorrentItem): boolean {
  return torrent.progress === 1 && (torrent.amountLeft ?? 0) === 0 &&
    completedTorrentStates.has(torrent.state);
}

function resolveTorrentSourcePath(torrent: QbTorrentItem, fallbackSavePath: string): string {
  if (torrent.contentPath && fs.existsSync(torrent.contentPath)) {
    return torrent.contentPath;
  }
  const candidate = path.join(torrent.savePath || fallbackSavePath, torrent.name);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  throw new Error(`找不到本地已完成文件: ${torrent.contentPath || candidate}`);
}

async function removeEmptySourceDirs(root: string, files: VerifiedFile[]): Promise<void> {
  const directories = new Set<string>();
  for (const file of files) {
    let directory = path.dirname(file.source);
    while (directory === root || directory.startsWith(root + path.sep)) {
      directories.add(directory);
      if (directory === root) break;
      directory = path.dirname(directory);
    }
  }
  for (const directory of [...directories].sort((a, b) => b.length - a.length)) {
    try {
      await fsp.rmdir(directory);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code || '')) {
        throw error;
      }
    }
  }
}

async function cleanupEmptyStagingDir(localSavePath: string): Promise<void> {
  const settings = getSettings();
  if (normalizePathKey(localSavePath) === normalizePathKey(settings.downloadRootDir)) {
    return;
  }
  try {
    const remaining = await fsp.readdir(localSavePath);
    if (remaining.length === 0) {
      await fsp.rmdir(localSavePath);
    }
  } catch {
    // Non-fatal if staging folder cannot be removed
  }
}

export async function processCloudTransferQueue(
  deps: CloudQueueDeps = {},
  retryFailed = false,
): Promise<{ processed: number; moved: number; failed: number }> {
  if (isProcessingQueue) {
    return { processed: 0, moved: 0, failed: 0 };
  }

  isProcessingQueue = true;
  let processed = 0;
  let moved = 0;
  let failed = 0;

  try {
    const candidates = getCloudTransferJobs().filter(
      (job) => job.source !== 'library' &&
        (job.status === 'queued' || (retryFailed && job.status === 'failed')),
    );
    if (candidates.length === 0) {
      return { processed: 0, moved: 0, failed: 0 };
    }

    const getTorrentsFn = deps.getTorrentsFn ?? getTorrents;
    const controlTorrentFn = deps.controlTorrentFn ?? controlTorrent;
    const torrents = await getTorrentsFn();

    for (const candidate of candidates) {
      const knownTorrent = findMatchingTorrent(candidate, torrents);
      if (!knownTorrent || !canOffload(knownTorrent)) continue;
      const claimed = updateCloudTransferJobs((jobs) => {
        const current = jobs.find((item) => item.id === candidate.id);
        if (!current || current.source === 'library' ||
            (current.status !== 'queued' && !(retryFailed && current.status === 'failed'))) {
          return { result: undefined, changed: false };
        }
        const torrent = findMatchingTorrent(current, torrents);
        if (!torrent || !canOffload(torrent)) return { result: undefined, changed: false };
        const sourceFilePaths = [
          torrent.contentPath || path.join(torrent.savePath || current.localSavePath, torrent.name),
        ];
        if (hasTransferConflict(jobs, { ...current, sourceFilePaths })) {
          return { result: undefined, changed: false };
        }
        Object.assign(current, {
          sourceFilePaths,
          status: 'copying',
          torrentHash: torrent.hash,
          workerPid: process.pid,
          cancelling: false,
          error: undefined,
          finalizing: undefined,
          updatedAt: Date.now(),
        });
        return { result: { job: current, torrent } };
      });
      if (!claimed) continue;
      const { job, torrent } = claimed;

      processed += 1;
      activeRunningJobIds.add(job.id);
      const copiedDestPaths: string[] = [];
      try {
        if (!isPathOrParentAccessible(job.cloudTargetDir)) {
          throw new Error('谷歌云盘目录不可用，请确认 Google Drive Desktop 已运行且挂载盘存在');
        }

        const srcPath = resolveTorrentSourcePath(torrent, job.localSavePath);
        const destPath = path.join(job.cloudTargetDir, path.basename(srcPath));
        const [realSource, realTargetRoot] = await Promise.all([
          fsp.realpath(srcPath),
          fsp.mkdir(job.cloudTargetDir, { recursive: true }).then(() => fsp.realpath(job.cloudTargetDir)),
        ]);
        if (pathsOverlap(realSource, path.join(realTargetRoot, path.basename(srcPath)))) {
          throw new Error('本地文件与云盘目标路径重叠');
        }
        const stats = await computePathStats(srcPath);
        if (!stats.totalFiles) throw new Error('源目录中没有可转存的文件');
        const verifiedFiles: VerifiedFile[] = [];
        saveJobProgress(job.id, { ...stats, transferredBytes: 0, progress: 0 });

        const reporter = createJobProgressReporter(job.id, stats.totalBytes, (snap) => {
          saveJobProgress(job.id, snap);
        });
        const { copiedFiles, totalBytes } = await copyPathCrossDrive(srcPath, destPath, {
          ...reporter,
          copiedDestPaths,
          verifiedFiles,
        });
        let warningNote: string | undefined;
        if (job.deleteLocalAfterMove) {
          await checkVerifiedFiles(verifiedFiles);
          if (normalizePathKey(srcPath) === normalizePathKey(torrent.savePath || job.localSavePath)) {
            warningNote = '已复制到云盘，已保留共享下载目录与 qB 任务';
          } else {
            const latest = (await getTorrentsFn()).find((item) => item.hash === torrent.hash);
            if (!latest || !canOffload(latest) ||
                normalizePathKey(resolveTorrentSourcePath(latest, job.localSavePath)) !== normalizePathKey(srcPath)) {
              warningNote = '已复制到云盘，但 qB 任务状态或路径已变化，已保留本地文件';
            }
          }
        }

        startFinalizing(job.id);

        // Preserve Mikan metadata on the destination cloud folder before cleanup
        recordDownloadMeta({
          title: job.torrentName,
          bangumiId: job.bangumiId,
          bangumiTitle: job.bangumiTitle,
          coverUrl: job.coverUrl,
          subgroup: job.subgroup,
          savePath: job.cloudTargetDir,
        });

        if (job.bangumiId && job.bangumiTitle) {
          setSeriesMeta(
            job.bangumiId,
            {
              seriesId: job.bangumiId,
              folderPath: job.cloudTargetDir,
              title: job.bangumiTitle,
              bangumiId: job.bangumiId,
              coverUrl: job.coverUrl,
              updatedAt: Date.now(),
            },
            true,
          );
        }

        if (job.deleteLocalAfterMove && !warningNote) {
          const ctrlRes = await controlTorrentFn(torrent.hash, 'delete');
          if (!ctrlRes.ok) {
            warningNote = `已复制到云盘，但移除 qB 任务失败: ${ctrlRes.error || '未知错误'}`;
          } else {
            try {
              await removeVerifiedSources(verifiedFiles);
              await removeEmptySourceDirs(path.resolve(srcPath), verifiedFiles);
              await cleanupEmptyStagingDir(job.localSavePath);
            } catch (rmErr) {
              warningNote = `已复制到云盘并移除任务，但清理本地文件失败: ${
                rmErr instanceof Error ? rmErr.message : String(rmErr)
              }`;
            }
          }
        }

        liveJobProgress.delete(job.id);
        const now = Date.now();
        upsertCloudTransferJob({
          ...job,
          source: 'download',
          torrentHash: torrent.hash,
          status: 'completed',
          workerPid: undefined,
          finalizing: undefined,
          cancelling: false,
          progress: 1,
          transferredBytes: totalBytes,
          speedBytesPerSec: 0,
          etaSeconds: 0,
          copiedFiles,
          totalFiles: stats.totalFiles,
          totalBytes,
          currentFileName: undefined,
          error: warningNote,
          updatedAt: now,
          completedAt: now,
        });
        moved += 1;
      } catch (err) {
        liveJobProgress.delete(job.id);
        if (err instanceof JobCancelledError) {
          await cleanupCancelledCloudDest(copiedDestPaths);
          upsertCloudTransferJob({
            ...job,
            status: 'cancelled',
            workerPid: undefined,
            finalizing: undefined,
            cancelling: false,
            speedBytesPerSec: 0,
            etaSeconds: 0,
            currentFileName: undefined,
            error: '已手动取消上传（已保留本地文件）',
            updatedAt: Date.now(),
          });
        } else {
          failed += 1;
          upsertCloudTransferJob({
            ...job,
            status: 'failed',
            workerPid: undefined,
            finalizing: undefined,
            cancelling: false,
            speedBytesPerSec: 0,
            etaSeconds: 0,
            error: err instanceof Error ? err.message : String(err),
            updatedAt: Date.now(),
          });
        }
      } finally {
        activeRunningJobIds.delete(job.id);
        invalidateCloudStatusCache();
      }
    }

    return { processed, moved, failed };
  } finally {
    isProcessingQueue = false;
  }
}

export function startCloudTransferWatcher(intervalMs = 20_000): void {
  stopCloudTransferWatcher();
  try {
    recoverStaleCloudJobs(0);
  } catch (error) {
    console.error('恢复云盘任务失败', error);
  }
  cloudWatcherTimer = setInterval(() => {
    void processCloudTransferQueue().catch((error) => console.error('云盘队列处理失败', error));
  }, intervalMs);
}

export function stopCloudTransferWatcher(): void {
  if (cloudWatcherTimer) {
    clearInterval(cloudWatcherTimer);
    cloudWatcherTimer = null;
  }
}

async function runLibraryUploadJob(
  job: CloudTransferJob,
  req: CloudUploadLibraryRequest,
  cleanFilePaths: string[],
  cloudRootDir: string,
  targetDir: string,
  expectedTotalBytes: number,
): Promise<CloudUploadLibraryResult> {
  activeRunningJobIds.add(job.id);
  const copiedDestPaths: string[] = [];
  try {
    let copiedFiles = 0;
    let totalBytes = 0;
    const verifiedFiles: VerifiedFile[] = [];
    await fsp.mkdir(targetDir, { recursive: true });
    const realTarget = await fsp.realpath(targetDir);
    const reporter = createJobProgressReporter(job.id, expectedTotalBytes, (snap) => {
      saveJobProgress(job.id, snap);
    });

    for (const srcFile of cleanFilePaths) {
      const destFile = path.join(targetDir, path.basename(srcFile));
      if (pathsOverlap(await fsp.realpath(srcFile), path.join(realTarget, path.basename(srcFile)))) {
        throw new Error('本地文件与云盘目标路径重叠');
      }
      const result = await copyPathCrossDrive(srcFile, destFile, {
        ...reporter,
        copiedDestPaths,
        verifiedFiles,
      });
      copiedFiles += result.copiedFiles;
      totalBytes += result.totalBytes;
    }
    if (req.deleteLocal) await checkVerifiedFiles(verifiedFiles);

    startFinalizing(job.id);
    for (const file of verifiedFiles) {
      const watchedRec = getWatchedRecord(file.source);
      if (watchedRec) {
        setWatchedRecord(file.destination, watchedRec.watched, watchedRec.lastPlayedAt);
      }
    }

    // Preserve scraped metadata & cover on the cloud folder so LibraryPage displays it seamlessly
    const targetFolderKey = normalizePathKey(path.resolve(targetDir));
    const cloudSeriesId = crypto
      .createHash('sha1')
      .update(`dir:${targetFolderKey}`)
      .digest('hex')
      .slice(0, 16);

    const existingMeta =
      getSeriesMetaById(req.seriesId) ?? getSeriesMeta(req.folderPath);

    setSeriesMeta(
      cloudSeriesId,
      {
        ...(existingMeta || {}),
        seriesId: cloudSeriesId,
        folderPath: targetDir,
        title: existingMeta?.title || req.seriesTitle,
        bangumiId: existingMeta?.bangumiId || req.bangumiId,
        coverUrl: existingMeta?.coverUrl || req.coverUrl,
        updatedAt: Date.now(),
      },
      true,
    );

    recordDownloadMeta({
      title: req.seriesTitle,
      bangumiId: existingMeta?.bangumiId || req.bangumiId,
      bangumiTitle: existingMeta?.title || req.seriesTitle,
      coverUrl: existingMeta?.coverUrl || req.coverUrl,
      savePath: targetDir,
    });

    let warning: string | undefined;
    let deletedLocal = false;
    if (req.deleteLocal) {
      try {
        await removeVerifiedSources(verifiedFiles);
        if (req.kind === 'series' && req.folderPath) {
          const settings = getSettings();
          const resolvedFolder = path.resolve(req.folderPath);
          const folderKey = normalizePathKey(resolvedFolder);
          const scanRoots = new Set(
            [
              settings.downloadRootDir,
              ...settings.extraLibraryDirs,
              cloudRootDir,
            ]
              .map((d) => d?.trim())
              .filter(Boolean)
              .map((d) => normalizePathKey(path.resolve(d!))),
          );
          if (!scanRoots.has(folderKey) && fs.existsSync(resolvedFolder)) {
            const remaining = await fsp.readdir(resolvedFolder);
            if (remaining.length === 0) {
              await fsp.rmdir(resolvedFolder);
            }
          }
        }
        deletedLocal = true;
      } catch (rmErr) {
        warning = `已完整上传到云盘，但删除本地文件失败: ${
          rmErr instanceof Error ? rmErr.message : String(rmErr)
        }`;
      }
    }

    liveJobProgress.delete(job.id);
    const doneAt = Date.now();
    upsertCloudTransferJob({
      ...job,
      status: 'completed',
      workerPid: undefined,
      finalizing: undefined,
      cancelling: false,
      progress: 1,
      transferredBytes: totalBytes,
      speedBytesPerSec: 0,
      etaSeconds: 0,
      copiedFiles,
      totalFiles: cleanFilePaths.length,
      totalBytes,
      currentFileName: undefined,
      error: warning,
      updatedAt: doneAt,
      completedAt: doneAt,
    });

    return {
      ok: true,
      jobId: job.id,
      targetDir,
      copiedFiles,
      totalBytes,
      deletedLocal,
      cloudSeriesId,
      warning,
    };
  } catch (err) {
    liveJobProgress.delete(job.id);
    if (err instanceof JobCancelledError) {
        await cleanupCancelledCloudDest(copiedDestPaths);
      upsertCloudTransferJob({
        ...job,
        status: 'cancelled',
        workerPid: undefined,
        finalizing: undefined,
        cancelling: false,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        currentFileName: undefined,
        error: '已手动取消上传（已保留本地文件）',
        updatedAt: Date.now(),
      });
      return {
        ok: false,
        jobId: job.id,
        targetDir,
        copiedFiles: 0,
        totalBytes: 0,
        deletedLocal: false,
        error: '已手动取消上传（已保留本地文件）',
      };
    }

    const message = err instanceof Error ? err.message : String(err);
    upsertCloudTransferJob({
      ...job,
      status: 'failed',
      workerPid: undefined,
      finalizing: undefined,
      cancelling: false,
      speedBytesPerSec: 0,
      etaSeconds: 0,
      error: message,
      updatedAt: Date.now(),
    });
    return {
      ok: false,
      jobId: job.id,
      targetDir,
      copiedFiles: 0,
      totalBytes: 0,
      deletedLocal: false,
      error: message,
    };
  } finally {
    activeRunningJobIds.delete(job.id);
    invalidateCloudStatusCache();
  }
}

export async function uploadLibraryToCloud(
  req: CloudUploadLibraryRequest,
): Promise<CloudUploadLibraryResult> {
  const settings = getSettings();
  const cloudRootDir =
    settings.googleDriveDir?.trim() || detectGoogleDriveMount().defaultTargetDir || '';

  if (!cloudRootDir || !isPathOrParentAccessible(cloudRootDir)) {
    return {
      ok: false,
      copiedFiles: 0,
      totalBytes: 0,
      deletedLocal: false,
      error: '未检测到可用的谷歌云盘目录，请确认 Google Drive Desktop 已运行或在设置中配置云盘目录',
    };
  }

  const cleanFilePaths = (req.filePaths || []).map((p) => p.trim()).filter(Boolean);
  if (cleanFilePaths.length === 0) {
    return {
      ok: false,
      copiedFiles: 0,
      totalBytes: 0,
      deletedLocal: false,
      error: '没有可上传的视频文件',
    };
  }

  const targetDir = resolveCloudSeriesTargetDir(cloudRootDir, req.seriesTitle);
  let realCloudRoot: string;
  try {
    realCloudRoot = await fsp.realpath(cloudRootDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { ok: false, copiedFiles: 0, totalBytes: 0, deletedLocal: false,
        error: '谷歌云盘目录不可访问' };
    }
    realCloudRoot = path.resolve(cloudRootDir);
  }
  const destNames = new Set<string>();
  for (const srcFile of cleanFilePaths) {
    const destKey = normalizePathKey(path.join(targetDir, path.basename(srcFile)));
    if (destNames.has(destKey)) {
      return { ok: false, copiedFiles: 0, totalBytes: 0, deletedLocal: false,
        error: '所选文件中存在同名文件: ' + path.basename(srcFile) };
    }
    destNames.add(destKey);
  }

  let expectedTotalBytes = 0;
  for (const srcFile of cleanFilePaths) {
    try {
      const st = await fsp.lstat(srcFile);
      if (!st.isFile()) throw new Error('不支持的源文件类型');
      const source = await fsp.realpath(srcFile);
      if (pathsOverlap(source, realCloudRoot)) {
        return { ok: false, copiedFiles: 0, totalBytes: 0, deletedLocal: false,
          error: '请只选择云盘目录以外的本地文件' };
      }
      expectedTotalBytes += st.size;
    } catch {
      return {
        ok: false,
        copiedFiles: 0,
        totalBytes: 0,
        deletedLocal: false,
        error: `找不到本地文件: ${srcFile}`,
      };
    }
  }

  const jobId = crypto.randomUUID();
  const now = Date.now();
  const job: CloudTransferJob = {
    id: jobId,
    source: 'library',
    seriesId: req.seriesId,
    sourceFilePaths: cleanFilePaths,
    torrentName:
      req.kind === 'episode' && cleanFilePaths.length === 1
        ? path.basename(cleanFilePaths[0])
        : req.seriesTitle,
    bangumiId: req.bangumiId,
    bangumiTitle: req.seriesTitle,
    coverUrl: req.coverUrl,
    localSavePath: req.folderPath,
    cloudTargetDir: targetDir,
    deleteLocalAfterMove: req.deleteLocal,
    status: 'copying',
    workerPid: process.pid,
    progress: 0,
    transferredBytes: 0,
    copiedFiles: 0,
    totalFiles: cleanFilePaths.length,
    totalBytes: expectedTotalBytes,
    createdAt: now,
    updatedAt: now,
  };
  const reserved = updateCloudTransferJobs((jobs) => {
    if (hasTransferConflict(jobs, job)) return { result: false, changed: false };
    jobs.unshift(job);
    return { result: true };
  });
  if (!reserved) {
    return { ok: false, copiedFiles: 0, totalBytes: 0, deletedLocal: false,
      error: '该番剧正在上传中，请等待当前任务完成' };
  }

  if (req.background) {
    void runLibraryUploadJob(
      job,
      req,
      cleanFilePaths,
      cloudRootDir,
      targetDir,
      expectedTotalBytes,
    ).catch((error) => console.error('后台云盘任务失败', error));
    return {
      ok: true,
      jobId: job.id,
      queued: true,
      targetDir,
      copiedFiles: 0,
      totalBytes: expectedTotalBytes,
      deletedLocal: false,
    };
  }

  return await runLibraryUploadJob(
    job,
    req,
    cleanFilePaths,
    cloudRootDir,
    targetDir,
    expectedTotalBytes,
  );
}

export async function retryCloudJob(jobId: string): Promise<ActionResult> {
  const jobs = getCloudTransferJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) {
    return { ok: false, error: '找不到指定的云盘上传任务' };
  }
  if (job.status === 'completed') {
    return { ok: false, error: '任务已完成，无需重试' };
  }
  if (job.status === 'copying' && hasLiveWorker(job)) {
    return { ok: false, error: '该任务正在上传中，无需重试' };
  }

  if (job.source === 'library' && job.sourceFilePaths && job.sourceFilePaths.length > 0) {
    const startRes = await uploadLibraryToCloud({
      kind: job.sourceFilePaths.length === 1 ? 'episode' : 'series',
      seriesId: job.seriesId || job.id,
      seriesTitle: job.bangumiTitle || job.torrentName,
      folderPath: job.localSavePath,
      filePaths: job.sourceFilePaths,
      bangumiId: job.bangumiId,
      coverUrl: job.coverUrl,
      deleteLocal: job.deleteLocalAfterMove,
      background: true,
    });
    if (startRes.ok) {
      removeCloudJob(jobId);
      return { ok: true };
    }
    return { ok: false, error: startRes.error || '重试上传失败' };
  }

  const requeued = updateCloudTransferJobs((jobs) => {
    const current = jobs.find((item) => item.id === jobId);
    if (!current || current.status === 'completed' ||
        (current.status === 'copying' && hasLiveWorker(current))) {
      return { result: false, changed: false };
    }
    Object.assign(current, {
      status: 'queued',
      workerPid: undefined,
      finalizing: undefined,
      cancelling: false,
      error: undefined,
      updatedAt: Date.now(),
    });
    return { result: true };
  });
  if (!requeued) return { ok: false, error: '当前任务状态不支持重试' };
  void processCloudTransferQueue({}, true).catch((error) => console.error('云盘队列处理失败', error));
  return { ok: true };
}

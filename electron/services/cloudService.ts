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
  normalizePathKey,
  recordDownloadMeta,
  saveCloudTransferJobs,
  setSeriesMeta,
  setWatchedRecord,
  upsertCloudTransferJob,
} from './configStore';
import { controlTorrent, getTorrents, sanitizeFolderName } from './qbService';

export interface CloudQueueDeps {
  getTorrentsFn?: () => Promise<QbTorrentItem[]>;
  controlTorrentFn?: (hash: string, action: QbControlAction) => Promise<ActionResult>;
}

let cloudWatcherTimer: ReturnType<typeof setInterval> | null = null;
let isProcessingQueue = false;
const liveJobProgress = new Map<string, Partial<CloudTransferJob>>();
const cancelledJobIds = new Set<string>();

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

export function getCloudDriveStatus(): CloudDriveStatus {
  const mount = detectGoogleDriveMount();
  const settings = getSettings();
  const configuredDir = settings.googleDriveDir?.trim() || mount.defaultTargetDir || '';
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

  return {
    detected: Boolean(mount.mountRoot),
    mountRoot: mount.mountRoot,
    defaultTargetDir: mount.defaultTargetDir,
    configuredDir,
    configuredAccessible,
    freeBytes,
    totalBytes,
  };
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
  const now = Date.now();
  const jobs = getCloudTransferJobs();

  if (input.torrentHash) {
    const existing = jobs.find(
      (j) =>
        j.torrentHash &&
        j.torrentHash.toLowerCase() === input.torrentHash!.toLowerCase() &&
        (j.status === 'queued' || j.status === 'copying'),
    );
    if (existing) {
      const updated: CloudTransferJob = {
        ...existing,
        cloudTargetDir: input.cloudTargetDir,
        deleteLocalAfterMove: input.deleteLocalAfterMove ?? existing.deleteLocalAfterMove,
        updatedAt: now,
      };
      upsertCloudTransferJob(updated);
      return updated;
    }
  }

  const job: CloudTransferJob = {
    id: crypto.randomUUID(),
    source: 'download',
    torrentHash: input.torrentHash,
    torrentName: input.torrentName,
    bangumiId: input.bangumiId,
    bangumiTitle: input.bangumiTitle,
    coverUrl: input.coverUrl,
    subgroup: input.subgroup,
    localSavePath: input.localSavePath,
    cloudTargetDir: input.cloudTargetDir,
    deleteLocalAfterMove: input.deleteLocalAfterMove ?? true,
    status: 'queued',
    progress: 0,
    transferredBytes: 0,
    createdAt: now,
    updatedAt: now,
  };

  upsertCloudTransferJob(job);
  return job;
}

export function listCloudJobs(): CloudTransferJob[] {
  return getCloudTransferJobs()
    .map((job) => {
      if (job.status === 'copying') {
        const live = liveJobProgress.get(job.id);
        if (live) {
          return { ...job, ...live };
        }
      }
      return job;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function clearFinishedCloudJobs(): ActionResult {
  const active = getCloudTransferJobs().filter(
    (job) => job.status === 'queued' || job.status === 'copying',
  );
  saveCloudTransferJobs(active);
  return { ok: true };
}

export function removeCloudJob(jobId: string): ActionResult {
  const jobs = getCloudTransferJobs();
  const target = jobs.find((j) => j.id === jobId);
  if (!target) {
    return { ok: false, error: '找不到该云盘上传任务' };
  }
  if (target.status === 'copying') {
    return { ok: false, error: '正在复制传输的任务不能移除，请先取消上传' };
  }
  saveCloudTransferJobs(jobs.filter((j) => j.id !== jobId));
  liveJobProgress.delete(jobId);
  cancelledJobIds.delete(jobId);
  return { ok: true };
}

export function cancelCloudJob(jobId: string): ActionResult {
  const jobs = getCloudTransferJobs();
  const target = jobs.find((j) => j.id === jobId);
  if (!target) {
    return { ok: false, error: '找不到指定的云盘上传任务' };
  }
  if (target.status === 'queued') {
    upsertCloudTransferJob({
      ...target,
      status: 'cancelled',
      cancelling: false,
      error: '已取消上传',
      updatedAt: Date.now(),
    });
    return { ok: true };
  }
  if (target.status === 'copying') {
    cancelledJobIds.add(jobId);
    const existingLive = liveJobProgress.get(jobId) || {};
    liveJobProgress.set(jobId, {
      ...existingLive,
      cancelling: true,
      updatedAt: Date.now(),
    });
    return { ok: true };
  }
  return { ok: false, error: '当前任务状态不支持取消' };
}

async function computePathStats(
  targetPath: string,
): Promise<{ totalBytes: number; totalFiles: number }> {
  const stat = await fsp.stat(targetPath);
  if (!stat.isDirectory()) {
    return { totalBytes: stat.size, totalFiles: 1 };
  }
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

function createJobProgressReporter(jobId: string, totalBytes: number) {
  const startedAt = Date.now();
  let transferredBytes = 0;
  let copiedFiles = 0;

  const publish = (currentFileName?: string) => {
    const now = Date.now();
    const elapsedSec = Math.max(0.25, (now - startedAt) / 1000);
    const speedBytesPerSec = transferredBytes > 0 ? Math.round(transferredBytes / elapsedSec) : 0;
    const remaining = Math.max(0, totalBytes - transferredBytes);
    const etaSeconds =
      speedBytesPerSec > 0 ? Math.max(0, Math.round(remaining / speedBytesPerSec)) : 0;
    const progress =
      totalBytes > 0 ? Math.min(0.999, transferredBytes / totalBytes) : 0;

    liveJobProgress.set(jobId, {
      ...(liveJobProgress.get(jobId) || {}),
      progress,
      transferredBytes,
      speedBytesPerSec,
      etaSeconds,
      copiedFiles,
      currentFileName,
      updatedAt: now,
    });
  };

  return {
    isCancelled: () => cancelledJobIds.has(jobId),
    onFileStart: (fileName: string) => {
      publish(fileName);
    },
    onFileVerified: (fileBytes: number, fileName: string) => {
      transferredBytes += fileBytes;
      copiedFiles += 1;
      publish(fileName);
    },
  };
}

export interface CopyProgressCallbacks {
  isCancelled?: () => boolean;
  onFileStart?: (fileName: string) => void;
  onFileVerified?: (fileBytes: number, fileName: string) => void;
  copiedDestPaths?: string[];
}

export async function copyPathCrossDrive(
  srcPath: string,
  destPath: string,
  callbacks?: CopyProgressCallbacks,
): Promise<{ copiedFiles: number; totalBytes: number }> {
  if (callbacks?.isCancelled?.()) {
    throw new JobCancelledError();
  }

  const srcStat = await fsp.stat(srcPath);
  if (srcStat.isDirectory()) {
    await fsp.mkdir(destPath, { recursive: true });
    const entries = await fsp.readdir(srcPath, { withFileTypes: true });
    let copiedFiles = 0;
    let totalBytes = 0;
    for (const entry of entries) {
      const childSrc = path.join(srcPath, entry.name);
      const childDest = path.join(destPath, entry.name);
      const res = await copyPathCrossDrive(childSrc, childDest, callbacks);
      copiedFiles += res.copiedFiles;
      totalBytes += res.totalBytes;
    }
    return { copiedFiles, totalBytes };
  }

  const fileName = path.basename(destPath);
  callbacks?.onFileStart?.(fileName);
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  await fsp.copyFile(srcPath, destPath);
  callbacks?.copiedDestPaths?.push(destPath);

  if (callbacks?.isCancelled?.()) {
    throw new JobCancelledError();
  }

  const destStat = await fsp.stat(destPath);
  if (destStat.size !== srcStat.size) {
    throw new Error(`云盘校验失败: ${fileName} 大小不一致 (${destStat.size} != ${srcStat.size})`);
  }
  callbacks?.onFileVerified?.(destStat.size, fileName);
  return {
    copiedFiles: 1,
    totalBytes: destStat.size,
  };
}

async function cleanupCancelledCloudDest(
  copiedDestPaths: string[],
  targetDir?: string,
): Promise<void> {
  for (const destFile of copiedDestPaths) {
    try {
      if (fs.existsSync(destFile)) {
        await removeWithRetry(destFile, 2);
      }
    } catch {
      // Best-effort cleanup of cancelled partial destination files
    }
  }
  if (targetDir && fs.existsSync(targetDir)) {
    try {
      const entries = await fsp.readdir(targetDir);
      if (entries.length === 0) {
        await fsp.rmdir(targetDir);
      }
    } catch {
      // Ignore if non-empty or already existed
    }
  }
}

function findMatchingTorrent(
  job: CloudTransferJob,
  torrents: QbTorrentItem[],
): QbTorrentItem | undefined {
  if (job.torrentHash) {
    const byHash = torrents.find(
      (t) => t.hash.toLowerCase() === job.torrentHash!.toLowerCase(),
    );
    if (byHash) return byHash;
  }

  const jobSaveKey = normalizePathKey(job.localSavePath);
  return torrents.find((t) => {
    const sameSave = normalizePathKey(t.savePath) === jobSaveKey;
    if (!sameSave) return false;
    return (
      t.name === job.torrentName ||
      t.name.includes(job.torrentName) ||
      job.torrentName.includes(t.name)
    );
  });
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

async function removeWithRetry(targetPath: string, retries = 3): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      await fsp.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
    const allJobs = getCloudTransferJobs();
    const candidates = allJobs.filter(
      (job) => job.status === 'queued' || (retryFailed && job.status === 'failed'),
    );
    if (candidates.length === 0) {
      return { processed: 0, moved: 0, failed: 0 };
    }

    const getTorrentsFn = deps.getTorrentsFn ?? getTorrents;
    const controlTorrentFn = deps.controlTorrentFn ?? controlTorrent;
    const torrents = await getTorrentsFn();

    for (const job of candidates) {
      const torrent = findMatchingTorrent(job, torrents);
      if (!torrent || torrent.progress < 0.999) {
        continue;
      }

      processed += 1;
      upsertCloudTransferJob({
        ...job,
        status: 'copying',
        torrentHash: torrent.hash,
        error: undefined,
        updatedAt: Date.now(),
      });

      const copiedDestPaths: string[] = [];
      try {
        if (!isPathOrParentAccessible(job.cloudTargetDir)) {
          throw new Error('谷歌云盘目录不可用，请确认 Google Drive Desktop 已运行且挂载盘存在');
        }

        const srcPath = resolveTorrentSourcePath(torrent, job.localSavePath);
        const destPath = path.join(job.cloudTargetDir, path.basename(srcPath));
        const stats = await computePathStats(srcPath);
        upsertCloudTransferJob({
          ...job,
          source: 'download',
          status: 'copying',
          torrentHash: torrent.hash,
          totalFiles: stats.totalFiles,
          totalBytes: stats.totalBytes,
          transferredBytes: 0,
          progress: 0,
          cancelling: false,
          error: undefined,
          updatedAt: Date.now(),
        });

        const reporter = createJobProgressReporter(job.id, stats.totalBytes);
        const { copiedFiles, totalBytes } = await copyPathCrossDrive(srcPath, destPath, {
          ...reporter,
          copiedDestPaths,
        });

        if (cancelledJobIds.has(job.id)) {
          throw new JobCancelledError();
        }

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

        let warningNote: string | undefined;
        if (job.deleteLocalAfterMove) {
          const ctrlRes = await controlTorrentFn(torrent.hash, 'delete');
          if (!ctrlRes.ok) {
            warningNote = `已复制到云盘，但移除 qB 任务失败: ${ctrlRes.error || '未知错误'}`;
          } else {
            try {
              await removeWithRetry(srcPath);
              await cleanupEmptyStagingDir(job.localSavePath);
            } catch (rmErr) {
              warningNote = `已复制到云盘并移除任务，但清理本地文件失败: ${
                rmErr instanceof Error ? rmErr.message : String(rmErr)
              }`;
            }
          }
        }

        liveJobProgress.delete(job.id);
        cancelledJobIds.delete(job.id);
        const now = Date.now();
        upsertCloudTransferJob({
          ...job,
          source: 'download',
          torrentHash: torrent.hash,
          status: 'completed',
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
          cancelledJobIds.delete(job.id);
          await cleanupCancelledCloudDest(copiedDestPaths, job.cloudTargetDir);
          upsertCloudTransferJob({
            ...job,
            status: 'cancelled',
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
            cancelling: false,
            speedBytesPerSec: 0,
            etaSeconds: 0,
            error: err instanceof Error ? err.message : String(err),
            updatedAt: Date.now(),
          });
        }
      }
    }

    return { processed, moved, failed };
  } catch {
    return { processed, moved, failed };
  } finally {
    isProcessingQueue = false;
  }
}

export function startCloudTransferWatcher(intervalMs = 20_000): void {
  stopCloudTransferWatcher();
  cloudWatcherTimer = setInterval(() => {
    void processCloudTransferQueue();
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
  const copiedDestPaths: string[] = [];
  try {
    let copiedFiles = 0;
    let totalBytes = 0;
    const verifiedSrcFiles: string[] = [];
    const reporter = createJobProgressReporter(job.id, expectedTotalBytes);

    for (const srcFile of cleanFilePaths) {
      if (cancelledJobIds.has(job.id)) {
        throw new JobCancelledError();
      }
      if (!fs.existsSync(srcFile)) {
        throw new Error(`找不到本地文件: ${srcFile}`);
      }
      const destFile = path.join(targetDir, path.basename(srcFile));
      const srcKey = normalizePathKey(path.resolve(srcFile));
      const destKey = normalizePathKey(path.resolve(destFile));
      if (srcKey !== destKey) {
        const res = await copyPathCrossDrive(srcFile, destFile, {
          ...reporter,
          copiedDestPaths,
        });
        copiedFiles += res.copiedFiles;
        totalBytes += res.totalBytes;
        verifiedSrcFiles.push(srcFile);
      }

      if (cancelledJobIds.has(job.id)) {
        throw new JobCancelledError();
      }

      const watchedRec = getWatchedRecord(srcFile);
      if (watchedRec) {
        setWatchedRecord(destFile, watchedRec.watched, watchedRec.lastPlayedAt);
      }
    }

    if (cancelledJobIds.has(job.id)) {
      throw new JobCancelledError();
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
        for (const srcFile of verifiedSrcFiles) {
          await removeWithRetry(srcFile);
        }
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
    cancelledJobIds.delete(job.id);
    const doneAt = Date.now();
    upsertCloudTransferJob({
      ...job,
      status: 'completed',
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
      cancelledJobIds.delete(job.id);
      await cleanupCancelledCloudDest(copiedDestPaths, targetDir);
      upsertCloudTransferJob({
        ...job,
        status: 'cancelled',
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

  const cloudRootKey = normalizePathKey(path.resolve(cloudRootDir));
  const allAlreadyInCloud = cleanFilePaths.every((fp) => {
    const key = normalizePathKey(path.resolve(fp));
    return key.startsWith(`${cloudRootKey}/`) || key.startsWith(`${cloudRootKey}\\`);
  });
  if (allAlreadyInCloud) {
    return {
      ok: false,
      copiedFiles: 0,
      totalBytes: 0,
      deletedLocal: false,
      error: '该番剧已在谷歌云盘目录中，无需重复上传',
    };
  }

  let expectedTotalBytes = 0;
  for (const srcFile of cleanFilePaths) {
    if (!fs.existsSync(srcFile)) {
      return {
        ok: false,
        copiedFiles: 0,
        totalBytes: 0,
        deletedLocal: false,
        error: `找不到本地文件: ${srcFile}`,
      };
    }
    try {
      expectedTotalBytes += (await fsp.stat(srcFile)).size;
    } catch {
      // Ignore stat issue before copy
    }
  }

  const targetDir = resolveCloudSeriesTargetDir(cloudRootDir, req.seriesTitle);
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
    progress: 0,
    transferredBytes: 0,
    copiedFiles: 0,
    totalFiles: cleanFilePaths.length,
    totalBytes: expectedTotalBytes,
    createdAt: now,
    updatedAt: now,
  };
  upsertCloudTransferJob(job);

  if (req.background) {
    void runLibraryUploadJob(
      job,
      req,
      cleanFilePaths,
      cloudRootDir,
      targetDir,
      expectedTotalBytes,
    );
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
  if (job.status === 'copying') {
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
      saveCloudTransferJobs(getCloudTransferJobs().filter((j) => j.id !== jobId));
      return { ok: true };
    }
    return { ok: false, error: startRes.error || '重试上传失败' };
  }

  upsertCloudTransferJob({
    ...job,
    status: 'queued',
    error: undefined,
    updatedAt: Date.now(),
  });
  void processCloudTransferQueue({}, true);
  return { ok: true };
}

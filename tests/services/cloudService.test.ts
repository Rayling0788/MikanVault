import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelCloudJob,
  clearFinishedCloudJobs,
  enqueueCloudTransferJob,
  listCloudJobs,
  processCloudTransferQueue,
  recoverStaleCloudJobs,
  removeCloudJob,
  retryCloudJob,
  uploadLibraryToCloud,
} from '../../electron/services/cloudService';
import {
  getSeriesMetaById,
  setDataDirForTesting,
  setSeriesMeta,
  setWatchedRecord,
  updateSettings,
  upsertCloudTransferJob,
} from '../../electron/services/configStore';
import { scanLibrary } from '../../electron/services/libraryService';
import type { QbTorrentItem } from '../../src/shared/types';

function makeTorrent(overrides: Partial<QbTorrentItem> = {}): QbTorrentItem {
  return {
    hash: 'abcdef1234567890abcdef1234567890abcdef12',
    name: '[LoliHouse] Frieren - 01 [1080p].mkv',
    state: 'uploading',
    progress: 1,
    size: 1024,
    downloaded: 1024,
    dlspeed: 0,
    upspeed: 0,
    eta: 0,
    savePath: '',
    contentPath: '',
    category: 'MikanVault',
    addedOn: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

describe('cloudService', () => {
  let tmpDir: string;
  let localRoot: string;
  let cloudRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mikanvault-cloud-test-'));
    localRoot = path.join(tmpDir, 'LocalAnime');
    cloudRoot = path.join(tmpDir, 'MockGoogleDrive', 'MikanVault');
    fs.mkdirSync(localRoot, { recursive: true });
    fs.mkdirSync(cloudRoot, { recursive: true });
    setDataDirForTesting(path.join(tmpDir, 'app-data'));
    updateSettings({
      downloadRootDir: localRoot,
      googleDriveEnabled: true,
      googleDriveDir: cloudRoot,
      googleDriveAutoDeleteLocal: true,
      googleDriveIncludeInLibrary: true,
    });
  });

  afterEach(() => {
    setDataDirForTesting(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies completed torrent to cloud dir, records metadata, removes qB task, and cleans local staging file', async () => {
    const seriesStagingDir = path.join(localRoot, '葬送的芙莉莲');
    const localVideoPath = path.join(seriesStagingDir, '[LoliHouse] Frieren - 01 [1080p].mkv');
    fs.mkdirSync(seriesStagingDir, { recursive: true });
    fs.writeFileSync(localVideoPath, Buffer.from('fake-mkv-payload-1234567890'));

    const cloudSeriesDir = path.join(cloudRoot, '葬送的芙莉莲');
    const torrent = makeTorrent({
      savePath: seriesStagingDir,
      contentPath: localVideoPath,
    });

    const job = enqueueCloudTransferJob({
      torrentHash: torrent.hash,
      torrentName: torrent.name,
      bangumiId: '3141',
      bangumiTitle: '葬送的芙莉莲',
      coverUrl: 'https://mikanani.kas.pub/images/Bangumi/frieren.jpg',
      subgroup: 'LoliHouse',
      localSavePath: seriesStagingDir,
      cloudTargetDir: cloudSeriesDir,
      deleteLocalAfterMove: true,
    });
    expect(job.status).toBe('queued');

    const controlMock = vi.fn(async () => ({ ok: true }));
    const summary = await processCloudTransferQueue({
      getTorrentsFn: async () => [torrent],
      controlTorrentFn: controlMock,
    });

    expect(summary).toEqual({ processed: 1, moved: 1, failed: 0 });
    expect(controlMock).toHaveBeenCalledWith(torrent.hash, 'delete');

    const cloudDestFile = path.join(cloudSeriesDir, '[LoliHouse] Frieren - 01 [1080p].mkv');
    expect(fs.existsSync(cloudDestFile)).toBe(true);
    expect(fs.readFileSync(cloudDestFile, 'utf-8')).toBe('fake-mkv-payload-1234567890');
    expect(fs.existsSync(localVideoPath)).toBe(false);
    expect(fs.existsSync(seriesStagingDir)).toBe(false);

    const savedMeta = getSeriesMetaById('3141');
    expect(savedMeta?.folderPath).toBe(cloudSeriesDir);
    expect(savedMeta?.coverUrl).toBe('https://mikanani.kas.pub/images/Bangumi/frieren.jpg');

    const jobsAfter = listCloudJobs();
    expect(jobsAfter[0].status).toBe('completed');
    expect(jobsAfter[0].copiedFiles).toBe(1);

    // Library scan auto-includes googleDriveDir and tags isCloud=true
    const scanned = await scanLibrary();
    const cloudSeries = scanned.find((s) => s.title === '葬送的芙莉莲');
    expect(cloudSeries).toBeDefined();
    expect(cloudSeries?.isCloud).toBe(true);
    expect(cloudSeries?.episodes.length).toBe(1);

    clearFinishedCloudJobs();
    expect(listCloudJobs()).toHaveLength(0);
  });

  it('preserves local files and qB task when cloud destination drive/parent is inaccessible', async () => {
    const seriesStagingDir = path.join(localRoot, '药屋少女');
    const localVideoPath = path.join(seriesStagingDir, 'ep01.mkv');
    fs.mkdirSync(seriesStagingDir, { recursive: true });
    fs.writeFileSync(localVideoPath, 'important-local-data');

    const unmountedCloudSeriesDir = path.join(
      tmpDir,
      'MissingDriveMount',
      'MikanVault',
      '药屋少女',
    );
    const torrent = makeTorrent({
      hash: '1111222233334444555566667777888899990000',
      name: 'ep01.mkv',
      savePath: seriesStagingDir,
      contentPath: localVideoPath,
    });

    enqueueCloudTransferJob({
      torrentHash: torrent.hash,
      torrentName: torrent.name,
      bangumiTitle: '药屋少女',
      localSavePath: seriesStagingDir,
      cloudTargetDir: unmountedCloudSeriesDir,
      deleteLocalAfterMove: true,
    });

    const controlMock = vi.fn(async () => ({ ok: true }));
    const summary = await processCloudTransferQueue({
      getTorrentsFn: async () => [torrent],
      controlTorrentFn: controlMock,
    });

    expect(summary).toEqual({ processed: 1, moved: 0, failed: 1 });
    expect(controlMock).not.toHaveBeenCalled();
    expect(fs.existsSync(localVideoPath)).toBe(true);

    const jobs = listCloudJobs();
    expect(jobs[0].status).toBe('failed');
    expect(jobs[0].error).toContain('不可用');
  });

  it('skips torrents that are still downloading and keeps job queued', async () => {
    const seriesStagingDir = path.join(localRoot, '迷宫饭');
    fs.mkdirSync(seriesStagingDir, { recursive: true });
    const cloudSeriesDir = path.join(cloudRoot, '迷宫饭');
    const torrent = makeTorrent({
      hash: 'aaaa222233334444555566667777888899990000',
      name: 'ep03.mkv',
      progress: 0.45,
      state: 'downloading',
      savePath: seriesStagingDir,
    });

    enqueueCloudTransferJob({
      torrentHash: torrent.hash,
      torrentName: torrent.name,
      bangumiTitle: '迷宫饭',
      localSavePath: seriesStagingDir,
      cloudTargetDir: cloudSeriesDir,
    });

    const summary = await processCloudTransferQueue({
      getTorrentsFn: async () => [torrent],
      controlTorrentFn: async () => ({ ok: true }),
    });

    expect(summary).toEqual({ processed: 0, moved: 0, failed: 0 });
    expect(listCloudJobs()[0].status).toBe('queued');
  });

  it('uploadLibraryToCloud with deleteLocal=true copies episodes, preserves metadata & watched state, and removes local folder', async () => {
    const localSeriesDir = path.join(localRoot, '葬送的芙莉莲');
    const ep1 = path.join(localSeriesDir, '[LoliHouse] Frieren - 01 [1080p].mkv');
    const ep2 = path.join(localSeriesDir, '[LoliHouse] Frieren - 02 [1080p].mkv');
    fs.mkdirSync(localSeriesDir, { recursive: true });
    fs.writeFileSync(ep1, 'ep1-video-content');
    fs.writeFileSync(ep2, 'ep2-video-content');

    setWatchedRecord(ep1, true, 1_700_000_000_000);
    setSeriesMeta(
      'series-local-frieren',
      {
        seriesId: 'series-local-frieren',
        folderPath: localSeriesDir,
        title: '葬送的芙莉莲',
        bangumiId: '3141',
        coverUrl: 'https://mikanani.kas.pub/images/frieren.jpg',
        rating: 9.4,
        updatedAt: Date.now(),
      },
      true,
    );

    const res = await uploadLibraryToCloud({
      kind: 'series',
      seriesId: 'series-local-frieren',
      seriesTitle: '葬送的芙莉莲',
      folderPath: localSeriesDir,
      filePaths: [ep1, ep2],
      bangumiId: '3141',
      coverUrl: 'https://mikanani.kas.pub/images/frieren.jpg',
      deleteLocal: true,
    });

    expect(res.ok).toBe(true);
    expect(res.copiedFiles).toBe(2);
    expect(res.deletedLocal).toBe(true);
    expect(res.targetDir).toBe(path.join(cloudRoot, '葬送的芙莉莲'));
    expect(fs.existsSync(ep1)).toBe(false);
    expect(fs.existsSync(ep2)).toBe(false);
    expect(fs.existsSync(localSeriesDir)).toBe(false);

    const scanned = await scanLibrary();
    const cloudSeries = scanned.find((s) => s.title === '葬送的芙莉莲');
    expect(cloudSeries).toBeDefined();
    expect(cloudSeries?.isCloud).toBe(true);
    expect(cloudSeries?.totalEpisodes).toBe(2);
    expect(cloudSeries?.watchedCount).toBe(1);
    expect(cloudSeries?.rating).toBe(9.4);
    expect(cloudSeries?.coverUrl).toBe('https://mikanani.kas.pub/images/frieren.jpg');
  });

  it('uploadLibraryToCloud with deleteLocal=false retains local copy, and preserves local files on inaccessible cloud dir', async () => {
    const localSeriesDir = path.join(localRoot, '迷宫饭');
    const ep1 = path.join(localSeriesDir, '[LoliHouse] Dungeon - 01.mkv');
    fs.mkdirSync(localSeriesDir, { recursive: true });
    fs.writeFileSync(ep1, 'dungeon-ep1-payload');

    const keepRes = await uploadLibraryToCloud({
      kind: 'episode',
      seriesId: 'series-local-dungeon',
      seriesTitle: '迷宫饭',
      folderPath: localSeriesDir,
      filePaths: [ep1],
      deleteLocal: false,
    });

    expect(keepRes.ok).toBe(true);
    expect(keepRes.deletedLocal).toBe(false);
    expect(fs.existsSync(ep1)).toBe(true);
    expect(fs.existsSync(path.join(cloudRoot, '迷宫饭', '[LoliHouse] Dungeon - 01.mkv'))).toBe(true);

    updateSettings({
      googleDriveDir: path.join(tmpDir, 'NonExistentDrive', 'MikanVault'),
    });
    const failRes = await uploadLibraryToCloud({
      kind: 'series',
      seriesId: 'series-local-dungeon',
      seriesTitle: '迷宫饭',
      folderPath: localSeriesDir,
      filePaths: [ep1],
      deleteLocal: true,
    });

    expect(failRes.ok).toBe(false);
    expect(failRes.deletedLocal).toBe(false);
    expect(fs.existsSync(ep1)).toBe(true);

    // Retry workflow: induce failure during copy (target folder path occupied by a regular file)
    updateSettings({ googleDriveDir: cloudRoot });
    const conflictPath = path.join(cloudRoot, '迷宫饭冲突');
    fs.writeFileSync(conflictPath, 'blocking-file');
    const failCopyRes = await uploadLibraryToCloud({
      kind: 'series',
      seriesId: 'series-local-dungeon-conflict',
      seriesTitle: '迷宫饭冲突',
      folderPath: localSeriesDir,
      filePaths: [ep1],
      deleteLocal: false,
    });
    expect(failCopyRes.ok).toBe(false);
    expect(fs.existsSync(ep1)).toBe(true);

    const failedJob = listCloudJobs().find((j) => j.status === 'failed');
    expect(failedJob).toBeDefined();

    fs.unlinkSync(conflictPath);
    const retryRes = await retryCloudJob(failedJob!.id);
    expect(retryRes.ok).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(
      listCloudJobs().some((j) => j.bangumiTitle === '迷宫饭冲突' && j.status === 'completed'),
    ).toBe(true);
  });

  it('supports background upload mode, cancelCloudJob on queued jobs, and removeCloudJob', async () => {
    const localSeriesDir = path.join(localRoot, '孤独摇滚');
    const ep1 = path.join(localSeriesDir, '[LoliHouse] Bocchi - 01.mkv');
    fs.mkdirSync(localSeriesDir, { recursive: true });
    fs.writeFileSync(ep1, 'bocchi-ep1-payload');

    const queuedJob = enqueueCloudTransferJob({
      torrentHash: '9999222233334444555566667777888899990000',
      torrentName: 'bocchi-ep1',
      localSavePath: localSeriesDir,
      cloudTargetDir: path.join(cloudRoot, '孤独摇滚'),
    });

    const cancelRes = cancelCloudJob(queuedJob.id);
    expect(cancelRes.ok).toBe(true);
    expect(listCloudJobs().find((j) => j.id === queuedJob.id)?.status).toBe('cancelled');
    expect(fs.existsSync(ep1)).toBe(true);

    const removeRes = removeCloudJob(queuedJob.id);
    expect(removeRes.ok).toBe(true);
    expect(listCloudJobs().some((j) => j.id === queuedJob.id)).toBe(false);

    const bgRes = await uploadLibraryToCloud({
      kind: 'episode',
      seriesId: 'bocchi-local',
      seriesTitle: '孤独摇滚',
      folderPath: localSeriesDir,
      filePaths: [ep1],
      deleteLocal: false,
      background: true,
    });
    expect(bgRes.ok).toBe(true);
    expect(bgRes.queued).toBe(true);
    expect(bgRes.jobId).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 120));
    const doneJob = listCloudJobs().find((j) => j.id === bgRes.jobId);
    expect(doneJob?.status).toBe('completed');
    expect(doneJob?.progress).toBe(1);
    expect(fs.existsSync(path.join(cloudRoot, '孤独摇滚', '[LoliHouse] Bocchi - 01.mkv'))).toBe(
      true,
    );
  });

  it('recovers stale copying jobs from crashed sessions, cancels zombie jobs cleanly, and skips already-verified files on retry', async () => {
    const localSeriesDir = path.join(localRoot, '药屋少女测试');
    const ep1 = path.join(localSeriesDir, 'ep49.mkv');
    const ep2 = path.join(localSeriesDir, 'ep50.mkv');
    fs.mkdirSync(localSeriesDir, { recursive: true });
    fs.writeFileSync(ep1, 'ep49-verified-payload');
    fs.writeFileSync(ep2, 'ep50-remaining-payload');

    // Simulate ep49 already copied cleanly before previous app session closed
    const cloudSeriesDir = path.join(cloudRoot, '药屋少女测试');
    fs.mkdirSync(cloudSeriesDir, { recursive: true });
    fs.writeFileSync(path.join(cloudSeriesDir, 'ep49.mkv'), 'ep49-verified-payload');

    const zombieId = 'zombie-job-1';
    upsertCloudTransferJob({
      id: zombieId,
      source: 'library',
      seriesId: 'kusuriya-local',
      sourceFilePaths: [ep1, ep2],
      torrentName: '药屋少女测试',
      bangumiTitle: '药屋少女测试',
      localSavePath: localSeriesDir,
      cloudTargetDir: cloudSeriesDir,
      deleteLocalAfterMove: false,
      status: 'copying',
      progress: 0,
      copiedFiles: 0,
      totalFiles: 2,
      totalBytes: 43,
      createdAt: Date.now() - 300_000,
      updatedAt: Date.now() - 300_000,
    });

    // Zombie cancel must succeed immediately without hanging at "取消中..."
    const zombieCancel = cancelCloudJob(zombieId);
    expect(zombieCancel.ok).toBe(true);
    expect(listCloudJobs().find((j) => j.id === zombieId)?.status).toBe('cancelled');
    expect(fs.existsSync(ep1)).toBe(true);

    // Retry resumes smartly, skipping already-verified ep49 and copying ep50
    const retryRes = await retryCloudJob(zombieId);
    expect(retryRes.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const completedJob = listCloudJobs().find(
      (j) => j.bangumiTitle === '药屋少女测试' && j.status === 'completed',
    );
    expect(completedJob).toBeDefined();
    expect(completedJob?.copiedFiles).toBe(2);
    expect(fs.existsSync(path.join(cloudSeriesDir, 'ep50.mkv'))).toBe(true);

    // Test startup stale recovery directly
    const zombieId2 = 'zombie-job-2';
    upsertCloudTransferJob({
      id: zombieId2,
      source: 'library',
      seriesId: 'kusuriya-local',
      sourceFilePaths: [ep1, ep2],
      torrentName: '药屋少女测试',
      bangumiTitle: '药屋少女测试',
      localSavePath: localSeriesDir,
      cloudTargetDir: cloudSeriesDir,
      deleteLocalAfterMove: false,
      status: 'copying',
      createdAt: Date.now() - 10_000,
      updatedAt: Date.now() - 10_000,
    });

    const recoveredCount = recoverStaleCloudJobs(0);
    expect(recoveredCount).toBe(1);
    expect(listCloudJobs().find((j) => j.id === zombieId2)?.status).toBe('failed');
  });
});

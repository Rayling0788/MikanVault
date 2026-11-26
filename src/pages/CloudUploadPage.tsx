import React, { useDeferredValue, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Cloud,
  CloudUpload,
  Film,
  FolderOpen,
  HardDrive,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CloudDriveStatus,
  CloudTransferJob,
  LibrarySeries,
} from '@shared/types';
import { api } from '@/lib/api';
import { formatBytes, formatEta, formatSpeed } from '@/lib/format';
import { PosterImage } from '@/components/PosterImage';
import { CloudUploadModal, type CloudUploadTarget } from '@/components/CloudUploadModal';
import { useToast } from '@/hooks/useToast';

interface CloudUploadPageProps {
  status: CloudDriveStatus | null;
  jobs: CloudTransferJob[];
  loading: boolean;
  activeCount: number;
  queuedCount: number;
  completedCount: number;
  failedOrCancelledCount: number;
  totalSpeed: number;
  totalUploadedBytes: number;
  librarySeries: LibrarySeries[];
  onRefresh: () => Promise<void>;
  onRefreshLibrary: () => Promise<void>;
  onOpenSettings: () => void;
}

type CloudFilter = 'all' | 'copying' | 'queued' | 'completed' | 'stopped';

export const CloudUploadPage: React.FC<CloudUploadPageProps> = ({
  status,
  jobs,
  loading,
  activeCount,
  queuedCount,
  completedCount,
  failedOrCancelledCount,
  totalSpeed,
  totalUploadedBytes,
  librarySeries,
  onRefresh,
  onRefreshLibrary,
  onOpenSettings,
}) => {
  const { pushToast } = useToast();
  const [filter, setFilter] = useState<CloudFilter>('all');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [checkingQueue, setCheckingQueue] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const deferredPickerQuery = useDeferredValue(pickerQuery);
  const [uploadTarget, setUploadTarget] = useState<CloudUploadTarget | null>(null);

  const localSeries = useMemo(
    () => librarySeries.filter((s) => !s.isCloud && s.episodes.length > 0),
    [librarySeries],
  );
  const cloudSeriesCount = useMemo(
    () => librarySeries.filter((s) => s.isCloud).length,
    [librarySeries],
  );

  const filteredLocalPicker = useMemo(() => {
    const q = deferredPickerQuery.trim().toLowerCase();
    if (!q) return localSeries;
    return localSeries.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.originalTitle && s.originalTitle.toLowerCase().includes(q)) ||
        s.folderPath.toLowerCase().includes(q),
    );
  }, [localSeries, deferredPickerQuery]);

  const filteredJobs = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return jobs.filter((job) => {
      if (filter === 'copying' && job.status !== 'copying') return false;
      if (filter === 'queued' && job.status !== 'queued') return false;
      if (filter === 'completed' && job.status !== 'completed') return false;
      if (filter === 'stopped' && job.status !== 'failed' && job.status !== 'cancelled') {
        return false;
      }
      if (
        q &&
        !job.torrentName.toLowerCase().includes(q) &&
        !(job.bangumiTitle && job.bangumiTitle.toLowerCase().includes(q)) &&
        !job.cloudTargetDir.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [jobs, filter, deferredSearch]);

  const freeBytes = status?.freeBytes ?? 0;
  const totalDiskBytes = status?.totalBytes ?? 0;
  const usedDiskBytes = Math.max(0, totalDiskBytes - freeBytes);
  const usedPct =
    totalDiskBytes > 0 ? Math.min(100, Math.round((usedDiskBytes / totalDiskBytes) * 100)) : 0;

  const handleCancelJob = async (job: CloudTransferJob) => {
    setBusyJobId(job.id);
    try {
      const res = await api.cloudCancelJob(job.id);
      if (res.ok) {
        pushToast({
          kind: 'info',
          title: job.status === 'copying' ? '正在取消上传' : '已取消云盘任务',
          description: `${job.bangumiTitle || job.torrentName} · 本地文件已安全保留`,
        });
        await onRefresh();
      } else {
        pushToast({
          kind: 'error',
          title: '取消任务失败',
          description: res.error || '无法取消当前任务',
        });
      }
    } finally {
      setBusyJobId(null);
    }
  };

  const handleRetryJob = async (job: CloudTransferJob) => {
    setBusyJobId(job.id);
    try {
      const res = await api.cloudRetryJob(job.id);
      if (res.ok) {
        pushToast({
          kind: 'success',
          title: '已重新加入上传队列',
          description: job.bangumiTitle || job.torrentName,
        });
        await onRefresh();
      } else {
        pushToast({
          kind: 'error',
          title: '重试上传失败',
          description: res.error || '请检查本地文件与云盘路径',
        });
      }
    } finally {
      setBusyJobId(null);
    }
  };

  const handleRemoveJob = async (job: CloudTransferJob) => {
    setBusyJobId(job.id);
    try {
      const res = await api.cloudRemoveJob(job.id);
      if (res.ok) {
        await onRefresh();
      } else {
        pushToast({
          kind: 'error',
          title: '移除记录失败',
          description: res.error || '任务正在传输中',
        });
      }
    } finally {
      setBusyJobId(null);
    }
  };

  const handleProcessNow = async () => {
    setCheckingQueue(true);
    try {
      const res = await api.cloudProcessNow();
      await Promise.all([onRefresh(), onRefreshLibrary()]);
      pushToast({
        kind: res.failed > 0 ? 'info' : 'success',
        title: '云盘待转存检测完成',
        description: `已转存 ${res.moved} 项${res.failed > 0 ? `，失败 ${res.failed} 项` : ''}`,
      });
    } finally {
      setCheckingQueue(false);
    }
  };

  const handleClearFinished = async () => {
    await api.cloudClearFinished();
    await onRefresh();
    pushToast({ kind: 'info', title: '已清空非活跃上传记录' });
  };

  const handleOpenCloudFolder = async (targetPath: string) => {
    const res = await api.libraryOpenFolder(targetPath);
    if (!res.ok) {
      pushToast({ kind: 'error', title: '无法打开云盘目录', description: res.error || targetPath });
    }
  };

  return (
    <div className="mx-auto max-w-[1380px] space-y-6 px-6 py-6 pb-16">
      {/* Cloud Drive Vault Hero Banner */}
      <section className="cloud-hero-banner relative overflow-hidden rounded-2xl p-6">
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-400/30 bg-sky-500/15 text-sky-400 shadow-[0_0_24px_rgba(56,189,248,0.2)]">
                <Cloud className="h-5 w-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[19px] font-bold tracking-tight text-white">
                    谷歌云盘传输中心
                  </h2>
                  {status?.configuredAccessible ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      已挂载 {status.mountRoot || status.configuredDir}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/12 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
                      <AlertTriangle className="h-3 w-3" />
                      未检测到挂载盘
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] text-slate-400">
                  云端媒体库现有 <strong className="text-sky-300">{cloudSeriesCount}</strong> 部番剧 · 累计完成{' '}
                  <strong className="text-slate-200">{completedCount}</strong> 次传输（
                  {formatBytes(totalUploadedBytes)}） · 目标根目录{' '}
                  <span className="font-mono text-slate-300">
                    {status?.configuredDir || '未配置'}
                  </span>
                </p>
              </div>
            </div>

            {/* Buffer Capacity Bar */}
            {status?.freeBytes !== undefined && status?.totalBytes ? (
              <div className="max-w-lg space-y-1.5">
                <div className="flex items-center justify-between text-[11.5px] tabular-nums">
                  <span className="text-slate-400">
                    Google Drive 挂载盘缓冲空间（已用 {usedPct}% · 本地缓冲由客户端流式传完自动释放）
                  </span>
                  <span className="font-semibold text-sky-300">
                    可用 {formatBytes(freeBytes)} / {formatBytes(totalDiskBytes)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 transition-all duration-500"
                    style={{ width: `${Math.max(4, usedPct)}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-sky-500 px-4 text-[13px] font-semibold text-[#0B0D11] shadow-[0_6px_20px_rgba(56,189,248,0.3)] transition hover:bg-sky-400"
            >
              <Plus className="h-4 w-4" />
              选择本地番剧上传 ({localSeries.length})
            </button>

            <button
              type="button"
              disabled={checkingQueue}
              onClick={() => void handleProcessNow()}
              className="btn-ghost-dark inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium"
            >
              {checkingQueue ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 text-sky-400" />
              )}
              检测待转存
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              className="btn-ghost-dark inline-flex h-10 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium"
            >
              <Settings className="h-3.5 w-3.5 text-slate-400" />
              云盘设置
            </button>
          </div>
        </div>
      </section>

      {/* Live Telemetry Summary Strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card-elevated rounded-2xl p-4">
          <div className="flex items-center justify-between text-[12px] text-slate-400">
            <span>正在上传</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/14 text-sky-400">
              <CloudUpload className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2 tabular-nums">
            <span className="text-[24px] font-bold text-white">{activeCount}</span>
            <span className="text-[12px] text-slate-500">
              / {queuedCount > 0 ? `${queuedCount} 等待中` : `${jobs.length} 总记录`}
            </span>
          </div>
        </div>

        <div className="card-elevated rounded-2xl p-4">
          <div className="flex items-center justify-between text-[12px] text-slate-400">
            <span>写入云盘速度</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/14 text-cyan-400">
              <Cloud className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 tabular-nums text-[24px] font-bold text-sky-300">
            {totalSpeed > 0 ? formatSpeed(totalSpeed) : '0 B/s'}
          </div>
        </div>

        <div className="card-elevated rounded-2xl p-4">
          <div className="flex items-center justify-between text-[12px] text-slate-400">
            <span>已完成传输</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/14 text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2 tabular-nums">
            <span className="text-[24px] font-bold text-emerald-400">{completedCount}</span>
            <span className="text-[12px] text-slate-500">{formatBytes(totalUploadedBytes)}</span>
          </div>
        </div>

        <div className="card-elevated rounded-2xl p-4">
          <div className="flex items-center justify-between text-[12px] text-slate-400">
            <span>异常 / 已取消</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] text-slate-400">
              <Ban className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 tabular-nums text-[24px] font-bold text-slate-200">
            {failedOrCancelledCount}
          </div>
        </div>
      </section>

      {/* Filter & Search Toolbar */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="segmented-dock no-scrollbar max-w-full overflow-x-auto">
          {(
            [
              { id: 'all', label: '全部任务', count: jobs.length },
              { id: 'copying', label: '上传中', count: activeCount },
              { id: 'queued', label: '等待下完转存', count: queuedCount },
              { id: 'completed', label: '已完成', count: completedCount },
              { id: 'stopped', label: '已取消 / 失败', count: failedOrCancelledCount },
            ] as const
          ).map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] ${
                  active ? 'segmented-tab-active-sky' : 'segmented-tab font-medium'
                }`}
              >
                <span>{tab.label}</span>
                <span className="tabular-nums text-[11px] opacity-75">{tab.count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索番剧或云盘路径..."
              className="input-cinema h-9 w-full rounded-xl pr-3 pl-8 text-[12.5px]"
            />
          </div>

          {jobs.length > 0 && (
            <button
              type="button"
              onClick={() => void handleClearFinished()}
              className="btn-ghost-dark inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12px] text-slate-300"
            >
              清空非活跃记录
            </button>
          )}

          <button
            type="button"
            onClick={() => void onRefresh()}
            className="btn-ghost-dark flex h-9 w-9 items-center justify-center rounded-xl"
            title="刷新云盘队列"
            aria-label="刷新云盘队列"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
          </button>
        </div>
      </section>

      {/* Transfer Task Cards */}
      {filteredJobs.length === 0 ? (
        <div className="card-elevated space-y-5 rounded-2xl p-8">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-400/25 bg-sky-500/12 text-sky-400">
              <CloudUpload className="h-6 w-6" />
            </div>
            <h3 className="mt-3.5 text-[15px] font-semibold text-white">
              {jobs.length === 0 ? '暂无谷歌云盘上传记录' : '当前筛选条件下没有传输任务'}
            </h3>
            <p className="mt-1 max-w-lg text-[12.5px] text-slate-400">
              {jobs.length === 0
                ? '你可以直接从下方本地番剧列表中选择整部番剧一键上传到 Google Drive，或在下载确认弹窗中选择「谷歌云盘」自动转存。'
                : '切换上方的筛选标签或清空搜索关键词查看其他传输记录。'}
            </p>
          </div>

          {jobs.length === 0 && localSeries.length > 0 && (
            <div className="space-y-3 border-t border-white/[0.06] pt-5">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-semibold text-slate-200">
                  可上传到谷歌云盘的本地番剧（{localSeries.length} 部）
                </span>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="text-sky-400 hover:underline"
                >
                  查看全部
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {localSeries.slice(0, 6).map((series) => {
                  const totalBytes = series.episodes.reduce((s, e) => s + (e.sizeBytes || 0), 0);
                  return (
                    <div
                      key={series.seriesId}
                      className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-[#0B0D11]/65 p-3"
                    >
                      <PosterImage
                        url={series.coverUrl}
                        title={series.title}
                        compactFallback
                        className="cinema-dark-surface h-[60px] w-[44px] shrink-0 rounded-lg border border-white/[0.08]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-white">
                          {series.title}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                          {series.totalEpisodes} 集 · {formatBytes(totalBytes)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setUploadTarget({ kind: 'series', series, defaultDeleteLocal: true })
                          }
                          className="rounded-lg bg-sky-500/18 px-2.5 py-1.5 text-[11.5px] font-semibold text-sky-300 ring-1 ring-sky-400/30 transition hover:bg-sky-500/30"
                        >
                          上传删本地
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setUploadTarget({ kind: 'series', series, defaultDeleteLocal: false })
                          }
                          className="rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-[11.5px] font-medium text-slate-300 ring-1 ring-white/[0.09] transition hover:bg-white/[0.1]"
                        >
                          保留本地
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredJobs.map((job) => {
            const isBusy = busyJobId === job.id;
            const isCopying = job.status === 'copying';
            const isQueued = job.status === 'queued';
            const isCompleted = job.status === 'completed';
            const isCancelled = job.status === 'cancelled';
            const isFailed = job.status === 'failed';
            const isCancelling = Boolean(job.cancelling);

            const total = job.totalBytes || 0;
            const transferred = isCompleted ? total : job.transferredBytes || 0;
            const rawPct =
              isCompleted
                ? 100
                : typeof job.progress === 'number'
                  ? job.progress * 100
                  : total > 0
                    ? (transferred / total) * 100
                    : 0;
            const pct = Math.max(0, Math.min(100, rawPct));

            const accentBorder = isCopying
              ? 'border-l-sky-400'
              : isQueued
                ? 'border-l-amber-400'
                : isCompleted
                  ? 'border-l-emerald-400'
                  : isFailed
                    ? 'border-l-rose-400'
                    : 'border-l-slate-500';

            const statusBadge = isCopying
              ? isCancelling
                ? { cls: 'border-amber-400/30 bg-amber-500/15 text-amber-300', label: '正在取消...' }
                : { cls: 'border-sky-400/35 bg-sky-500/15 text-sky-300', label: '正在上传到云盘' }
              : isQueued
                ? { cls: 'border-amber-400/30 bg-amber-500/15 text-amber-300', label: '等待下载完成后转存' }
                : isCompleted
                  ? { cls: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300', label: '已存谷歌云盘' }
                  : isCancelled
                    ? { cls: 'border-slate-500/35 bg-slate-500/15 text-slate-300', label: '已取消上传' }
                    : { cls: 'border-rose-400/35 bg-rose-500/15 text-rose-300', label: '上传失败' };

            return (
              <div
                key={job.id}
                className={`card-elevated flex flex-col gap-4 rounded-2xl border-l-[3px] p-4 transition sm:flex-row sm:items-center ${accentBorder}`}
              >
                <PosterImage
                  url={job.coverUrl}
                  title={job.bangumiTitle || job.torrentName}
                  compactFallback
                  className="cinema-dark-surface hidden h-[76px] w-[54px] shrink-0 rounded-lg border border-white/[0.08] sm:block"
                />

                {/* Center Info + Progress */}
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[10.5px] font-semibold ${statusBadge.cls}`}
                    >
                      {statusBadge.label}
                    </span>
                    <span className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[10.5px] text-slate-400">
                      {job.source === 'library' ? '媒体库上传' : 'qB 自动转存'}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10.5px] font-medium ${
                        job.deleteLocalAfterMove
                          ? 'bg-sky-500/12 text-sky-300'
                          : 'bg-emerald-500/12 text-emerald-300'
                      }`}
                    >
                      {job.deleteLocalAfterMove ? '传完删本地' : '保留本地备份'}
                    </span>
                    <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-slate-100">
                      {job.bangumiTitle || job.torrentName}
                      {job.bangumiTitle && job.torrentName !== job.bangumiTitle
                        ? ` · ${job.torrentName}`
                        : ''}
                    </h3>
                  </div>

                  {/* Progress Bar */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isCompleted
                          ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                          : isFailed
                            ? 'bg-rose-500/75'
                            : isCancelled
                              ? 'bg-slate-500/60'
                              : isQueued
                                ? 'bg-amber-400/70'
                                : 'bg-gradient-to-r from-sky-500 via-cyan-400 to-sky-300'
                      }`}
                      style={{ width: `${isCopying && pct < 6 ? 6 : pct}%` }}
                    />
                  </div>

                  {/* Telemetry Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate-400 tabular-nums">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="font-semibold text-slate-200">{pct.toFixed(1)}%</span>
                      {total > 0 && (
                        <span>
                          {formatBytes(transferred)} / {formatBytes(total)}
                        </span>
                      )}
                      {job.totalFiles !== undefined && job.totalFiles > 0 && (
                        <span>
                          文件 {job.copiedFiles ?? 0} / {job.totalFiles}
                        </span>
                      )}
                      {isCopying && (job.speedBytesPerSec || 0) > 0 && (
                        <span className="font-medium text-sky-300">
                          {formatSpeed(job.speedBytesPerSec || 0)}
                        </span>
                      )}
                      {isCopying && (job.etaSeconds || 0) > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3 text-slate-500" />
                          剩余 {formatEta(job.etaSeconds || 0)}
                        </span>
                      )}
                      {isCopying && job.currentFileName && (
                        <span className="max-w-[260px] truncate font-mono text-[11px] text-sky-200/80">
                          正在复制：{job.currentFileName}
                        </span>
                      )}
                    </div>
                    <span
                      className="max-w-[300px] truncate font-mono text-[11px] text-sky-300/80"
                      title={job.cloudTargetDir}
                    >
                      → {job.cloudTargetDir}
                    </span>
                  </div>

                  {job.error && (
                    <div
                      className={`rounded-lg px-2.5 py-1.5 text-[11.5px] ${
                        isFailed
                          ? 'bg-rose-500/10 text-rose-300'
                          : isCancelled
                            ? 'bg-slate-500/10 text-slate-300'
                            : 'bg-amber-500/10 text-amber-200'
                      }`}
                    >
                      {job.error}
                    </div>
                  )}
                </div>

                {/* Action Controls */}
                <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
                  {(isCopying || isQueued) && (
                    <button
                      type="button"
                      disabled={isBusy || isCancelling}
                      onClick={() => void handleCancelJob(job)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-400/35 bg-rose-500/14 px-3 text-[12px] font-semibold text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-50"
                      title="取消上传（不会删除本地文件）"
                    >
                      {isBusy || isCancelling ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Ban className="h-3.5 w-3.5" />
                      )}
                      {isCancelling ? '取消中...' : '取消上传'}
                    </button>
                  )}

                  {(isFailed || isCancelled) && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleRetryJob(job)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-sky-400/35 bg-sky-500/15 px-3 text-[12px] font-semibold text-sky-200 transition hover:bg-sky-500/25 disabled:opacity-50"
                      title="重新上传"
                    >
                      {isBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      重新上传
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleOpenCloudFolder(job.cloudTargetDir)}
                    className="btn-ghost-dark flex h-9 w-9 items-center justify-center rounded-xl"
                    title="打开云盘目录"
                    aria-label="打开云盘目录"
                  >
                    <FolderOpen className="h-4 w-4 text-slate-300" />
                  </button>

                  {!isCopying && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleRemoveJob(job)}
                      className="btn-ghost-dark flex h-9 w-9 items-center justify-center rounded-xl hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300"
                      title="移除记录"
                      aria-label="移除记录"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Local Series Quick-Upload Picker Modal */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPickerOpen(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="animate-modal-enter glass-panel flex max-h-[82vh] w-full max-w-[660px] flex-col overflow-hidden rounded-2xl border border-white/[0.1] shadow-[0_24px_80px_rgba(0,0,0,0.88)]">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400">
                  <Film className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-white">选择本地番剧上传到谷歌云盘</h3>
                  <p className="text-[11.5px] text-slate-400">
                    共 {localSeries.length} 部尚未上云的本地番剧
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.07] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-white/[0.06] px-5 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="搜索本地番剧名称或目录..."
                  className="input-cinema h-9 w-full rounded-xl pr-3 pl-8 text-[12.5px]"
                />
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-5">
              {filteredLocalPicker.length === 0 ? (
                <div className="py-12 text-center text-[13px] text-slate-400">
                  没有符合条件的本地番剧
                </div>
              ) : (
                filteredLocalPicker.map((series) => {
                  const totalBytes = series.episodes.reduce((s, e) => s + (e.sizeBytes || 0), 0);
                  return (
                    <div
                      key={series.seriesId}
                      className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-[#0B0D11]/65 p-3 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <PosterImage
                          url={series.coverUrl}
                          title={series.title}
                          compactFallback
                          className="h-[64px] w-[48px] shrink-0 rounded-lg border border-white/[0.08]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13.5px] font-semibold text-white">
                            {series.title}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400 tabular-nums">
                            <span>{series.totalEpisodes} 集</span>
                            <span>·</span>
                            <span>{formatBytes(totalBytes)}</span>
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[10.5px] text-slate-500">
                            {series.folderPath}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => {
                            setPickerOpen(false);
                            setUploadTarget({
                              kind: 'series',
                              series,
                              defaultDeleteLocal: true,
                            });
                          }}
                          className="inline-flex h-8 items-center gap-1 rounded-lg bg-sky-500/18 px-3 text-[12px] font-semibold text-sky-300 ring-1 ring-sky-400/35 hover:bg-sky-500/30"
                        >
                          <CloudUpload className="h-3.5 w-3.5" />
                          上传并删本地
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPickerOpen(false);
                            setUploadTarget({
                              kind: 'series',
                              series,
                              defaultDeleteLocal: false,
                            });
                          }}
                          className="inline-flex h-8 items-center gap-1 rounded-lg bg-white/[0.05] px-3 text-[12px] font-medium text-slate-200 ring-1 ring-white/[0.1] hover:bg-white/[0.1]"
                        >
                          <HardDrive className="h-3.5 w-3.5 text-emerald-400" />
                          保留本地
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <CloudUploadModal
        target={uploadTarget}
        onClose={() => setUploadTarget(null)}
        onUploaded={(res, info) => {
          pushToast({
            kind: res.warning ? 'info' : 'success',
            title: res.queued
              ? info.deleteLocal
                ? '已加入云盘上传队列（传完删本地）'
                : '已加入云盘上传队列（保留本地）'
              : res.deletedLocal
                ? '已上传到谷歌云并删除本地'
                : '已上传到谷歌云（保留本地）',
            description:
              res.warning || `${info.title} · 已可在当前页面实时查看进度或取消上传`,
          });
          void onRefresh();
        }}
      />
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  FolderOpen,
  Pause,
  Play,
  Power,
  RefreshCw,
  Settings,
  Trash2,
  Loader2,
  Search,
  HardDrive,
  AlertTriangle,
  X,
  Cloud,
} from 'lucide-react';
import type {
  CloudDriveStatus,
  CloudTransferJob,
  QbConnectionStatus,
  QbControlAction,
  QbTorrentItem,
} from '@shared/types';
import { api } from '@/lib/api';
import {
  formatBytes,
  formatEta,
  formatSpeed,
  getTorrentStateMeta,
} from '@/lib/format';
import { PosterImage } from '@/components/PosterImage';
import { useToast } from '@/hooks/useToast';

interface DownloadsPageProps {
  status: QbConnectionStatus | null;
  torrents: QbTorrentItem[];
  loading: boolean;
  launching: boolean;
  activeCount: number;
  completedCount: number;
  totalDlSpeed: number;
  totalUlSpeed: number;
  onRefresh: () => Promise<void>;
  onLaunchQb: () => Promise<{ ok: boolean; error?: string }>;
  onOpenSettings: () => void;
  onOpenCloudPage?: () => void;
}

type TorrentFilter = 'all' | 'downloading' | 'completed' | 'paused';

export const DownloadsPage: React.FC<DownloadsPageProps> = ({
  status,
  torrents,
  loading,
  launching,
  activeCount,
  completedCount,
  totalDlSpeed,
  totalUlSpeed,
  onRefresh,
  onLaunchQb,
  onOpenSettings,
  onOpenCloudPage,
}) => {
  const { pushToast } = useToast();
  const [filter, setFilter] = useState<TorrentFilter>('all');
  const [search, setSearch] = useState('');
  const [busyHash, setBusyHash] = useState<string | null>(null);
  const [batchControlling, setBatchControlling] = useState<'pause' | 'resume' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QbTorrentItem | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudDriveStatus | null>(null);
  const [cloudJobs, setCloudJobs] = useState<CloudTransferJob[]>([]);

  const loadCloudData = useCallback(async () => {
    try {
      const [statusRes, jobsRes] = await Promise.all([
        api.cloudGetStatus(),
        api.cloudListJobs(),
      ]);
      setCloudStatus(statusRes);
      setCloudJobs(jobsRes);
    } catch {
      // Ignore transient error
    }
  }, []);

  useEffect(() => {
    void loadCloudData();
    const timer = setInterval(() => {
      void loadCloudData();
    }, 4000);
    return () => clearInterval(timer);
  }, [loadCloudData]);

  const connected = Boolean(status?.connected);

  const handleControl = async (torrent: QbTorrentItem, action: QbControlAction) => {
    setBusyHash(torrent.hash);
    try {
      const res = await api.qbControlTorrent(torrent.hash, action);
      if (res.ok) {
        const labels: Record<QbControlAction, string> = {
          pause: '已暂停任务',
          resume: '已恢复下载',
          delete: '已移除任务',
          deleteWithFiles: '已删除任务及本地文件',
        };
        pushToast({ kind: 'success', title: labels[action], description: torrent.name });
        await onRefresh();
      } else {
        pushToast({
          kind: 'error',
          title: '操作失败',
          description: res.error || 'qBittorrent 拒绝了该请求',
        });
      }
    } catch (err) {
      pushToast({
        kind: 'error',
        title: '控制任务出错',
        description: err instanceof Error ? err.message : '未知错误',
      });
    } finally {
      setBusyHash(null);
      setDeleteTarget(null);
    }
  };

  const handleOpenFolder = async (torrent: QbTorrentItem) => {
    const target = torrent.contentPath || torrent.savePath;
    if (!target) return;
    const res = await api.libraryOpenFolder(target);
    if (!res.ok) {
      pushToast({ kind: 'error', title: '无法打开目录', description: res.error || target });
    }
  };

  const pausableTorrents = useMemo(
    () =>
      torrents.filter(
        (t) => !getTorrentStateMeta(t.state).isPaused && t.progress < 0.999,
      ),
    [torrents],
  );

  const resumableTorrents = useMemo(
    () =>
      torrents.filter(
        (t) => getTorrentStateMeta(t.state).isPaused && t.progress < 0.999,
      ),
    [torrents],
  );

  const handleBatchControl = async (action: 'pause' | 'resume') => {
    const targets = action === 'pause' ? pausableTorrents : resumableTorrents;
    if (targets.length === 0 || batchControlling) return;
    setBatchControlling(action);
    try {
      const results = await Promise.all(
        targets.map((t) => api.qbControlTorrent(t.hash, action)),
      );
      const okCount = results.filter((r) => r.ok).length;
      pushToast({
        kind: okCount > 0 ? 'success' : 'error',
        title:
          action === 'pause'
            ? `已暂停 ${okCount} 个下载任务`
            : `已恢复 ${okCount} 个下载任务`,
      });
      await onRefresh();
    } finally {
      setBatchControlling(null);
    }
  };

  const filteredTorrents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return torrents.filter((t) => {
      const meta = getTorrentStateMeta(t.state);
      if (filter === 'downloading' && meta.category !== 'downloading') return false;
      if (filter === 'completed' && meta.category !== 'completed' && t.progress < 0.999)
        return false;
      if (filter === 'paused' && !meta.isPaused) return false;
      if (
        q &&
        !t.name.toLowerCase().includes(q) &&
        !(t.bangumiTitle && t.bangumiTitle.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });
  }, [torrents, filter, search]);

  if (!loading && !connected) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-10">
        <div className="card-elevated relative w-full max-w-[540px] overflow-hidden rounded-2xl p-8">
          <div className="pointer-events-none absolute -top-20 -right-16 h-56 w-56 rounded-full bg-[#FF7A2F]/12 blur-3xl" />

          <div className="relative flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#FF7A2F]/30 bg-[#FF7A2F]/14 text-[#FF7A2F]">
              <Power className="h-7 w-7" />
            </div>

            <h2 className="mt-5 text-[19px] font-bold tracking-tight text-white">
              本地 qBittorrent 尚未连接
            </h2>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-slate-400">
              MikanVault 通过 qBittorrent WebUI 接管番剧种子下载与进度追踪。启动本地客户端后将自动恢复队列同步。
            </p>

            {/* Diagnostic details */}
            <div className="mt-6 w-full space-y-2 rounded-xl border border-white/[0.07] bg-[#0B0D11]/70 p-4 text-left text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">本地可执行文件</span>
                <span className={status?.exeExists ? 'text-emerald-400 font-medium' : 'text-amber-300 font-medium'}>
                  {status?.exeExists ? '已检测到 qbittorrent.exe' : '未配置或路径不存在'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">客户端进程状态</span>
                <span className={status?.qbRunning ? 'text-sky-300 font-medium' : 'text-slate-300'}>
                  {status?.qbRunning ? '进程运行中（请确认 WebUI 端口与密码）' : '未运行'}
                </span>
              </div>
              {status?.error && (
                <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span className="break-all">{status.error}</span>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void onLaunchQb()}
                disabled={launching}
                className="btn-mikan inline-flex h-10 items-center gap-2 rounded-xl px-5 text-[13.5px]"
              >
                {launching ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在启动并连接...
                  </>
                ) : (
                  <>
                    <Power className="h-4 w-4" />
                    一键启动本地 qBittorrent
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => void onRefresh()}
                className="btn-ghost-dark inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-medium"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重新检测
              </button>
              <button
                type="button"
                onClick={onOpenSettings}
                className="btn-ghost-dark inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-medium"
              >
                <Settings className="h-3.5 w-3.5" />
                前往设置
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1360px] space-y-6 px-6 py-6 pb-14">
      {/* Telemetry Summary Strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card-elevated rounded-2xl p-4">
          <div className="flex items-center justify-between text-[12px] text-slate-400">
            <span>活跃下载</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#FF7A2F]/14 text-[#FF7A2F]">
              <Download className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="tabular-nums text-[24px] font-bold text-white">{activeCount}</span>
            <span className="text-[12px] text-slate-500">/ {torrents.length} 总任务</span>
          </div>
        </div>

        <div className="card-elevated rounded-2xl p-4">
          <div className="flex items-center justify-between text-[12px] text-slate-400">
            <span>总下载速度</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#38BDF8]/14 text-[#38BDF8]">
              <ArrowDown className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 tabular-nums text-[24px] font-bold text-[#38BDF8]">
            {formatSpeed(totalDlSpeed)}
          </div>
        </div>

        <div className="card-elevated rounded-2xl p-4">
          <div className="flex items-center justify-between text-[12px] text-slate-400">
            <span>总上传速度</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.06] text-slate-400">
              <ArrowUp className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 tabular-nums text-[24px] font-bold text-slate-200">
            {formatSpeed(totalUlSpeed)}
          </div>
        </div>

        <div className="card-elevated rounded-2xl p-4">
          <div className="flex items-center justify-between text-[12px] text-slate-400">
            <span>已完成任务</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#22C55E]/14 text-[#22C55E]">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 tabular-nums text-[24px] font-bold text-[#22C55E]">
            {completedCount}
          </div>
        </div>
      </section>

      {/* Compact Google Drive Offload Entry Bar */}
      {(cloudJobs.length > 0 || cloudStatus?.detected) && (
        <section className="card-elevated flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-400/20 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
              <Cloud className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[13.5px] font-semibold text-white">谷歌云盘传输中心</h3>
                {cloudStatus?.detected && cloudStatus.freeBytes !== undefined && (
                  <span className="rounded-md bg-sky-500/12 px-2 py-0.5 text-[11px] text-sky-300 tabular-nums">
                    {cloudStatus.mountRoot} · 缓冲可用 {formatBytes(cloudStatus.freeBytes)}
                  </span>
                )}
              </div>
              <p className="text-[11.5px] text-slate-400 tabular-nums">
                {cloudJobs.length === 0
                  ? '在下载弹窗勾选「谷歌云盘」后，种子下完将自动转存到云端'
                  : `进行中 ${cloudJobs.filter((j) => j.status === 'copying').length} · 等待转存 ${cloudJobs.filter((j) => j.status === 'queued').length} · 已完成 ${cloudJobs.filter((j) => j.status === 'completed').length}`}
              </p>
            </div>
          </div>

          {onOpenCloudPage && (
            <button
              type="button"
              onClick={onOpenCloudPage}
              className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-sky-400/35 bg-sky-500/14 px-3.5 text-[12px] font-semibold text-sky-200 transition hover:bg-sky-500/25"
            >
              前往云盘上传界面 →
            </button>
          )}
        </section>
      )}

      {/* Filter & Search Bar */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: '全部任务', count: torrents.length },
              { id: 'downloading', label: '下载中', count: activeCount },
              { id: 'completed', label: '已完成', count: completedCount },
              {
                id: 'paused',
                label: '已暂停',
                count: torrents.filter((t) => getTorrentStateMeta(t.state).isPaused).length,
              },
            ] as const
          ).map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition ${
                  active
                    ? 'bg-[#FF7A2F] font-semibold text-[#0B0D11]'
                    : 'border border-white/[0.07] bg-[#12151C] text-slate-300 hover:bg-[#181C26] hover:text-white'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`tabular-nums text-[11px] ${
                    active ? 'opacity-80' : 'text-slate-500'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {pausableTorrents.length > 0 && (
            <button
              type="button"
              onClick={() => void handleBatchControl('pause')}
              disabled={batchControlling !== null}
              className="btn-ghost-dark inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12px] font-medium"
            >
              {batchControlling === 'pause' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Pause className="h-3.5 w-3.5 text-amber-300" />
              )}
              全部暂停
            </button>
          )}
          {resumableTorrents.length > 0 && (
            <button
              type="button"
              onClick={() => void handleBatchControl('resume')}
              disabled={batchControlling !== null}
              className="btn-ghost-dark inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12px] font-medium"
            >
              {batchControlling === 'resume' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 text-[#22C55E]" />
              )}
              全部恢复
            </button>
          )}
          <div className="relative flex-1 sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="筛选种子名称..."
              className="input-cinema h-9 w-full rounded-xl pr-3 pl-8 text-[12.5px]"
            />
          </div>
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="btn-ghost-dark flex h-9 w-9 items-center justify-center rounded-xl"
            title="立即刷新队列"
            aria-label="立即刷新队列"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </section>

      {/* Torrent Queue List */}
      {filteredTorrents.length === 0 ? (
        <div className="card-elevated flex flex-col items-center justify-center rounded-2xl py-16 text-center">
          <HardDrive className="h-9 w-9 text-slate-600" />
          <p className="mt-3 text-[14.5px] font-medium text-slate-300">
            {torrents.length === 0 ? '当前下载队列为空' : '没有符合条件的下载任务'}
          </p>
          <p className="mt-1 text-[12.5px] text-slate-500">
            前往「番剧探索」或「最新更新」挑选新番种子添加到队列
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTorrents.map((t) => {
            const meta = getTorrentStateMeta(t.state);
            const pct = Math.min(100, Math.max(0, (t.progress || 0) * 100));
            const isComplete = pct >= 99.9 || meta.category === 'completed';
            const isBusy = busyHash === t.hash;

            const badgeClass =
              meta.category === 'downloading'
                ? 'bg-[#38BDF8]/15 text-[#38BDF8] border-[#38BDF8]/25'
                : meta.category === 'completed'
                  ? 'bg-[#22C55E]/15 text-[#22C55E] border-[#22C55E]/25'
                  : meta.category === 'paused'
                    ? 'bg-amber-500/15 text-amber-300 border-amber-400/25'
                    : meta.category === 'error'
                      ? 'bg-rose-500/15 text-rose-300 border-rose-400/25'
                      : 'bg-white/[0.06] text-slate-300 border-white/[0.09]';

            return (
              <div
                key={t.hash}
                className="card-elevated group flex flex-col gap-4 rounded-2xl p-4 transition hover:border-white/[0.12] sm:flex-row sm:items-center"
              >
                {/* Cover Thumbnail */}
                <PosterImage
                  url={t.coverUrl}
                  title={t.bangumiTitle || t.name}
                  compactFallback
                  className="cinema-dark-surface hidden h-[76px] w-[57px] shrink-0 rounded-xl border border-white/[0.08] sm:block"
                />

                {/* Center Info & Progress */}
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[10.5px] font-semibold ${badgeClass}`}
                    >
                      {meta.label}
                    </span>
                    {t.category && (
                      <span className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[10.5px] text-slate-400">
                        {t.category}
                      </span>
                    )}
                    <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-slate-100">
                      {t.name}
                    </h3>
                  </div>

                  {/* Animated Progress Bar */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isComplete
                          ? 'bg-gradient-to-r from-[#16A34A] to-[#22C55E]'
                          : meta.isPaused
                            ? 'bg-amber-400/75'
                            : 'progress-active-bar'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {/* Telemetry Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate-400 tabular-nums">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="font-semibold text-slate-200">{pct.toFixed(1)}%</span>
                      <span>
                        {formatBytes(t.downloaded ?? Math.round((t.size || 0) * (t.progress || 0)))} /{' '}
                        {formatBytes(t.size)}
                      </span>
                      {!isComplete && (
                        <span className="flex items-center gap-1 text-[#38BDF8] font-medium">
                          <ArrowDown className="h-3 w-3" />
                          {formatSpeed(t.dlspeed)}
                        </span>
                      )}
                      {t.upspeed > 0 && (
                        <span className="flex items-center gap-1 text-slate-400">
                          <ArrowUp className="h-3 w-3" />
                          {formatSpeed(t.upspeed)}
                        </span>
                      )}
                      {!isComplete && <span>剩余 {formatEta(t.eta)}</span>}
                      {typeof t.ratio === 'number' && <span>分享率 {t.ratio.toFixed(2)}</span>}
                    </div>
                    <span className="hidden max-w-[260px] truncate font-mono text-[11px] text-slate-500 xl:inline">
                      {t.savePath}
                    </span>
                  </div>
                </div>

                {/* Action Controls */}
                <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleControl(t, meta.isPaused ? 'resume' : 'pause')}
                    className="btn-ghost-dark flex h-9 w-9 items-center justify-center rounded-xl"
                    title={meta.isPaused ? '恢复下载' : '暂停下载'}
                    aria-label={meta.isPaused ? '恢复下载' : '暂停下载'}
                  >
                    {isBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin text-[#FF7A2F]" />
                    ) : meta.isPaused ? (
                      <Play className="h-4 w-4 text-[#22C55E]" />
                    ) : (
                      <Pause className="h-4 w-4 text-slate-300" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleOpenFolder(t)}
                    className="btn-ghost-dark flex h-9 w-9 items-center justify-center rounded-xl"
                    title="打开保存文件夹"
                    aria-label="打开保存文件夹"
                  >
                    <FolderOpen className="h-4 w-4 text-slate-300" />
                  </button>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setDeleteTarget(t)}
                    className="btn-ghost-dark flex h-9 w-9 items-center justify-center rounded-xl hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300"
                    title="删除任务"
                    aria-label="删除任务"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDeleteTarget(null);
          }}
        >
          <div className="animate-modal-enter glass-panel w-full max-w-[430px] rounded-2xl border border-white/[0.1] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400">
                  <Trash2 className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-white">移除下载任务</h3>
                  <p className="text-[12px] text-slate-400">选择是否同时删除磁盘上的影片文件</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/[0.06] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-4 rounded-xl border border-white/[0.06] bg-[#0B0D11]/70 px-3.5 py-2.5 text-[12.5px] text-slate-200 break-all">
              {deleteTarget.name}
            </p>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="btn-ghost-dark h-9 rounded-xl px-3.5 text-[12.5px]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleControl(deleteTarget, 'delete')}
                className="btn-ghost-dark h-9 rounded-xl border-amber-400/30 bg-amber-500/10 px-3.5 text-[12.5px] font-medium text-amber-200 hover:bg-amber-500/20"
              >
                仅移除记录
              </button>
              <button
                type="button"
                onClick={() => void handleControl(deleteTarget, 'deleteWithFiles')}
                className="h-9 rounded-xl bg-rose-500/90 px-3.5 text-[12.5px] font-semibold text-white transition hover:bg-rose-500"
              >
                删除任务与文件
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

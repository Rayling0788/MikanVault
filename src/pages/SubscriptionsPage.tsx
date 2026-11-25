import React, { useCallback, useEffect, useState } from 'react';
import {
  BellRing,
  RefreshCw,
  Trash2,
  Pencil,
  ExternalLink,
  FolderOpen,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Pause,
  Play,
  Loader2,
  Sparkles,
  History,
  Languages,
} from 'lucide-react';
import type {
  AppSettings,
  SubscriptionItem,
  SubscriptionLogEntry,
} from '@shared/types';
import { getSubtitleLanguageLabel } from '@shared/subtitleLanguage';
import { api } from '@/lib/api';
import { formatRelativeDate } from '@/lib/format';
import { PosterImage } from '@/components/PosterImage';
import { useToast } from '@/hooks/useToast';

interface SubscriptionsPageProps {
  subscriptions: SubscriptionItem[];
  settings: AppSettings | null;
  onRefreshSubscriptions: () => Promise<void>;
  onEditSubscription: (sub: SubscriptionItem) => void;
  onOpenBangumi: (bangumiId: string, title?: string, coverUrl?: string) => void;
  onUpdateInterval: (minutes: number) => Promise<void>;
}

const INTERVAL_OPTIONS = [5, 15, 30, 60];

export const SubscriptionsPage: React.FC<SubscriptionsPageProps> = ({
  subscriptions,
  settings,
  onRefreshSubscriptions,
  onEditSubscription,
  onOpenBangumi,
  onUpdateInterval,
}) => {
  const { pushToast } = useToast();
  const [logs, setLogs] = useState<SubscriptionLogEntry[]>([]);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    try {
      const list = await api.subGetLogs();
      setLogs(Array.isArray(list) ? list : []);
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs, subscriptions]);

  const activeCount = subscriptions.filter((s) => s.enabled).length;
  const intervalMin = settings?.subscriptionCheckIntervalMin || 15;

  const handleCheckAll = async () => {
    if (checkingAll) return;
    setCheckingAll(true);
    try {
      const res = await api.subCheckNow();
      await onRefreshSubscriptions();
      await loadLogs();
      if (res.checkedCount === 0) {
        pushToast({ kind: 'info', title: '暂无已启用的订阅任务' });
      } else if (res.newDownloads > 0) {
        pushToast({
          kind: 'success',
          title: `发现并添加 ${res.newDownloads} 个新剧集`,
          description: '已自动发送至 qBittorrent 下载队列',
        });
      } else if (res.errors > 0) {
        pushToast({
          kind: 'error',
          title: `检查完成，但有 ${res.errors} 项出现异常`,
          description: res.items.find((i) => i.error)?.error,
        });
      } else {
        pushToast({
          kind: 'info',
          title: '已是最新进度',
          description: `已检查 ${res.checkedCount} 个订阅，暂未发现新更新`,
        });
      }
    } finally {
      setCheckingAll(false);
    }
  };

  const handleCheckOne = async (sub: SubscriptionItem) => {
    setCheckingId(sub.id);
    try {
      const res = await api.subCheckNow(sub.id);
      await onRefreshSubscriptions();
      await loadLogs();
      const itemRes = res.items[0];
      if (itemRes?.added > 0) {
        pushToast({
          kind: 'success',
          title: `${sub.bangumiTitle} 新增 ${itemRes.added} 集`,
          description: '已自动推送至 qBittorrent',
        });
      } else if (itemRes?.error) {
        pushToast({
          kind: 'error',
          title: '检查更新失败',
          description: itemRes.error,
        });
      } else {
        pushToast({
          kind: 'info',
          title: `${sub.bangumiTitle} 暂无新集`,
        });
      }
    } finally {
      setCheckingId(null);
    }
  };

  const handleToggleEnabled = async (sub: SubscriptionItem) => {
    setTogglingId(sub.id);
    try {
      await api.subUpsert({
        id: sub.id,
        bangumiId: sub.bangumiId,
        bangumiTitle: sub.bangumiTitle,
        coverUrl: sub.coverUrl,
        subgroupId: sub.subgroupId,
        subgroupName: sub.subgroupName,
        rssUrl: sub.rssUrl,
        savePath: sub.savePath,
        category: sub.category,
        startAfterEpisode: sub.startAfterEpisode,
        includeKeywords: sub.includeKeywords,
        excludeKeywords: sub.excludeKeywords,
        enabled: !sub.enabled,
      });
      await onRefreshSubscriptions();
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (sub: SubscriptionItem) => {
    const res = await api.subDelete(sub.id);
    if (res.ok) {
      pushToast({
        kind: 'info',
        title: '已取消自动追更订阅',
        description: `${sub.bangumiTitle} (${sub.subgroupName})`,
      });
      await onRefreshSubscriptions();
    }
  };

  return (
    <div className="mx-auto max-w-[1320px] space-y-6 px-6 py-6 pb-14">
      {/* Header Toolbar */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-[20px] font-bold tracking-tight text-white">自动追更订阅</h2>
          <p className="mt-1 text-[12.5px] text-slate-400 tabular-nums">
            {activeCount} 个追更中 · 共 {subscriptions.length} 个订阅 · 自动跳过已下载集数并推送新更新
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#12151C] px-3 py-1.5 text-[12px] text-slate-300">
            <Clock className="h-3.5 w-3.5 text-[#FF7A2F]" />
            <span className="text-slate-400">检查周期：</span>
            <select
              aria-label="自动检查间隔"
              value={intervalMin}
              onChange={(e) => void onUpdateInterval(Number(e.target.value))}
              className="bg-transparent font-medium text-white focus:outline-none"
            >
              {INTERVAL_OPTIONS.map((m) => (
                <option key={m} value={m} className="bg-[#12151C] text-slate-100">
                  每 {m} 分钟
                </option>
              ))}
              {!INTERVAL_OPTIONS.includes(intervalMin) && (
                <option value={intervalMin} className="bg-[#12151C] text-slate-100">
                  每 {intervalMin} 分钟
                </option>
              )}
            </select>
          </div>

          <button
            type="button"
            onClick={() => void handleCheckAll()}
            disabled={checkingAll || subscriptions.length === 0}
            className="btn-mikan inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[12.5px] disabled:opacity-50"
          >
            {checkingAll ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {checkingAll ? '正在检查...' : '立即检查全部'}
          </button>
        </div>
      </section>

      {/* Subscriptions List or Empty State */}
      {subscriptions.length === 0 ? (
        <div className="card-elevated flex flex-col items-center justify-center rounded-2xl px-6 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#FF7A2F]/25 bg-[#FF7A2F]/12 text-[#FF7A2F]">
            <BellRing className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-[16px] font-semibold text-white">还没有自动追更订阅</h3>
          <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-slate-400">
            在任意<strong className="text-slate-200">番剧详情页</strong>或<strong className="text-slate-200">我的媒体库</strong>里点击「订阅追更」，即可自动识别本地已下载到的集数（例如已下第 1–7 集），并在后续有第 8 集更新时自动发送给 qBittorrent 下载。
          </p>
        </div>
      ) : (
        <section className="space-y-3">
          {subscriptions.map((sub) => {
            const isChecking = checkingId === sub.id;
            const isToggling = togglingId === sub.id;

            return (
              <div
                key={sub.id}
                className={`card-elevated flex flex-col gap-4 rounded-2xl p-4 transition sm:flex-row sm:items-center ${
                  sub.enabled ? 'border-white/[0.08]' : 'opacity-65'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onOpenBangumi(sub.bangumiId, sub.bangumiTitle, sub.coverUrl)}
                  className="shrink-0 self-start overflow-hidden rounded-xl border border-white/[0.1] transition hover:border-[#FF7A2F]/50 sm:self-center"
                >
                  <PosterImage
                    url={sub.coverUrl}
                    title={sub.bangumiTitle}
                    compactFallback
                    className="h-[108px] w-[81px]"
                  />
                </button>

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenBangumi(sub.bangumiId, sub.bangumiTitle, sub.coverUrl)}
                      className="truncate text-left text-[15.5px] font-semibold text-white hover:text-[#FF9E4F]"
                    >
                      {sub.bangumiTitle}
                    </button>
                    <span className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-0.5 text-[11px] font-medium text-slate-200">
                      {sub.subgroupName}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                        sub.enabled
                          ? 'bg-[#22C55E]/15 text-emerald-300 ring-1 ring-[#22C55E]/25'
                          : 'bg-slate-500/15 text-slate-400 ring-1 ring-white/[0.08]'
                      }`}
                    >
                      {sub.enabled ? '自动追更中' : '已暂停'}
                    </span>
                  </div>

                  {/* Rule Pills */}
                  <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                    <span className="inline-flex items-center gap-1 rounded-md border border-[#FF7A2F]/30 bg-[#FF7A2F]/12 px-2 py-0.5 font-medium text-[#FF9E4F] tabular-nums">
                      <Sparkles className="h-3 w-3" />
                      {sub.startAfterEpisode > 0
                        ? `跳过 ≤ 第 ${sub.startAfterEpisode} 集 · 从第 ${sub.startAfterEpisode + 1} 集起追更`
                        : '追更该字幕组全部集数'}
                    </span>
                    {sub.languageFilter && sub.languageFilter !== 'all' && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-violet-400/30 bg-violet-500/14 px-2 py-0.5 text-violet-200">
                        <Languages className="h-3 w-3" />
                        语言：{getSubtitleLanguageLabel(sub.languageFilter)}
                      </span>
                    )}
                    {sub.includeKeywords && (
                      <span className="rounded-md border border-[#38BDF8]/25 bg-[#38BDF8]/10 px-2 py-0.5 text-sky-300">
                        包含：{sub.includeKeywords}
                      </span>
                    )}
                    {sub.excludeKeywords && (
                      <span className="rounded-md border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-rose-300">
                        排除：{sub.excludeKeywords}
                      </span>
                    )}
                  </div>

                  {/* Telemetry */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-slate-400 tabular-nums">
                    <span className="truncate font-mono text-[11px] text-slate-500" title={sub.savePath}>
                      保存：{sub.savePath}
                    </span>
                    <span>已自动推送 {sub.totalAutoDownloaded} 集</span>
                    {sub.lastDownloadedEpisode && (
                      <span>最新推至第 {sub.lastDownloadedEpisode} 集</span>
                    )}
                    <span>
                      上次检查：{sub.lastCheckedAt ? formatRelativeDate(sub.lastCheckedAt) : '尚未检查'}
                    </span>
                  </div>

                  {sub.lastError && (
                    <div className="flex items-center gap-1.5 text-[11.5px] text-amber-300">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{sub.lastError}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex shrink-0 flex-wrap items-center gap-2 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => void handleCheckOne(sub)}
                    disabled={isChecking || checkingAll}
                    className="btn-ghost-dark inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium"
                    title="立即检查该订阅"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 text-[#38BDF8] ${isChecking ? 'animate-spin' : ''}`} />
                    检查
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleToggleEnabled(sub)}
                    disabled={isToggling}
                    className="btn-ghost-dark flex h-8 w-8 items-center justify-center rounded-lg"
                    title={sub.enabled ? '暂停订阅' : '恢复订阅'}
                  >
                    {sub.enabled ? (
                      <Pause className="h-3.5 w-3.5 text-amber-300" />
                    ) : (
                      <Play className="h-3.5 w-3.5 text-[#22C55E]" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onEditSubscription(sub)}
                    className="btn-ghost-dark flex h-8 w-8 items-center justify-center rounded-lg"
                    title="编辑规则"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => void api.libraryOpenFolder(sub.savePath)}
                    className="btn-ghost-dark flex h-8 w-8 items-center justify-center rounded-lg"
                    title="打开保存文件夹"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenBangumi(sub.bangumiId, sub.bangumiTitle, sub.coverUrl)}
                    className="btn-ghost-dark flex h-8 w-8 items-center justify-center rounded-lg"
                    title="打开番剧详情"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleDelete(sub)}
                    className="btn-ghost-dark flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:border-rose-500/35 hover:bg-rose-500/15 hover:text-rose-300"
                    title="取消订阅"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Recent Auto-Subscription Logs */}
      {logs.length > 0 && (
        <section className="card-elevated rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-white">
            <History className="h-4 w-4 text-[#38BDF8]" />
            <span>最近自动追更日志</span>
          </div>
          <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
            {logs.slice(0, 20).map((log) => (
              <div
                key={log.id}
                className="flex flex-col gap-1 rounded-xl border border-white/[0.06] bg-[#0B0D11]/60 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {log.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#22C55E]" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-medium text-slate-200">
                      {log.releaseTitle}
                    </div>
                    <div className="truncate text-[11px] text-slate-400">{log.message}</div>
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">
                  {formatRelativeDate(log.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

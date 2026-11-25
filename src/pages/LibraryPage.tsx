import React, { useMemo, useState } from 'react';
import {
  RefreshCw,
  Search,
  Film,
  Settings,
  CheckCircle2,
  FolderSearch,
  Sparkles,
  RotateCcw,
  FolderOpen,
  Trash2,
  Star,
  Loader2,
  Play,
  BellRing,
  Cloud,
  CloudUpload,
} from 'lucide-react';
import type { LibrarySeries } from '@shared/types';
import { api } from '@/lib/api';
import { PosterImage } from '@/components/PosterImage';
import { ContextMenu, type ContextMenuItem } from '@/components/ContextMenu';
import { ScrapeSeriesModal } from '@/components/ScrapeSeriesModal';
import { RemoveConfirmModal, type RemoveTarget } from '@/components/RemoveConfirmModal';
import { CloudUploadModal, type CloudUploadTarget } from '@/components/CloudUploadModal';
import { useToast } from '@/hooks/useToast';

interface LibraryPageProps {
  seriesList: LibrarySeries[];
  scanning: boolean;
  hiddenCount: number;
  onScan: () => void;
  onRefreshLibrary: () => Promise<void>;
  onRestoreHidden: () => Promise<void>;
  onOpenSeries: (series: LibrarySeries) => void;
  onOpenSettings: () => void;
  onRequestSubscribe?: (series: LibrarySeries) => void;
  onCloudUploaded?: () => void;
}

export const LibraryPage: React.FC<LibraryPageProps> = ({
  seriesList,
  scanning,
  hiddenCount,
  onScan,
  onRefreshLibrary,
  onRestoreHidden,
  onOpenSeries,
  onOpenSettings,
  onRequestSubscribe,
  onCloudUploaded,
}) => {
  const { pushToast } = useToast();
  const [filter, setFilter] = useState('');
  const [scrapingAll, setScrapingAll] = useState(false);
  const [contextState, setContextState] = useState<{
    x: number;
    y: number;
    series: LibrarySeries;
  } | null>(null);
  const [scrapeTarget, setScrapeTarget] = useState<LibrarySeries | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [uploadTarget, setUploadTarget] = useState<CloudUploadTarget | null>(null);

  const totals = useMemo(() => {
    let episodes = 0;
    let watched = 0;
    let unscraped = 0;
    for (const s of seriesList) {
      episodes += s.totalEpisodes;
      watched += s.watchedCount;
      if (!s.scrapedAt && !s.coverUrl) {
        unscraped += 1;
      }
    }
    return { seriesCount: seriesList.length, episodes, watched, unscraped };
  }, [seriesList]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return seriesList;
    return seriesList.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.originalTitle && s.originalTitle.toLowerCase().includes(q)) ||
        s.folderPath.toLowerCase().includes(q)
    );
  }, [seriesList, filter]);

  const handleScrapeAll = async () => {
    if (scrapingAll) return;
    setScrapingAll(true);
    try {
      const res = await api.libraryScrapeAll(false);
      await onRefreshLibrary();
      if (res.matched === 0 && res.failed === 0) {
        pushToast({
          kind: 'info',
          title: '所有番剧均已刮削',
          description: '右键任意海报可单独重新匹配封面与元数据',
        });
      } else {
        pushToast({
          kind: res.matched > 0 ? 'success' : 'error',
          title: `媒体库刮削完成：成功 ${res.matched} 部`,
          description:
            res.failed > 0
              ? `另有 ${res.failed} 部未自动匹配，可右键卡片手动搜番匹配`
              : `已更新封面与番剧信息（跳过 ${res.skipped} 部已刮削）`,
        });
      }
    } catch (err) {
      pushToast({
        kind: 'error',
        title: '批量刮削失败',
        description: err instanceof Error ? err.message : '请检查网络连接',
      });
    } finally {
      setScrapingAll(false);
    }
  };

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!contextState) return [];
    const { series } = contextState;
    return [
      {
        id: 'open',
        label: '打开剧集列表',
        icon: <Play className="h-3.5 w-3.5 text-[#FF9E4F]" />,
        onClick: () => onOpenSeries(series),
      },
      {
        id: 'scrape',
        label: '刮削 / 匹配元数据',
        icon: <Sparkles className="h-3.5 w-3.5 text-[#38BDF8]" />,
        onClick: () => setScrapeTarget(series),
      },
      ...(series.bangumiId && onRequestSubscribe
        ? [
            {
              id: 'subscribe',
              label: '订阅后续自动追更',
              icon: <BellRing className="h-3.5 w-3.5 text-[#FF9E4F]" />,
              onClick: () => onRequestSubscribe(series),
            },
          ]
        : []),
      {
        id: 'folder',
        label: '打开本地文件夹',
        icon: <FolderOpen className="h-3.5 w-3.5 text-slate-400" />,
        onClick: () => {
          void api.libraryOpenFolder(series.folderPath).then((res) => {
            if (!res.ok) {
              pushToast({ kind: 'error', title: '无法打开目录', description: res.error });
            }
          });
        },
      },
      ...(!series.isCloud
        ? [
            {
              id: 'cloud-upload-move',
              label: '上传到谷歌云（并删除本地）',
              icon: <CloudUpload className="h-3.5 w-3.5 text-sky-400" />,
              dividerBefore: true,
              onClick: () =>
                setUploadTarget({ kind: 'series', series, defaultDeleteLocal: true }),
            },
            {
              id: 'cloud-upload-keep',
              label: '上传到谷歌云（保留本地）',
              icon: <Cloud className="h-3.5 w-3.5 text-emerald-400" />,
              onClick: () =>
                setUploadTarget({ kind: 'series', series, defaultDeleteLocal: false }),
            },
          ]
        : []),
      {
        id: 'remove',
        label: '从媒体库移除',
        icon: <Trash2 className="h-3.5 w-3.5" />,
        danger: true,
        dividerBefore: true,
        onClick: () => setRemoveTarget({ kind: 'series', series }),
      },
    ];
  }, [contextState, onOpenSeries, onRequestSubscribe, pushToast]);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-6 pb-14">
      {/* Header Toolbar */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-[20px] font-bold tracking-tight text-white">本地番剧媒体库</h2>
          <p className="mt-1 text-[12.5px] text-slate-400 tabular-nums">
            {totals.seriesCount} 部番剧 · {totals.episodes} 集影片 · 已观看 {totals.watched} 集
            <span className="ml-2 text-slate-500">· 右键卡片可刮削元数据、上传到谷歌云或移除</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 sm:w-56">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索本地番剧..."
              className="input-cinema h-9 w-full rounded-xl pr-3 pl-8 text-[12.5px]"
            />
          </div>

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => void onRestoreHidden()}
              className="btn-ghost-dark inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-medium"
            >
              <RotateCcw className="h-3.5 w-3.5 text-slate-300" />
              恢复已移除 ({hiddenCount})
            </button>
          )}

          {seriesList.length > 0 && (
            <button
              type="button"
              onClick={() => void handleScrapeAll()}
              disabled={scrapingAll || scanning}
              className="btn-ghost-dark inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border-[#FF7A2F]/35 bg-[#FF7A2F]/12 px-3.5 text-[12.5px] font-medium text-[#FF9E4F] hover:bg-[#FF7A2F]/22 disabled:opacity-60"
            >
              {scrapingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {scrapingAll
                ? '正在刮削...'
                : totals.unscraped > 0
                  ? `一键刮削 (${totals.unscraped})`
                  : '一键刮削'}
            </button>
          )}

          <button
            type="button"
            onClick={onScan}
            disabled={scanning}
            className="btn-mikan inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-4 text-[12.5px]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? '正在扫描...' : '扫描媒体库'}
          </button>
        </div>
      </section>

      {/* Series Poster Grid or Empty State */}
      {scanning && seriesList.length === 0 ? (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="skeleton-shimmer aspect-[3/4] rounded-[14px] border border-white/[0.05]"
            />
          ))}
        </div>
      ) : seriesList.length === 0 ? (
        <div className="card-elevated flex flex-col items-center justify-center rounded-2xl py-20 px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-[#FF7A2F]">
            <FolderSearch className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-[16px] font-semibold text-white">尚未扫描到本地番剧影片</h3>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-slate-400">
            完成下载的番剧会自动按目录聚合展示。你也可以在偏好设置中添加已有的本地动漫文件夹，一键刮削封面信息并调用本地播放器观看。
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onScan}
              disabled={scanning}
              className="btn-mikan inline-flex h-10 items-center gap-2 rounded-xl px-5 text-[13px]"
            >
              <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
              立即扫描目录
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              className="btn-ghost-dark inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-medium"
            >
              <Settings className="h-4 w-4" />
              配置媒体库目录
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-elevated flex flex-col items-center justify-center rounded-2xl py-16 text-center">
          <Film className="h-8 w-8 text-slate-600" />
          <p className="mt-3 text-[14px] text-slate-300">未找到匹配“{filter}”的本地番剧</p>
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {filtered.map((series) => {
            const pct =
              series.totalEpisodes > 0
                ? Math.min(100, Math.round((series.watchedCount / series.totalEpisodes) * 100))
                : 0;
            const allWatched =
              series.totalEpisodes > 0 && series.watchedCount >= series.totalEpisodes;

            return (
              <button
                key={series.seriesId}
                type="button"
                onClick={() => onOpenSeries(series)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextState({ x: e.clientX, y: e.clientY, series });
                }}
                className="poster-card group aspect-[3/4] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A2F]"
              >
                <PosterImage
                  url={series.coverUrl}
                  title={series.title}
                  className="h-full w-full"
                  imgClassName="poster-img"
                />

                {/* Top Badges */}
                <div className="pointer-events-none absolute top-2.5 right-2.5 left-2.5 flex items-center justify-between gap-2">
                  {allWatched ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#22C55E]/90 px-2 py-0.5 text-[10px] font-bold text-[#0B0D11]">
                      <CheckCircle2 className="h-3 w-3" />
                      已看完
                    </span>
                  ) : series.rating ? (
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-[#0B0D11]/80 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-300 backdrop-blur-md tabular-nums">
                      <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                      {series.rating.toFixed(1)}
                    </span>
                  ) : !series.scrapedAt && !series.coverUrl ? (
                    <span className="rounded-md border border-white/[0.1] bg-[#0B0D11]/75 px-2 py-0.5 text-[10px] font-medium text-slate-400 backdrop-blur-md">
                      未刮削
                    </span>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-1">
                    {series.isCloud && (
                      <span
                        title={`谷歌云盘目录：${series.folderPath}`}
                        className="inline-flex items-center gap-1 rounded-md border border-sky-400/35 bg-[#0B0D11]/85 px-1.5 py-0.5 text-[10px] font-medium text-sky-300 backdrop-blur-md"
                      >
                        <Cloud className="h-2.5 w-2.5" />
                        云盘
                      </span>
                    )}
                    <span className="tabular-nums rounded-md border border-white/[0.1] bg-[#0B0D11]/80 px-2 py-0.5 text-[10.5px] font-semibold text-slate-200 backdrop-blur-md">
                      {series.totalEpisodes} 集
                    </span>
                  </div>
                </div>

                {/* Bottom Caption & Progress Bar */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#080A0E] via-[#0B0D11]/92 to-transparent px-3 pt-14 pb-3">
                  <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-white transition-colors group-hover:text-[#FF9E4F]">
                    {series.title}
                  </h3>

                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
                      <span>观看进度</span>
                      <span className={allWatched ? 'text-[#22C55E] font-medium' : 'text-slate-300'}>
                        {series.watchedCount} / {series.totalEpisodes} 集
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.12]">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          allWatched
                            ? 'bg-[#22C55E]'
                            : 'bg-gradient-to-r from-[#FF7A2F] to-[#FF9E4F]'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </section>
      )}

      {contextState && (
        <ContextMenu
          x={contextState.x}
          y={contextState.y}
          items={contextMenuItems}
          onClose={() => setContextState(null)}
        />
      )}

      <ScrapeSeriesModal
        series={scrapeTarget}
        onClose={() => setScrapeTarget(null)}
        onScraped={(res) => {
          pushToast({
            kind: 'success',
            title: '刮削元数据成功',
            description: res.matchedTitle ? `已匹配：${res.matchedTitle}` : '封面与信息已更新',
          });
          void onRefreshLibrary();
        }}
      />

      <RemoveConfirmModal
        target={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onRemoved={({ deletedFiles, title }) => {
          pushToast({
            kind: 'info',
            title: deletedFiles ? '已移除并移入回收站' : '已从媒体库移除',
            description: title,
          });
          void onRefreshLibrary();
        }}
      />

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
              res.warning ||
              `${info.title} · 可前往左侧「云盘上传」查看实时进度或取消`,
          });
          onCloudUploaded?.();
          void onRefreshLibrary();
        }}
      />
    </div>
  );
};

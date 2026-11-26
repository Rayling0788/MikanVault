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
import type { LibraryEpisode, LibrarySeries } from '@shared/types';
import { api } from '@/lib/api';
import { formatEpisodeLabel } from '@/lib/format';
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

type LibraryFilterTab = 'all' | 'watching' | 'local' | 'cloud' | 'completed';

function findNextUnwatchedEpisode(series: LibrarySeries): LibraryEpisode | null {
  const sorted = [...series.episodes].sort((a, b) => {
    const na = a.episodeNumber ?? Number.MAX_SAFE_INTEGER;
    const nb = b.episodeNumber ?? Number.MAX_SAFE_INTEGER;
    if (na !== nb) return na - nb;
    return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
  });
  return sorted.find((ep) => !ep.watched) || sorted[0] || null;
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
  const [activeTab, setActiveTab] = useState<LibraryFilterTab>('all');
  const [scrapingAll, setScrapingAll] = useState(false);
  const [playingPath, setPlayingPath] = useState<string | null>(null);
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
    let watchingCount = 0;
    let localCount = 0;
    let cloudCount = 0;
    let completedCount = 0;
    for (const s of seriesList) {
      episodes += s.totalEpisodes;
      watched += s.watchedCount;
      if (!s.scrapedAt && !s.coverUrl) unscraped += 1;
      if (s.isCloud) cloudCount += 1;
      else localCount += 1;
      if (s.totalEpisodes > 0 && s.watchedCount >= s.totalEpisodes) {
        completedCount += 1;
      } else if (s.watchedCount > 0 && s.watchedCount < s.totalEpisodes) {
        watchingCount += 1;
      }
    }
    return {
      seriesCount: seriesList.length,
      episodes,
      watched,
      unscraped,
      watchingCount,
      localCount,
      cloudCount,
      completedCount,
    };
  }, [seriesList]);

  const continueWatchingItems = useMemo(() => {
    return seriesList
      .filter((s) => s.watchedCount > 0 && s.watchedCount < s.totalEpisodes)
      .map((s) => ({ series: s, nextEpisode: findNextUnwatchedEpisode(s) }))
      .filter((item): item is { series: LibrarySeries; nextEpisode: LibraryEpisode } =>
        Boolean(item.nextEpisode),
      )
      .slice(0, 8);
  }, [seriesList]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return seriesList.filter((s) => {
      if (
        activeTab === 'watching' &&
        !(s.watchedCount > 0 && s.watchedCount < s.totalEpisodes)
      ) {
        return false;
      }
      if (activeTab === 'local' && s.isCloud) return false;
      if (activeTab === 'cloud' && !s.isCloud) return false;
      if (
        activeTab === 'completed' &&
        !(s.totalEpisodes > 0 && s.watchedCount >= s.totalEpisodes)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        (s.originalTitle && s.originalTitle.toLowerCase().includes(q)) ||
        s.folderPath.toLowerCase().includes(q)
      );
    });
  }, [seriesList, activeTab, filter]);

  const handlePlayContinue = async (ep: LibraryEpisode) => {
    setPlayingPath(ep.filePath);
    try {
      const res = await api.libraryPlay(ep.filePath);
      if (!res.ok) {
        pushToast({
          kind: 'error',
          title: '启动播放器失败',
          description: res.error || ep.filePath,
        });
      }
    } finally {
      setPlayingPath(null);
    }
  };

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

  const filterTabs: Array<{ id: LibraryFilterTab; label: string; count: number }> = [
    { id: 'all', label: '全部收藏', count: totals.seriesCount },
    { id: 'watching', label: '追看中', count: totals.watchingCount },
    { id: 'local', label: '本地磁盘', count: totals.localCount },
    { id: 'cloud', label: '谷歌云盘', count: totals.cloudCount },
    { id: 'completed', label: '已看完', count: totals.completedCount },
  ];

  return (
    <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-6 pb-14">
      {/* Compact Stats + Filter Dock + Toolbar */}
      <section className="space-y-3.5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-400 tabular-nums">
            <span className="rounded-lg border border-white/[0.08] bg-[#12151C] px-2.5 py-1 font-medium text-slate-200">
              {totals.seriesCount} 部番剧 · {totals.episodes} 集
            </span>
            <span className="rounded-lg border border-white/[0.07] bg-white/[0.04] px-2.5 py-1 text-slate-300">
              已观看 {totals.watched} 集
            </span>
            <span className="hidden text-[12px] text-slate-500 sm:inline">
              右键任意海报可刮削、转存云盘或移除
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 sm:w-56">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="筛选媒体库番剧..."
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
        </div>

        {/* Storage & Progress Segmented Dock */}
        {seriesList.length > 0 && (
          <div className="segmented-dock no-scrollbar max-w-full overflow-x-auto">
            {filterTabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] tabular-nums ${
                    active ? 'segmented-tab-active' : 'segmented-tab font-medium'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="text-[11px] opacity-75">{tab.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Continue Watching Horizontal Strip */}
      {continueWatchingItems.length > 0 &&
        !filter.trim() &&
        (activeTab === 'all' || activeTab === 'watching') && (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-[13.5px] font-semibold text-white">
              <Play className="h-3.5 w-3.5 fill-[#FF7A2F] text-[#FF7A2F]" />
              <span>继续观看</span>
              <span className="text-[11.5px] font-normal text-slate-500 tabular-nums">
                ({continueWatchingItems.length})
              </span>
            </div>
            <div className="no-scrollbar flex gap-3.5 overflow-x-auto pb-1">
              {continueWatchingItems.map(({ series, nextEpisode }) => {
                const pct =
                  series.totalEpisodes > 0
                    ? Math.min(100, Math.round((series.watchedCount / series.totalEpisodes) * 100))
                    : 0;
                const isPlaying = playingPath === nextEpisode.filePath;
                return (
                  <div
                    key={series.seriesId}
                    className="card-interactive flex w-[312px] shrink-0 items-center gap-3.5 rounded-2xl p-3"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenSeries(series)}
                      className="cinema-dark-surface relative h-[86px] w-[64px] shrink-0 overflow-hidden rounded-xl border border-white/[0.12] shadow-md transition hover:scale-[1.03]"
                    >
                      <PosterImage
                        url={series.coverUrl}
                        title={series.title}
                        compactFallback
                        className="h-full w-full"
                      />
                    </button>
                    <div className="min-w-0 flex-1 space-y-2">
                      <button
                        type="button"
                        onClick={() => onOpenSeries(series)}
                        className="line-clamp-1 text-left text-[13px] font-semibold text-white hover:text-[#FF9E4F]"
                      >
                        {series.title}
                      </button>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
                        <span>下一集 {formatEpisodeLabel(nextEpisode.episodeNumber)}</span>
                        <span>
                          {series.watchedCount}/{series.totalEpisodes}
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.1]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#FF7A2F] to-[#FF9E4F]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => void handlePlayContinue(nextEpisode)}
                        disabled={isPlaying}
                        className="btn-mikan inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px]"
                      >
                        {isPlaying ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3 fill-current" />
                        )}
                        {isPlaying ? '启动中...' : '继续播放'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

      {/* Series Gallery Poster Grid or Empty State */}
      {scanning && seriesList.length === 0 ? (
        <div className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2.5">
              <div className="skeleton-shimmer aspect-[3/4] rounded-2xl border border-white/[0.05]" />
              <div className="skeleton-shimmer h-3.5 w-4/5 rounded-md" />
              <div className="skeleton-shimmer h-3 w-1/2 rounded-md" />
            </div>
          ))}
        </div>
      ) : seriesList.length === 0 ? (
        <div className="card-elevated flex flex-col items-center justify-center rounded-2xl px-6 py-20 text-center">
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
          <p className="mt-3 text-[14px] text-slate-300">
            {filter.trim() ? `未找到匹配“${filter}”的番剧` : '当前分类下暂无番剧'}
          </p>
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {filtered.map((series) => {
            const pct =
              series.totalEpisodes > 0
                ? Math.min(100, Math.round((series.watchedCount / series.totalEpisodes) * 100))
                : 0;
            const allWatched =
              series.totalEpisodes > 0 && series.watchedCount >= series.totalEpisodes;
            const unwatchedCount = Math.max(0, series.totalEpisodes - series.watchedCount);

            return (
              <button
                key={series.seriesId}
                type="button"
                onClick={() => onOpenSeries(series)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextState({ x: e.clientX, y: e.clientY, series });
                }}
                className="poster-tile group flex flex-col text-left focus:outline-none"
              >
                {/* Unobstructed Infuse Artwork Frame */}
                <div className="poster-frame aspect-[3/4] w-full">
                  <PosterImage
                    url={series.coverUrl}
                    title={series.title}
                    className="h-full w-full"
                    imgClassName="poster-img"
                  />

                  {/* Top Corner Glass Badges */}
                  <div className="pointer-events-none absolute top-2.5 right-2.5 left-2.5 flex items-center justify-between gap-2">
                    {allWatched ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#22C55E]/92 px-2 py-0.5 text-[10px] font-bold text-[#0B0D11]">
                        <CheckCircle2 className="h-3 w-3" />
                        已看完
                      </span>
                    ) : series.rating ? (
                      <span className="poster-glass-badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums">
                        <Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" />
                        {series.rating.toFixed(1)}
                      </span>
                    ) : !series.scrapedAt && !series.coverUrl ? (
                      <span className="poster-glass-badge rounded-full px-2 py-0.5 text-[10px] font-medium">
                        未刮削
                      </span>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-1">
                      {series.isCloud && (
                        <span
                          title={`谷歌云盘目录：${series.folderPath}`}
                          className="poster-glass-badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                        >
                          <Cloud className="h-2.5 w-2.5 text-sky-400" />
                          云盘
                        </span>
                      )}
                      <span className="poster-glass-badge tabular-nums rounded-full px-2 py-0.5 text-[10px] font-semibold">
                        {unwatchedCount > 0 && series.watchedCount > 0
                          ? `剩 ${unwatchedCount} 集`
                          : `${series.totalEpisodes} 集`}
                      </span>
                    </div>
                  </div>

                  {/* Centered Frosted Play Orb on Hover */}
                  <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-all duration-200 group-hover:scale-105 group-hover:opacity-100">
                    <span className="poster-hover-pill flex h-12 w-12 items-center justify-center rounded-full">
                      <Play className="ml-0.5 h-5 w-5 fill-[#FF7A2F] text-[#FF7A2F]" />
                    </span>
                  </div>

                  {/* Razor-thin Bottom Progress Hairline (when started) */}
                  {series.watchedCount > 0 && (
                    <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-[3px] bg-black/45">
                      <div
                        className={`h-full transition-all duration-300 ${
                          allWatched
                            ? 'bg-[#22C55E]'
                            : 'bg-gradient-to-r from-[#FF7A2F] to-[#FF9E4F]'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>

                {/* Clean Below-Poster Editorial Caption */}
                <div className="w-full space-y-1 px-0.5 pt-2.5">
                  <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-100 transition-colors group-hover:text-[#FF9E4F]">
                    {series.title}
                  </h3>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                    {allWatched ? (
                      <span className="inline-flex items-center gap-1 font-medium text-[#22C55E]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
                        全 {series.totalEpisodes} 集 · 已看完
                      </span>
                    ) : (
                      <span>
                        已看 {series.watchedCount} / {series.totalEpisodes} 集
                      </span>
                    )}
                    {series.isCloud && <span className="text-sky-400">云端</span>}
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

import React, { useMemo, useState } from 'react';
import {
  Play,
  FolderOpen,
  CheckCircle2,
  Circle,
  HardDrive,
  Clock,
  Film,
  Loader2,
  Sparkles,
  Trash2,
  Star,
  Calendar,
  ExternalLink,
  BellRing,
  Cloud,
  CloudUpload,
  LayoutGrid,
  List,
} from 'lucide-react';
import type { LibraryEpisode, LibrarySeries, SubscriptionItem } from '@shared/types';
import { api } from '@/lib/api';
import {
  formatBytes,
  formatEpisodeLabel,
  formatRelativeDate,
} from '@/lib/format';
import { PosterImage } from '@/components/PosterImage';
import { TagBadge } from '@/components/TagBadge';
import { ContextMenu, type ContextMenuItem } from '@/components/ContextMenu';
import { ScrapeSeriesModal } from '@/components/ScrapeSeriesModal';
import { RemoveConfirmModal, type RemoveTarget } from '@/components/RemoveConfirmModal';
import { CloudUploadModal, type CloudUploadTarget } from '@/components/CloudUploadModal';
import { useProxiedImage } from '@/hooks/useProxiedImage';
import { useToast } from '@/hooks/useToast';

interface SeriesDetailViewProps {
  series: LibrarySeries;
  subscriptions: SubscriptionItem[];
  onRefreshLibrary: () => Promise<void>;
  onSeriesRemoved: () => void;
  onCloudUploaded?: () => void;
  onRequestSubscribe: (info: {
    bangumiId: string;
    bangumiTitle: string;
    coverUrl?: string;
    preferredSavePath: string;
    detectedMaxEpisode: number;
    existing?: SubscriptionItem | null;
  }) => void;
}

export const SeriesDetailView: React.FC<SeriesDetailViewProps> = ({
  series,
  subscriptions,
  onRefreshLibrary,
  onSeriesRemoved,
  onCloudUploaded,
  onRequestSubscribe,
}) => {
  const { pushToast } = useToast();
  const [playingPath, setPlayingPath] = useState<string | null>(null);
  const [togglingPath, setTogglingPath] = useState<string | null>(null);
  const [scrapeOpen, setScrapeOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [uploadTarget, setUploadTarget] = useState<CloudUploadTarget | null>(null);
  const [episodeMenu, setEpisodeMenu] = useState<{
    x: number;
    y: number;
    episode: LibraryEpisode;
  } | null>(null);
  const [episodeFilter, setEpisodeFilter] = useState<'all' | 'unwatched' | 'watched'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    try {
      return localStorage.getItem('mikanvault_series_view_mode') === 'grid' ? 'grid' : 'list';
    } catch {
      return 'list';
    }
  });

  const changeViewMode = (mode: 'list' | 'grid') => {
    setViewMode(mode);
    try {
      localStorage.setItem('mikanvault_series_view_mode', mode);
    } catch {
      // Ignore storage error
    }
  };

  const bgImg = useProxiedImage(series.coverUrl);

  const sortedEpisodes = useMemo(() => {
    return [...series.episodes].sort((a, b) => {
      const na = a.episodeNumber ?? Number.MAX_SAFE_INTEGER;
      const nb = b.episodeNumber ?? Number.MAX_SAFE_INTEGER;
      if (na !== nb) return na - nb;
      return a.fileName.localeCompare(b.fileName, undefined, { numeric: true });
    });
  }, [series.episodes]);

  const nextEpisode = useMemo(() => {
    return sortedEpisodes.find((e) => !e.watched) || sortedEpisodes[0] || null;
  }, [sortedEpisodes]);

  const watchedCount = useMemo(
    () => sortedEpisodes.filter((e) => e.watched).length,
    [sortedEpisodes],
  );
  const unwatchedCount = Math.max(0, sortedEpisodes.length - watchedCount);

  const filteredEpisodes = useMemo(() => {
    if (episodeFilter === 'unwatched') return sortedEpisodes.filter((e) => !e.watched);
    if (episodeFilter === 'watched') return sortedEpisodes.filter((e) => e.watched);
    return sortedEpisodes;
  }, [sortedEpisodes, episodeFilter]);

  const maxEpisodeNumber = useMemo(() => {
    const parsedMax = sortedEpisodes.reduce(
      (max, ep) => Math.max(max, ep.episodeNumber ?? 0),
      0
    );
    return parsedMax > 0 ? parsedMax : series.totalEpisodes;
  }, [sortedEpisodes, series.totalEpisodes]);

  const existingSubscription = useMemo(
    () =>
      series.bangumiId
        ? subscriptions.find((s) => s.bangumiId === series.bangumiId) || null
        : null,
    [subscriptions, series.bangumiId]
  );

  const pct =
    series.totalEpisodes > 0
      ? Math.min(100, Math.round((series.watchedCount / series.totalEpisodes) * 100))
      : 0;

  const handlePlay = async (ep: LibraryEpisode) => {
    setPlayingPath(ep.filePath);
    try {
      const res = await api.libraryPlay(ep.filePath);
      if (res.ok) {
        pushToast({
          kind: 'success',
          title: '已调用本地播放器',
          description: ep.title || ep.fileName,
        });
        await onRefreshLibrary();
      } else {
        pushToast({
          kind: 'error',
          title: '启动播放器失败',
          description: res.error || '请检查本地播放器设置或文件路径',
        });
      }
    } catch (err) {
      pushToast({
        kind: 'error',
        title: '播放出错',
        description: err instanceof Error ? err.message : '未知错误',
      });
    } finally {
      setPlayingPath(null);
    }
  };

  const handleToggleWatched = async (ep: LibraryEpisode) => {
    setTogglingPath(ep.filePath);
    try {
      const res = await api.libraryToggleWatched(ep.filePath, !ep.watched);
      if (res.ok) {
        await onRefreshLibrary();
      } else {
        pushToast({ kind: 'error', title: '更新状态失败', description: res.error });
      }
    } finally {
      setTogglingPath(null);
    }
  };

  const handleOpenFolder = async (targetPath: string) => {
    const res = await api.libraryOpenFolder(targetPath);
    if (!res.ok) {
      pushToast({ kind: 'error', title: '无法打开目录', description: res.error });
    }
  };

  const episodeContextItems: ContextMenuItem[] = useMemo(() => {
    if (!episodeMenu) return [];
    const { episode } = episodeMenu;
    return [
      {
        id: 'play',
        label: '本地播放',
        icon: <Play className="h-3.5 w-3.5 text-[#FF9E4F]" />,
        onClick: () => void handlePlay(episode),
      },
      {
        id: 'toggle-watched',
        label: episode.watched ? '标记为未看' : '标记为已看',
        icon: episode.watched ? (
          <Circle className="h-3.5 w-3.5 text-slate-400" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E]" />
        ),
        onClick: () => void handleToggleWatched(episode),
      },
      {
        id: 'reveal',
        label: '在文件夹中显示',
        icon: <FolderOpen className="h-3.5 w-3.5 text-slate-400" />,
        onClick: () => void handleOpenFolder(episode.filePath),
      },
      ...(!series.isCloud
        ? [
            {
              id: 'cloud-upload-ep-move',
              label: '上传该集到谷歌云（并删除本地）',
              icon: <CloudUpload className="h-3.5 w-3.5 text-sky-400" />,
              dividerBefore: true,
              onClick: () =>
                setUploadTarget({
                  kind: 'episode',
                  episode,
                  series,
                  defaultDeleteLocal: true,
                }),
            },
            {
              id: 'cloud-upload-ep-keep',
              label: '上传该集到谷歌云（保留本地）',
              icon: <Cloud className="h-3.5 w-3.5 text-emerald-400" />,
              onClick: () =>
                setUploadTarget({
                  kind: 'episode',
                  episode,
                  series,
                  defaultDeleteLocal: false,
                }),
            },
          ]
        : []),
      {
        id: 'remove-ep',
        label: '从媒体库移除该集',
        icon: <Trash2 className="h-3.5 w-3.5" />,
        danger: true,
        dividerBefore: true,
        onClick: () =>
          setRemoveTarget({
            kind: 'episode',
            episode,
            seriesTitle: series.title,
          }),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeMenu, series]);

  return (
    <div className="pb-14">
      {/* Ambient Series Header */}
      <div className="cinema-dark-surface relative overflow-hidden border-b border-white/[0.06]">
        <div className="pointer-events-none absolute inset-0">
          {bgImg.src && (
            <img
              src={bgImg.src}
              alt=""
              aria-hidden="true"
              className="h-full w-full scale-110 object-cover opacity-28 blur-3xl saturate-125"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-[#0B0D11]/65 via-[#0B0D11]/86 to-[#0B0D11]" />
        </div>

        <div className="relative mx-auto flex max-w-[1320px] flex-col gap-6 px-6 py-7 sm:flex-row sm:items-end">
          <div className="relative shrink-0">
            <div className="pointer-events-none absolute -inset-3 rounded-3xl bg-[#FF7A2F]/18 opacity-65 blur-2xl" />
            <PosterImage
              url={series.coverUrl}
              title={series.title}
              className="relative h-[224px] w-[168px] rounded-2xl border border-white/[0.18] ring-1 ring-white/15 shadow-[0_24px_54px_rgba(0,0,0,0.88)]"
            />
          </div>

          <div className="min-w-0 flex-1 space-y-3.5 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              {series.isCloud ? (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-400/35 bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-sky-300">
                  <Cloud className="h-3 w-3" />
                  谷歌云盘
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[#22C55E]/30 bg-[#22C55E]/14 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
                  <Film className="h-3 w-3" />
                  本地媒体库
                </span>
              )}
              {series.bangumiId && (
                <span className="rounded-md border border-[#FF7A2F]/30 bg-[#FF7A2F]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#FF9E4F]">
                  MIKAN #{series.bangumiId}
                </span>
              )}
              {series.rating && (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 tabular-nums">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                  {series.rating.toFixed(1)}
                </span>
              )}
              {series.airDate && (
                <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-0.5 text-[11px] text-slate-300 tabular-nums">
                  <Calendar className="h-3 w-3 text-slate-400" />
                  {series.airDate}
                </span>
              )}
              <span className="tabular-nums rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-0.5 text-[11px] text-slate-300">
                已看 {series.watchedCount} / {series.totalEpisodes} 集 ({pct}%)
              </span>
            </div>

            <h1 className="text-[26px] font-bold tracking-tight text-white md:text-[30px] leading-tight">
              {series.title}
            </h1>

            {series.overview && (
              <p className="line-clamp-3 max-w-3xl text-[13px] leading-relaxed text-slate-300/90">
                {series.overview}
              </p>
            )}

            {series.infoLines && series.infoLines.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {series.infoLines.slice(0, 5).map((line, i) => {
                  const urlMatch = line.match(/(https?:\/\/\S+)/i);
                  if (urlMatch) {
                    const url = urlMatch[1].replace(/[),.;]+$/, '');
                    const labelPart = line
                      .slice(0, urlMatch.index)
                      .replace(/[:：\s]+$/, '')
                      .trim();
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => void api.openExternal(url)}
                        title={url}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.045] px-2.5 py-1 text-[11.5px] text-slate-200 transition hover:border-[#FF7A2F]/40 hover:bg-[#FF7A2F]/12 hover:text-white"
                      >
                        <span>{labelPart || '相关链接'}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-[#FF9E4F]" />
                      </button>
                    );
                  }
                  return (
                    <span
                      key={i}
                      className="rounded-lg border border-white/[0.07] bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-slate-300"
                    >
                      {line}
                    </span>
                  );
                })}
              </div>
            )}

            <p className="truncate font-mono text-[12px] text-slate-400" title={series.folderPath}>
              {series.folderPath}
            </p>

            {/* Progress bar */}
            <div className="max-w-md">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    pct >= 100
                      ? 'bg-[#22C55E]'
                      : 'bg-gradient-to-r from-[#FF7A2F] to-[#FF9E4F]'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {nextEpisode && (
                <button
                  type="button"
                  onClick={() => void handlePlay(nextEpisode)}
                  disabled={playingPath !== null}
                  className="btn-mikan inline-flex h-10 items-center gap-2 rounded-xl px-5 text-[13.5px]"
                >
                  <Play className="h-4 w-4 fill-current" />
                  {series.watchedCount > 0 && series.watchedCount < series.totalEpisodes
                    ? `继续播放 ${formatEpisodeLabel(nextEpisode.episodeNumber)}`
                    : `播放 ${formatEpisodeLabel(nextEpisode.episodeNumber)}`}
                </button>
              )}
              <button
                type="button"
                onClick={() => setScrapeOpen(true)}
                className="btn-ghost-dark inline-flex h-10 items-center gap-2 rounded-xl border-[#38BDF8]/30 bg-[#38BDF8]/10 px-4 text-[13px] font-medium text-sky-200 hover:bg-[#38BDF8]/20"
              >
                <Sparkles className="h-4 w-4 text-[#38BDF8]" />
                刮削 / 匹配元数据
              </button>
              {series.bangumiId && (
                <button
                  type="button"
                  onClick={() =>
                    onRequestSubscribe({
                      bangumiId: series.bangumiId!,
                      bangumiTitle: series.title,
                      coverUrl: series.coverUrl,
                      preferredSavePath: series.folderPath,
                      detectedMaxEpisode: maxEpisodeNumber,
                      existing: existingSubscription,
                    })
                  }
                  className={`btn-ghost-dark inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-medium ${
                    existingSubscription
                      ? 'border-[#22C55E]/35 bg-[#22C55E]/12 text-emerald-200 hover:bg-[#22C55E]/20'
                      : 'border-[#FF7A2F]/35 bg-[#FF7A2F]/12 text-[#FF9E4F] hover:bg-[#FF7A2F]/22'
                  }`}
                >
                  <BellRing className="h-4 w-4" />
                  {existingSubscription ? '已开启自动追更 · 编辑' : '订阅后续更新'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleOpenFolder(series.folderPath)}
                className="btn-ghost-dark inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-medium"
              >
                <FolderOpen className="h-4 w-4 text-slate-300" />
                打开本地文件夹
              </button>
              {!series.isCloud && (
                <button
                  type="button"
                  onClick={() =>
                    setUploadTarget({
                      kind: 'series',
                      series,
                      defaultDeleteLocal: true,
                    })
                  }
                  className="btn-ghost-dark inline-flex h-10 items-center gap-2 rounded-xl border-sky-400/35 bg-sky-500/12 px-4 text-[13px] font-medium text-sky-200 hover:bg-sky-500/22"
                >
                  <CloudUpload className="h-4 w-4 text-sky-400" />
                  上传到谷歌云
                </button>
              )}
              <button
                type="button"
                onClick={() => setRemoveTarget({ kind: 'series', series })}
                className="btn-ghost-dark inline-flex h-10 items-center gap-2 rounded-xl px-3.5 text-[13px] font-medium text-rose-400 hover:border-rose-500/35 hover:bg-rose-500/12 hover:text-rose-300"
              >
                <Trash2 className="h-4 w-4" />
                从媒体库移除
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Episode List / Grid */}
      <div className="mx-auto max-w-[1320px] space-y-4 px-6 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[15px] font-semibold text-white">剧集列表</h2>
            <div className="segmented-dock">
              {(
                [
                  { id: 'all', label: '全部', count: sortedEpisodes.length },
                  { id: 'unwatched', label: '未看', count: unwatchedCount },
                  { id: 'watched', label: '已看', count: watchedCount },
                ] as const
              ).map((tab) => {
                const active = episodeFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setEpisodeFilter(tab.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] tabular-nums ${
                      active ? 'segmented-tab-active' : 'segmented-tab font-medium'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className="text-[11px] opacity-75">{tab.count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-[12px] text-slate-500 md:inline">
              点击「本地播放」调用播放器 · 右键单集可标记或移除
            </span>
            <div className="flex items-center rounded-xl border border-white/[0.08] bg-[#12151C] p-0.5">
              <button
                type="button"
                onClick={() => changeViewMode('list')}
                title="列表视图"
                aria-label="列表视图"
                className={`inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium transition ${
                  viewMode === 'list'
                    ? 'bg-[#FF7A2F] font-semibold text-[#0B0D11]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <List className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">列表</span>
              </button>
              <button
                type="button"
                onClick={() => changeViewMode('grid')}
                title="网格视图"
                aria-label="网格视图"
                className={`inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium transition ${
                  viewMode === 'grid'
                    ? 'bg-[#FF7A2F] font-semibold text-[#0B0D11]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">网格</span>
              </button>
            </div>
          </div>
        </div>

        {filteredEpisodes.length === 0 ? (
          <div className="card-elevated rounded-2xl py-12 text-center text-[13px] text-slate-400">
            当前筛选下暂无剧集
          </div>
        ) : viewMode === 'list' ? (
          <div className="space-y-2.5">
            {filteredEpisodes.map((ep) => {
              const isPlaying = playingPath === ep.filePath;
              const isToggling = togglingPath === ep.filePath;
              const isNext = Boolean(nextEpisode && ep.id === nextEpisode.id && !ep.watched);

              return (
                <div
                  key={ep.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setEpisodeMenu({ x: e.clientX, y: e.clientY, episode: ep });
                  }}
                  className={`group flex flex-col gap-3 rounded-xl border px-4 py-3.5 transition sm:flex-row sm:items-center sm:justify-between ${
                    isNext
                      ? 'border-[#FF7A2F]/45 bg-[#FF7A2F]/[0.06] hover:border-[#FF7A2F]/65'
                      : ep.watched
                        ? 'border-white/[0.05] bg-[#12151C]/65 hover:border-white/[0.1] hover:bg-[#161A23]'
                        : 'border-white/[0.075] bg-[#12151C] hover:border-white/[0.15] hover:bg-[#171C26]'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3.5">
                    {/* Watched Toggle */}
                    <button
                      type="button"
                      disabled={isToggling}
                      onClick={() => void handleToggleWatched(ep)}
                      className="shrink-0 rounded-full p-1 transition hover:bg-white/[0.06]"
                      title={ep.watched ? '标记为未看' : '标记为已看'}
                      aria-label={ep.watched ? '标记为未看' : '标记为已看'}
                    >
                      {ep.watched ? (
                        <CheckCircle2 className="h-5 w-5 text-[#22C55E]" />
                      ) : (
                        <Circle className="h-5 w-5 text-slate-600 transition group-hover:text-slate-400" />
                      )}
                    </button>

                    {/* Episode Number Pill */}
                    <div
                      className={`tabular-nums flex h-10 w-16 shrink-0 items-center justify-center rounded-xl border text-[12px] font-bold tracking-wide ${
                        ep.watched
                          ? 'border-[#22C55E]/20 bg-[#22C55E]/10 text-emerald-300'
                          : 'border-[#FF7A2F]/25 bg-[#FF7A2F]/12 text-[#FF9E4F]'
                      }`}
                    >
                      {formatEpisodeLabel(ep.episodeNumber)}
                    </div>

                    {/* Episode Details */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <div
                          className={`truncate text-[13.5px] font-semibold ${
                            ep.watched ? 'text-slate-300' : 'text-white'
                          }`}
                        >
                          {ep.title || ep.fileName}
                        </div>
                        {isNext && (
                          <span className="shrink-0 rounded-md border border-[#FF7A2F]/35 bg-[#FF7A2F]/18 px-1.5 py-0.5 text-[10px] font-semibold text-[#FF9E4F]">
                            下一集
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-slate-400">
                        <span className="max-w-[340px] truncate font-mono text-[11px] text-slate-500">
                          {ep.fileName}
                        </span>
                        {ep.resolution && <TagBadge label={ep.resolution} />}
                        {ep.tags.slice(0, 3).map((tag) => (
                          <TagBadge key={tag} label={tag} />
                        ))}
                        <span className="inline-flex items-center gap-1 tabular-nums text-slate-400">
                          <HardDrive className="h-3 w-3 text-slate-500" />
                          {formatBytes(ep.sizeBytes)}
                        </span>
                        {ep.lastPlayedAt && (
                          <span className="inline-flex items-center gap-1 tabular-nums text-slate-500">
                            <Clock className="h-3 w-3" />
                            上次观看 {formatRelativeDate(ep.lastPlayedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Play Button */}
                  <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => void handlePlay(ep)}
                      disabled={isPlaying}
                      className="btn-mikan inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-[12.5px]"
                    >
                      {isPlaying ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5 fill-current" />
                      )}
                      本地播放
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredEpisodes.map((ep) => {
              const isPlaying = playingPath === ep.filePath;
              const isToggling = togglingPath === ep.filePath;
              const isNext = Boolean(nextEpisode && ep.id === nextEpisode.id && !ep.watched);

              return (
                <div
                  key={ep.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setEpisodeMenu({ x: e.clientX, y: e.clientY, episode: ep });
                  }}
                  className={`group flex flex-col justify-between gap-3 rounded-2xl border p-4 transition ${
                    isNext
                      ? 'border-[#FF7A2F]/45 bg-[#FF7A2F]/[0.06] hover:border-[#FF7A2F]/65'
                      : ep.watched
                        ? 'border-white/[0.06] bg-[#12151C]/70 hover:border-white/[0.12]'
                        : 'border-white/[0.08] bg-[#12151C] hover:border-white/[0.16]'
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`tabular-nums inline-flex h-7 items-center justify-center rounded-lg border px-2.5 text-[11.5px] font-bold ${
                            ep.watched
                              ? 'border-[#22C55E]/25 bg-[#22C55E]/12 text-emerald-300'
                              : 'border-[#FF7A2F]/30 bg-[#FF7A2F]/14 text-[#FF9E4F]'
                          }`}
                        >
                          {formatEpisodeLabel(ep.episodeNumber)}
                        </div>
                        {isNext && (
                          <span className="rounded-md border border-[#FF7A2F]/35 bg-[#FF7A2F]/18 px-1.5 py-0.5 text-[10px] font-semibold text-[#FF9E4F]">
                            下一集
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={isToggling}
                        onClick={() => void handleToggleWatched(ep)}
                        className="rounded-full p-1 transition hover:bg-white/[0.06]"
                        title={ep.watched ? '标记为未看' : '标记为已看'}
                        aria-label={ep.watched ? '标记为未看' : '标记为已看'}
                      >
                        {ep.watched ? (
                          <CheckCircle2 className="h-4.5 w-4.5 text-[#22C55E]" />
                        ) : (
                          <Circle className="h-4.5 w-4.5 text-slate-600 transition group-hover:text-slate-400" />
                        )}
                      </button>
                    </div>

                    <div
                      title={ep.fileName}
                      className={`line-clamp-2 text-[13px] font-semibold leading-snug ${
                        ep.watched ? 'text-slate-300' : 'text-white'
                      }`}
                    >
                      {ep.title || ep.fileName}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                      {ep.resolution && <TagBadge label={ep.resolution} />}
                      {ep.tags.slice(0, 2).map((tag) => (
                        <TagBadge key={tag} label={tag} />
                      ))}
                      <span className="ml-auto inline-flex items-center gap-1 tabular-nums text-slate-400">
                        <HardDrive className="h-3 w-3 text-slate-500" />
                        {formatBytes(ep.sizeBytes)}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handlePlay(ep)}
                    disabled={isPlaying}
                    className="btn-mikan flex h-8.5 w-full items-center justify-center gap-1.5 rounded-xl text-[12px]"
                  >
                    {isPlaying ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5 fill-current" />
                    )}
                    {isPlaying ? '启动中...' : '本地播放'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {episodeMenu && (
        <ContextMenu
          x={episodeMenu.x}
          y={episodeMenu.y}
          items={episodeContextItems}
          onClose={() => setEpisodeMenu(null)}
        />
      )}

      <ScrapeSeriesModal
        series={scrapeOpen ? series : null}
        onClose={() => setScrapeOpen(false)}
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
          const wasSeries = removeTarget?.kind === 'series';
          pushToast({
            kind: 'info',
            title: deletedFiles ? '已移除并移入回收站' : '已从媒体库移除',
            description: title,
          });
          if (wasSeries) {
            onSeriesRemoved();
          } else {
            void onRefreshLibrary();
          }
        }}
      />

      <CloudUploadModal
        target={uploadTarget}
        onClose={() => setUploadTarget(null)}
        onUploaded={async (res, info) => {
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
              `${info.title} · 可在左侧「云盘上传」查看进度或取消`,
          });
          onCloudUploaded?.();
          await onRefreshLibrary();
          if (info.kind === 'series' && !res.queued && res.deletedLocal) {
            onSeriesRemoved();
          }
        }}
      />
    </div>
  );
};

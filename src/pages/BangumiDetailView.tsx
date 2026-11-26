import React, { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Rss,
  Search,
  RefreshCw,
  AlertCircle,
  Layers,
  Film,
  CheckSquare,
  ChevronDown,
  Loader2,
  BellRing,
  Languages,
} from 'lucide-react';
import type {
  MikanBangumiDetail,
  MikanRelease,
  MikanSubgroup,
  SubscriptionItem,
  SubtitleLanguageFilter,
} from '@shared/types';
import {
  countSubtitleLanguages,
  getSubtitleLanguageLabel,
  matchesSubtitleLanguage,
} from '@shared/subtitleLanguage';
import { api } from '@/lib/api';
import { PosterImage } from '@/components/PosterImage';
import { ReleaseRow } from '@/components/ReleaseRow';
import { BatchActionBar } from '@/components/BatchActionBar';
import { useProxiedImage } from '@/hooks/useProxiedImage';
import { useReleaseSelection } from '@/hooks/useReleaseSelection';

interface BangumiDetailViewProps {
  bangumiId: string;
  initialTitle?: string;
  initialCoverUrl?: string;
  initialDetail?: MikanBangumiDetail | null;
  subscriptions: SubscriptionItem[];
  onRequestDownload: (
    release: MikanRelease,
    detail: MikanBangumiDetail,
    subgroup?: MikanSubgroup | null,
    preferredLanguageFilter?: SubtitleLanguageFilter,
  ) => void;
  onRequestBatchDownload: (
    releases: MikanRelease[],
    detail: MikanBangumiDetail,
    onDoneClear: () => void,
    subgroup?: MikanSubgroup | null,
    preferredLanguageFilter?: SubtitleLanguageFilter,
  ) => void;
  onRequestSubscribe: (
    detail: MikanBangumiDetail,
    subgroup: MikanSubgroup,
    existing?: SubscriptionItem | null,
    preferredLanguageFilter?: SubtitleLanguageFilter,
  ) => void;
  onOpenRssFeed: (rssUrl: string) => void;
}

export const BangumiDetailView: React.FC<BangumiDetailViewProps> = ({
  bangumiId,
  initialTitle,
  initialCoverUrl,
  initialDetail,
  subscriptions,
  onRequestDownload,
  onRequestBatchDownload,
  onRequestSubscribe,
  onOpenRssFeed,
}) => {
  const [detail, setDetail] = useState<MikanBangumiDetail | null>(initialDetail || null);
  const [loading, setLoading] = useState(!initialDetail);
  const [expandingSubgroupId, setExpandingSubgroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSubgroupId, setActiveSubgroupId] = useState<string>('');
  const [languageFilter, setLanguageFilter] = useState<SubtitleLanguageFilter>('all');
  const [filterText, setFilterText] = useState('');

  const fetchDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getBangumiDetail(bangumiId);
      setDetail(data);
      if (data.subgroups.length > 0) {
        setActiveSubgroupId((prev) =>
          data.subgroups.some((s) => s.id === prev) ? prev : data.subgroups[0].id
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载番剧详情失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialDetail && initialDetail.id === bangumiId) {
      setDetail(initialDetail);
      setLoading(false);
      if (initialDetail.subgroups.length > 0) {
        setActiveSubgroupId(initialDetail.subgroups[0].id);
      }
      return;
    }
    setFilterText('');
    setLanguageFilter('all');
    void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bangumiId]);

  const coverUrl = detail?.coverUrl || initialCoverUrl;
  const title = detail?.title || initialTitle || `番剧 #${bangumiId}`;
  const bgImg = useProxiedImage(coverUrl);

  const activeSubgroup = useMemo(() => {
    if (!detail || detail.subgroups.length === 0) return null;
    return detail.subgroups.find((s) => s.id === activeSubgroupId) || detail.subgroups[0];
  }, [detail, activeSubgroupId]);

  const activeSubscription = useMemo(() => {
    if (!detail || !activeSubgroup) return null;
    return (
      subscriptions.find(
        (s) => s.bangumiId === detail.id && s.subgroupId === activeSubgroup.id
      ) || null
    );
  }, [subscriptions, detail, activeSubgroup]);

  const availableLanguages = useMemo(() => {
    if (!activeSubgroup) return [];
    return countSubtitleLanguages(activeSubgroup.episodes.map((ep) => ep.title));
  }, [activeSubgroup]);

  const unclassifiedLanguageCount = useMemo(() => {
    if (!activeSubgroup) return 0;
    const classified = availableLanguages.reduce((sum, lang) => sum + lang.count, 0);
    return Math.max(0, activeSubgroup.episodes.length - classified);
  }, [activeSubgroup, availableLanguages]);

  const showLanguageFilterBar =
    availableLanguages.length >= 2 ||
    (availableLanguages.length === 1 && unclassifiedLanguageCount > 0);

  const filteredEpisodes = useMemo(() => {
    if (!activeSubgroup) return [];
    const q = filterText.trim().toLowerCase();
    return activeSubgroup.episodes.filter((ep) => {
      if (!matchesSubtitleLanguage(ep.title, languageFilter)) return false;
      if (q && !ep.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [activeSubgroup, filterText, languageFilter]);

  const enrichedFilteredEpisodes = useMemo(() => {
    if (!detail) return filteredEpisodes;
    return filteredEpisodes.map((ep) => ({
      ...ep,
      subgroup: ep.subgroup || activeSubgroup?.name,
      subgroupId: ep.subgroupId || activeSubgroup?.id,
      bangumiTitle: detail.title,
      bangumiId: detail.id,
    }));
  }, [filteredEpisodes, detail, activeSubgroup?.name, activeSubgroup?.id]);

  const selection = useReleaseSelection(enrichedFilteredEpisodes);

  useEffect(() => {
    setLanguageFilter('all');
  }, [bangumiId, activeSubgroup?.id]);

  useEffect(() => {
    selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bangumiId, activeSubgroup?.id, languageFilter]);

  const handleExpandSubgroup = async () => {
    if (!detail || !activeSubgroup) return;
    setExpandingSubgroupId(activeSubgroup.id);
    try {
      const fullEpisodes = await api.expandSubgroupEpisodes(detail.id, activeSubgroup.id, 200);
      if (fullEpisodes.length > 0) {
        setDetail((prev) => {
          if (!prev || prev.id !== detail.id) return prev;
          return {
            ...prev,
            subgroups: prev.subgroups.map((sg) =>
              sg.id === activeSubgroup.id
                ? {
                    ...sg,
                    episodes: fullEpisodes.map((ep) => ({
                      ...ep,
                      subgroup: ep.subgroup || sg.name,
                      bangumiTitle: prev.title,
                      bangumiId: prev.id,
                    })),
                    hasMore: false,
                  }
                : sg
            ),
          };
        });
      } else {
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                subgroups: prev.subgroups.map((sg) =>
                  sg.id === activeSubgroup.id ? { ...sg, hasMore: false } : sg
                ),
              }
            : prev
        );
      }
    } finally {
      setExpandingSubgroupId(null);
    }
  };

  const totalReleases = useMemo(
    () => detail?.subgroups.reduce((acc, sg) => acc + sg.episodes.length, 0) || 0,
    [detail]
  );

  return (
    <div className={selection.selectedCount > 0 ? 'pb-24' : 'pb-14'}>
      {/* Full-bleed Ambient Blurred Cover Header */}
      <div className="cinema-dark-surface relative overflow-hidden border-b border-white/[0.06]">
        <div className="pointer-events-none absolute inset-0">
          {bgImg.src && (
            <img
              src={bgImg.src}
              alt=""
              aria-hidden="true"
              className="h-full w-full scale-110 object-cover opacity-30 blur-3xl saturate-125"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-[#0B0D11]/65 via-[#0B0D11]/85 to-[#0B0D11]" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0B0D11]/90 via-transparent to-[#0B0D11]/70" />
        </div>

        <div className="relative mx-auto flex max-w-[1320px] flex-col gap-6 px-6 py-7 sm:flex-row sm:items-end">
          {/* Crisp 3:4 Poster */}
          <PosterImage
            url={coverUrl}
            title={title}
            className="h-[228px] w-[171px] shrink-0 rounded-2xl border border-white/[0.14] shadow-[0_24px_50px_rgba(0,0,0,0.85)]"
          />

          {/* Metadata & Actions */}
          <div className="min-w-0 flex-1 space-y-3.5 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-[#FF7A2F]/30 bg-[#FF7A2F]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#FF9E4F]">
                MIKAN #{bangumiId}
              </span>
              {detail && (
                <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-0.5 text-[11px] text-slate-300 tabular-nums">
                  <Layers className="h-3 w-3 text-slate-400" />
                  {detail.subgroups.length} 个字幕组 · {totalReleases} 条资源
                </span>
              )}
            </div>

            <h1 className="text-[26px] font-bold tracking-tight text-white md:text-[30px] leading-tight">
              {title}
            </h1>

            {detail && detail.infoLines.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {detail.infoLines.slice(0, 6).map((line, i) => {
                  const urlMatch = line.match(/(https?:\/\/\S+)/i);
                  if (urlMatch) {
                    const url = urlMatch[1].replace(/[),.;]+$/, '');
                    const labelPart = line
                      .slice(0, urlMatch.index)
                      .replace(/[:：\s]+$/, '')
                      .trim();
                    let hostFallback = url;
                    try {
                      hostFallback = new URL(url).hostname;
                    } catch {
                      // keep raw url fallback
                    }
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => void api.openExternal(url)}
                        title={url}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.045] px-2.5 py-1 text-[12px] text-slate-200 transition hover:border-[#FF7A2F]/40 hover:bg-[#FF7A2F]/12 hover:text-white"
                      >
                        <span>{labelPart || hostFallback}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-[#FF9E4F]" />
                      </button>
                    );
                  }
                  return (
                    <span
                      key={i}
                      className="rounded-lg border border-white/[0.07] bg-white/[0.04] px-2.5 py-1 text-[12px] text-slate-300"
                    >
                      {line}
                    </span>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {detail && activeSubgroup && (
                <button
                  type="button"
                  onClick={() =>
                    onRequestSubscribe(detail, activeSubgroup, activeSubscription, languageFilter)
                  }
                  className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-[12.5px] font-semibold transition ${
                    activeSubscription
                      ? 'border border-[#22C55E]/35 bg-[#22C55E]/15 text-emerald-200 hover:bg-[#22C55E]/25'
                      : 'btn-mikan'
                  }`}
                >
                  <BellRing className="h-3.5 w-3.5" />
                  {activeSubscription ? '已订阅此字幕组 · 编辑规则' : '订阅此字幕组自动追更'}
                </button>
              )}
              {detail?.mikanUrl && (
                <button
                  type="button"
                  onClick={() => void api.openExternal(detail.mikanUrl)}
                  className="btn-ghost-dark inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-[#FF9E4F]" />
                  在蜜柑计划打开
                </button>
              )}
              {activeSubgroup?.rssUrl && (
                <button
                  type="button"
                  onClick={() => onOpenRssFeed(activeSubgroup.rssUrl)}
                  className="btn-ghost-dark inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium"
                >
                  <Rss className="h-3.5 w-3.5 text-[#38BDF8]" />
                  在 RSS 页面查看此字幕组
                </button>
              )}
              <button
                type="button"
                onClick={() => void fetchDetail()}
                disabled={loading}
                className="btn-ghost-dark inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                刷新资源
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content: Subgroups + Episodes */}
      <div className="mx-auto max-w-[1320px] space-y-5 px-6 pt-6">
        {loading && !detail ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton-shimmer h-9 w-28 rounded-xl" />
              ))}
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton-shimmer h-[72px] w-full rounded-xl" />
            ))}
          </div>
        ) : error && !detail ? (
          <div className="card-elevated rounded-2xl p-8 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-[#FF7A2F]" />
            <h3 className="mt-3 text-[15px] font-semibold text-white">加载字幕组资源失败</h3>
            <p className="mt-1 text-[13px] text-slate-400">{error}</p>
            <button
              type="button"
              onClick={() => void fetchDetail()}
              className="btn-mikan mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px]"
            >
              <RefreshCw className="h-4 w-4" />
              重试
            </button>
          </div>
        ) : detail && detail.subgroups.length === 0 ? (
          <div className="card-elevated rounded-2xl p-12 text-center">
            <Film className="mx-auto h-8 w-8 text-slate-600" />
            <p className="mt-3 text-[14px] font-medium text-slate-300">暂无字幕组发布资源</p>
            <p className="mt-1 text-[12px] text-slate-500">请稍后刷新或在蜜柑计划原站查看</p>
          </div>
        ) : detail ? (
          <>
            {/* Subgroup Tabs + Inline Filter */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                {detail.subgroups.map((sg) => {
                  const isActive = activeSubgroup?.id === sg.id;
                  return (
                    <button
                      key={sg.id}
                      type="button"
                      onClick={() => setActiveSubgroupId(sg.id)}
                      className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-medium transition ${
                        isActive
                          ? 'bg-[#FF7A2F] text-[#0B0D11] font-semibold shadow-[0_6px_18px_-4px_rgba(255,122,47,0.5)]'
                          : 'border border-white/[0.08] bg-[#12151C] text-slate-300 hover:border-white/[0.16] hover:bg-[#181C26] hover:text-white'
                      }`}
                    >
                      <span>{sg.name}</span>
                      <span
                        className={`tabular-nums rounded-md px-1.5 py-0.5 text-[11px] ${
                          isActive
                            ? 'bg-[#0B0D11]/20 text-[#0B0D11]'
                            : 'bg-white/[0.06] text-slate-400'
                        }`}
                      >
                        {sg.episodes.length}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="relative w-full shrink-0 sm:w-64">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="筛选集数或画质..."
                  className="input-cinema h-9 w-full rounded-xl pr-3 pl-8 text-[12.5px]"
                />
              </div>
            </div>

            {/* Subtitle Language Filter Pills or Single-Language Status */}
            {activeSubgroup && availableLanguages.length > 0 && (
              showLanguageFilterBar ? (
                <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/[0.06] bg-[#12151C]/55 px-3 py-2">
                  <span className="mr-1 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-slate-400">
                    <Languages className="h-3.5 w-3.5 text-sky-400" />
                    字幕语言筛选：
                  </span>
                  <button
                    type="button"
                    onClick={() => setLanguageFilter('all')}
                    className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition tabular-nums ${
                      languageFilter === 'all'
                        ? 'bg-sky-500 font-semibold text-[#0B0D11]'
                        : 'border border-white/[0.07] bg-[#0B0D11]/60 text-slate-300 hover:text-white'
                    }`}
                  >
                    全部语言 ({activeSubgroup.episodes.length})
                  </button>
                  {availableLanguages.map((lang) => {
                    const active = languageFilter === lang.id;
                    return (
                      <button
                        key={lang.id}
                        type="button"
                        onClick={() => setLanguageFilter(lang.id)}
                        className={`rounded-full px-3 py-1 text-[11.5px] font-medium transition tabular-nums ${
                          active
                            ? 'bg-sky-500 font-semibold text-[#0B0D11]'
                            : 'border border-white/[0.07] bg-[#0B0D11]/60 text-slate-300 hover:text-white'
                        }`}
                      >
                        {lang.shortLabel} ({lang.count})
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-[#12151C]/45 px-3 py-1.5 text-[11.5px] text-slate-400">
                  <Languages className="h-3.5 w-3.5 text-sky-400" />
                  <span>
                    字幕语言：
                    <span className="font-medium text-sky-300">{availableLanguages[0].shortLabel}</span>
                    <span className="text-slate-500">
                      （当前字幕组全部 {activeSubgroup.episodes.length} 条资源均为该语言）
                    </span>
                  </span>
                </div>
              )
            )}

            {/* Batch Selection & Expand All Toolbar */}
            {enrichedFilteredEpisodes.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-[#12151C]/70 px-3.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={
                      selection.allVisibleSelected ? selection.clear : selection.selectAll
                    }
                    className="btn-ghost-dark inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium"
                  >
                    <CheckSquare className="h-3.5 w-3.5 text-[#FF9E4F]" />
                    {selection.allVisibleSelected
                      ? '取消全选'
                      : `全选当前 (${enrichedFilteredEpisodes.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={selection.invertSelection}
                    className="btn-ghost-dark inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium"
                  >
                    <RefreshCw className="h-3 w-3 text-slate-400" />
                    反选
                  </button>
                  <span className="hidden text-[11.5px] text-slate-500 sm:inline">
                    勾选多集后可一次性批量推送到 qBittorrent（支持 Shift 连选）
                  </span>
                </div>

                {activeSubgroup?.hasMore && (
                  <button
                    type="button"
                    onClick={() => void handleExpandSubgroup()}
                    disabled={expandingSubgroupId === activeSubgroup.id}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#FF7A2F]/35 bg-[#FF7A2F]/12 px-3 text-[12px] font-medium text-[#FF9E4F] transition hover:bg-[#FF7A2F]/22 disabled:opacity-60"
                  >
                    {expandingSubgroupId === activeSubgroup.id ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        正在加载全部历史集数...
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3.5 w-3.5" />
                        展开全部历史集数
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Episode Release List */}
            {enrichedFilteredEpisodes.length === 0 ? (
              <div className="card-elevated rounded-2xl py-12 text-center text-[13px] text-slate-400">
                {languageFilter !== 'all'
                  ? `当前「${getSubtitleLanguageLabel(languageFilter)}」筛选下没有匹配的资源${filterText ? `（关键词：${filterText}）` : ''}`
                  : `没有匹配“${filterText}”的资源`}
              </div>
            ) : (
              <div className="space-y-2.5">
                {enrichedFilteredEpisodes.map((ep) => (
                  <ReleaseRow
                    key={ep.id}
                    release={ep}
                    showSubgroup={false}
                    selectable
                    selected={selection.isSelected(ep.id)}
                    onToggleSelect={(r, shiftKey) => selection.toggle(r.id, shiftKey)}
                    onDownload={(r) => onRequestDownload(r, detail, activeSubgroup, languageFilter)}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>

      {detail && (
        <BatchActionBar
          selectedCount={selection.selectedCount}
          totalSizeBytes={selection.totalSizeBytes}
          allVisibleSelected={selection.allVisibleSelected}
          onSelectAll={selection.selectAll}
          onInvertSelection={selection.invertSelection}
          onClear={selection.clear}
          onBatchDownload={() =>
            onRequestBatchDownload(
              selection.selectedReleases,
              detail,
              selection.clear,
              activeSubgroup,
              languageFilter,
            )
          }
        />
      )}
    </div>
  );
};

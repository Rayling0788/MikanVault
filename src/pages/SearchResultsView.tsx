import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Film,
  FileArchive,
  AlertCircle,
  History,
  Sparkles,
  CalendarRange,
  CheckSquare,
  RefreshCw,
  Trash2,
  X,
  Languages,
} from 'lucide-react';
import {
  MIKAN_DAY_LABELS,
  type MikanBangumiCard,
  type MikanRelease,
  type MikanScheduleResponse,
  type MikanSearchResult,
  type MikanSeasonName,
  type SubtitleLanguageFilter,
} from '@shared/types';
import {
  countSubtitleLanguages,
  matchesSubtitleLanguage,
} from '@shared/subtitleLanguage';
import { api } from '@/lib/api';
import { PosterImage } from '@/components/PosterImage';
import { ReleaseRow } from '@/components/ReleaseRow';
import { BatchActionBar } from '@/components/BatchActionBar';
import { useReleaseSelection } from '@/hooks/useReleaseSelection';

interface SearchResultsViewProps {
  query: string;
  result: MikanSearchResult | null;
  loading: boolean;
  error: string | null;
  onSearch: (query: string) => void;
  onOpenBangumi: (card: MikanBangumiCard) => void;
  onRequestDownload: (release: MikanRelease) => void;
  onRequestBatchDownload: (releases: MikanRelease[], onDoneClear: () => void) => void;
}

type SearchMode = 'search' | 'archive';

const HISTORY_STORAGE_KEY = 'mikanvault_search_history';
const CLASSIC_CHIPS = [
  '命运石之门',
  '进击的巨人',
  '钢之炼金术师',
  '轻音少女',
  '凉宫春日',
  'CLANNAD',
  '物语系列',
  '魔法少女小圆',
  '星际牛仔',
  '新世纪福音战士',
];

const ARCHIVE_YEARS = Array.from({ length: 15 }, (_, idx) => 2026 - idx);
const ARCHIVE_SEASONS: Array<{ value: MikanSeasonName; label: string }> = [
  { value: '冬', label: '冬 · 1月' },
  { value: '春', label: '春 · 4月' },
  { value: '夏', label: '夏 · 7月' },
  { value: '秋', label: '秋 · 10月' },
];

function readSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeSearchHistory(list: string[]): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(list.slice(0, 10)));
  } catch {
    // Ignore storage quota errors
  }
}

export const SearchResultsView: React.FC<SearchResultsViewProps> = ({
  query,
  result,
  loading,
  error,
  onSearch,
  onOpenBangumi,
  onRequestDownload,
  onRequestBatchDownload,
}) => {
  const [mode, setMode] = useState<SearchMode>('search');
  const [localInput, setLocalInput] = useState(query);
  const [history, setHistory] = useState<string[]>(() => readSearchHistory());

  // Release result filtering
  const [subgroupFilter, setSubgroupFilter] = useState<string>('all');
  const [languageFilter, setLanguageFilter] = useState<SubtitleLanguageFilter>('all');
  const [releaseFilterText, setReleaseFilterText] = useState('');

  // Historical season archive state
  const [archiveYear, setArchiveYear] = useState<number>(2020);
  const [archiveSeason, setArchiveSeason] = useState<MikanSeasonName>('秋');
  const [archiveFilterText, setArchiveFilterText] = useState('');
  const [archiveData, setArchiveData] = useState<MikanScheduleResponse | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const archiveCacheRef = useRef<Map<string, MikanScheduleResponse>>(new Map());

  useEffect(() => {
    setLocalInput(query);
    if (query.trim()) {
      setMode('search');
    }
  }, [query]);

  useEffect(() => {
    setSubgroupFilter('all');
    setReleaseFilterText('');
  }, [result?.query]);

  const recordHistory = (term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setHistory((prev) => {
      const next = [clean, ...prev.filter((item) => item !== clean)].slice(0, 10);
      writeSearchHistory(next);
      return next;
    });
  };

  const triggerSearch = (term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setMode('search');
    setLocalInput(clean);
    recordHistory(clean);
    onSearch(clean);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    triggerSearch(localInput);
  };

  const handleClearHistory = () => {
    setHistory([]);
    writeSearchHistory([]);
  };

  const loadArchiveSeason = async (year: number, season: MikanSeasonName) => {
    const key = `${year}-${season}`;
    const cached = archiveCacheRef.current.get(key);
    if (cached) {
      setArchiveData(cached);
      setArchiveError(null);
      return;
    }
    setArchiveLoading(true);
    setArchiveError(null);
    try {
      const data = await api.getSchedule(year, season);
      archiveCacheRef.current.set(key, data);
      setArchiveData(data);
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : '加载历年番剧库失败');
    } finally {
      setArchiveLoading(false);
    }
  };

  useEffect(() => {
    if (mode === 'archive') {
      void loadArchiveSeason(archiveYear, archiveSeason);
    }
  }, [mode, archiveYear, archiveSeason]);

  const bangumis = result?.bangumis || [];
  const allReleases = useMemo(() => result?.releases || [], [result?.releases]);

  const availableSubgroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const rel of allReleases) {
      const sg = rel.subgroup?.trim();
      if (!sg) continue;
      counts.set(sg, (counts.get(sg) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1]);
  }, [allReleases]);

  const subgroupFilteredReleases = useMemo(() => {
    return allReleases.filter((rel) => {
      if (subgroupFilter !== 'all' && (rel.subgroup || '').trim() !== subgroupFilter) {
        return false;
      }
      return true;
    });
  }, [allReleases, subgroupFilter]);

  const availableLanguages = useMemo(
    () => countSubtitleLanguages(subgroupFilteredReleases.map((r) => r.title)),
    [subgroupFilteredReleases],
  );

  const filteredReleases = useMemo(() => {
    const kw = releaseFilterText.trim().toLowerCase();
    return subgroupFilteredReleases.filter((rel) => {
      if (!matchesSubtitleLanguage(rel.title, languageFilter)) {
        return false;
      }
      if (kw && !rel.title.toLowerCase().includes(kw)) {
        return false;
      }
      return true;
    });
  }, [subgroupFilteredReleases, languageFilter, releaseFilterText]);

  const selection = useReleaseSelection(filteredReleases);

  useEffect(() => {
    setLanguageFilter('all');
  }, [result?.query, subgroupFilter]);

  useEffect(() => {
    selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.query, subgroupFilter, languageFilter]);

  const archiveItems = useMemo(() => {
    if (!archiveData) return [];
    const seen = new Set<string>();
    const list: MikanBangumiCard[] = [];
    for (const g of archiveData.groups) {
      for (const item of g.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          list.push(item);
        }
      }
    }
    const kw = archiveFilterText.trim().toLowerCase();
    if (!kw) return list;
    return list.filter((b) => b.title.toLowerCase().includes(kw));
  }, [archiveData, archiveFilterText]);

  const hasQuery = Boolean(query.trim());
  const isEmptyResult = hasQuery && !loading && !error && bangumis.length === 0 && allReleases.length === 0;

  return (
    <div
      className={`mx-auto max-w-[1360px] space-y-6 px-6 py-6 ${
        selection.selectedCount > 0 ? 'pb-24' : 'pb-14'
      }`}
    >
      {/* Top Search & Mode Header Card */}
      <section className="card-elevated relative overflow-hidden rounded-2xl p-5">
        <div className="pointer-events-none absolute -top-20 -right-14 h-56 w-56 rounded-full bg-[#FF7A2F]/12 blur-3xl" />
        <div className="relative space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF7A2F]/15 text-[#FF7A2F] ring-1 ring-[#FF7A2F]/25">
                {mode === 'search' ? (
                  <Search className="h-4 w-4" />
                ) : (
                  <CalendarRange className="h-4 w-4" />
                )}
              </div>
              <div>
                <h2 className="text-[15.5px] font-semibold text-white">
                  全站搜番与历年老番档案库
                </h2>
                <p className="text-[12px] text-slate-400">
                  支持搜索任意年份的完结老番、冷门作品或字幕组，也可按年份季度回溯 2012–2026 番剧表
                </p>
              </div>
            </div>

            {/* Segmented Mode Switcher */}
            <div className="flex items-center rounded-xl border border-white/[0.08] bg-[#0B0D11]/80 p-1">
              <button
                type="button"
                onClick={() => setMode('search')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
                  mode === 'search'
                    ? 'bg-[#FF7A2F] text-[#0B0D11] font-semibold shadow-[0_2px_10px_rgba(255,122,47,0.4)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Search className="h-3.5 w-3.5" />
                全站搜番
              </button>
              <button
                type="button"
                onClick={() => setMode('archive')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
                  mode === 'archive'
                    ? 'bg-[#FF7A2F] text-[#0B0D11] font-semibold shadow-[0_2px_10px_rgba(255,122,47,0.4)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <CalendarRange className="h-3.5 w-3.5" />
                历年季度老番库
              </button>
            </div>
          </div>

          {mode === 'search' ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={localInput}
                  onChange={(e) => setLocalInput(e.target.value)}
                  placeholder="输入老番中文名、日文原名、英文或字幕组，例如：命运石之门、Cowboy Bebop、VCB-Studio..."
                  className="input-cinema h-11 w-full rounded-xl pr-9 pl-10 text-[13.5px] placeholder:text-slate-500"
                />
                {localInput && (
                  <button
                    type="button"
                    onClick={() => setLocalInput('')}
                    className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-white/[0.08] hover:text-white"
                    aria-label="清空输入"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={loading || !localInput.trim()}
                className="btn-mikan inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-6 text-[13.5px]"
              >
                <Search className="h-4 w-4" />
                {loading ? '搜索中...' : '搜索全站'}
              </button>
            </form>
          ) : (
            <div className="space-y-3 border-t border-white/[0.06] pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-medium text-slate-400">年份：</span>
                <div className="no-scrollbar flex flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">
                  {ARCHIVE_YEARS.map((y) => (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setArchiveYear(y)}
                      className={`shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-medium tabular-nums transition ${
                        archiveYear === y
                          ? 'bg-[#FF7A2F] text-[#0B0D11] font-semibold'
                          : 'border border-white/[0.07] bg-[#0B0D11]/70 text-slate-300 hover:border-white/[0.16] hover:text-white'
                      }`}
                    >
                      {y}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-medium text-slate-400">季度：</span>
                  {ARCHIVE_SEASONS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => setArchiveSeason(s.value)}
                      className={`rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
                        archiveSeason === s.value
                          ? 'border border-[#FF7A2F]/50 bg-[#FF7A2F]/18 text-[#FF9E4F] font-semibold'
                          : 'border border-white/[0.07] bg-[#0B0D11]/70 text-slate-300 hover:border-white/[0.16] hover:text-white'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={archiveFilterText}
                    onChange={(e) => setArchiveFilterText(e.target.value)}
                    placeholder={`在 ${archiveYear} 年${archiveSeason}番中筛选...`}
                    className="input-cinema h-9 w-full rounded-xl pr-3 pl-8 text-[12.5px]"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Mode 2: Historical Season Archive */}
      {mode === 'archive' ? (
        archiveLoading ? (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="skeleton-shimmer aspect-[3/4] rounded-[14px]" />
            ))}
          </div>
        ) : archiveError ? (
          <div className="card-elevated rounded-2xl p-10 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-[#FF7A2F]" />
            <h3 className="mt-3 text-[15px] font-semibold text-white">加载季度档案失败</h3>
            <p className="mt-1 text-[13px] text-slate-400">{archiveError}</p>
            <button
              type="button"
              onClick={() => {
                archiveCacheRef.current.delete(`${archiveYear}-${archiveSeason}`);
                void loadArchiveSeason(archiveYear, archiveSeason);
              }}
              className="btn-mikan mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px]"
            >
              <RefreshCw className="h-4 w-4" />
              重试
            </button>
          </div>
        ) : (
          <section className="space-y-4">
            <div className="flex items-center justify-between text-[13px] text-slate-400">
              <div className="flex items-center gap-2">
                <Film className="h-4 w-4 text-[#FF7A2F]" />
                <span className="font-semibold text-white">
                  {archiveYear} 年{archiveSeason}季番剧
                </span>
                <span className="tabular-nums text-slate-400">({archiveItems.length} 部)</span>
              </div>
              <span className="text-[12px] text-slate-500">点击任意海报即可查看字幕组与批量下载全集</span>
            </div>

            {archiveItems.length === 0 ? (
              <div className="card-elevated rounded-2xl py-14 text-center text-[13.5px] text-slate-400">
                该季度下暂无匹配的番剧记录
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {archiveItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenBangumi(item)}
                    className="poster-card group aspect-[3/4] text-left"
                  >
                    <PosterImage
                      url={item.coverUrl}
                      title={item.title}
                      className="h-full w-full"
                      imgClassName="poster-img"
                    />
                    <div className="pointer-events-none absolute top-2.5 left-2.5">
                      <span className="rounded-md border border-white/[0.08] bg-[#0B0D11]/75 px-2 py-0.5 text-[10.5px] font-medium text-slate-200 backdrop-blur-md">
                        {MIKAN_DAY_LABELS[item.updateDay] || `${archiveYear}${archiveSeason}`}
                      </span>
                    </div>
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#080A0E] via-[#0B0D11]/88 to-transparent px-3 pt-12 pb-3">
                      <h3 className="line-clamp-2 text-[13px] font-semibold text-white group-hover:text-[#FF9E4F]">
                        {item.title}
                      </h3>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )
      ) : !hasQuery && !loading ? (
        /* Mode 1 Idle State: Old Anime Recommendations & Search History */
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="card-elevated rounded-2xl p-5 space-y-3.5">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-white">
              <Sparkles className="h-4 w-4 text-[#FF7A2F]" />
              经典老番快捷检索
            </div>
            <p className="text-[12.5px] text-slate-400">
              点击标签直达蜜柑计划全站搜索，支持查看历年合集与 BDRip 高清资源
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {CLASSIC_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => triggerSearch(chip)}
                  className="rounded-xl border border-white/[0.08] bg-[#0B0D11]/75 px-3 py-1.5 text-[12.5px] text-slate-200 transition hover:border-[#FF7A2F]/45 hover:bg-[#FF7A2F]/12 hover:text-white"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          <div className="card-elevated rounded-2xl p-5 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-white">
                <History className="h-4 w-4 text-[#38BDF8]" />
                最近搜索记录
              </div>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="inline-flex items-center gap-1 text-[11.5px] text-slate-500 transition hover:text-slate-300"
                >
                  <Trash2 className="h-3 w-3" />
                  清空
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/[0.08] py-8 text-center text-[12.5px] text-slate-500">
                暂无搜索历史，输入任意老番名称即可开始检索
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 pt-1">
                {history.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => triggerSearch(term)}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[12.5px] text-slate-200 transition hover:border-[#38BDF8]/40 hover:bg-[#38BDF8]/12 hover:text-white"
                  >
                    {term}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : loading ? (
        <div className="space-y-6">
          <div className="skeleton-shimmer h-7 w-60 rounded-lg" />
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton-shimmer aspect-[3/4] rounded-[14px]" />
            ))}
          </div>
          <div className="space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton-shimmer h-[72px] rounded-xl" />
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="card-elevated mx-auto max-w-md rounded-2xl p-7 text-center">
          <AlertCircle className="mx-auto h-9 w-9 text-[#FF7A2F]" />
          <h3 className="mt-3 text-[15px] font-semibold text-white">搜索请求失败</h3>
          <p className="mt-1 text-[13px] text-slate-400">{error}</p>
        </div>
      ) : isEmptyResult ? (
        <div className="card-elevated flex flex-col items-center justify-center rounded-2xl py-16 text-center">
          <Search className="h-9 w-9 text-slate-600" />
          <p className="mt-3 text-[14.5px] font-medium text-slate-300">
            未找到与“{query}”相关的番剧或种子
          </p>
          <p className="mt-1 text-[12.5px] text-slate-500">
            建议尝试日文原名、英文缩写，或切换到「历年季度老番库」按年份浏览
          </p>
        </div>
      ) : (
        /* Mode 1 Search Results */
        <div className="space-y-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-[17px] font-bold text-white">
                “<span className="text-[#FF9E4F]">{query}</span>” 的搜索结果
              </h3>
              <p className="mt-0.5 text-[12.5px] text-slate-400 tabular-nums">
                找到 {bangumis.length} 部相关番剧，{allReleases.length} 条种子资源
              </p>
            </div>
          </div>

          {/* Matching Bangumis */}
          {bangumis.length > 0 && (
            <section className="space-y-3.5">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-200">
                <Film className="h-4 w-4 text-[#FF7A2F]" />
                <span>相关番剧（点击进入可按字幕组批量下载全部集数）</span>
                <span className="text-[12px] font-normal text-slate-500 tabular-nums">
                  ({bangumis.length})
                </span>
              </div>
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {bangumis.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onOpenBangumi(b)}
                    className="poster-card group aspect-[3/4] text-left"
                  >
                    <PosterImage
                      url={b.coverUrl}
                      title={b.title}
                      className="h-full w-full"
                      imgClassName="poster-img"
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#080A0E] via-[#0B0D11]/88 to-transparent px-3 pt-12 pb-3">
                      <h3 className="line-clamp-2 text-[13px] font-semibold text-white group-hover:text-[#FF9E4F]">
                        {b.title}
                      </h3>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Matching Releases with Subgroup Filter & Batch Selection */}
          {allReleases.length > 0 && (
            <section className="space-y-3.5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-slate-200">
                  <FileArchive className="h-4 w-4 text-[#38BDF8]" />
                  <span>种子资源</span>
                  <span className="text-[12px] font-normal text-slate-500 tabular-nums">
                    ({filteredReleases.length} / {allReleases.length})
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-full sm:w-56">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                    <input
                      type="text"
                      value={releaseFilterText}
                      onChange={(e) => setReleaseFilterText(e.target.value)}
                      placeholder="筛选集数/画质/合集..."
                      className="input-cinema h-8 w-full rounded-xl pr-3 pl-8 text-[12px]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={
                      selection.allVisibleSelected ? selection.clear : selection.selectAll
                    }
                    className="btn-ghost-dark inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-medium"
                  >
                    <CheckSquare className="h-3.5 w-3.5 text-[#FF9E4F]" />
                    {selection.allVisibleSelected ? '取消全选' : '全选当前'}
                  </button>
                  <button
                    type="button"
                    onClick={selection.invertSelection}
                    className="btn-ghost-dark inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[12px] font-medium"
                  >
                    <RefreshCw className="h-3 w-3 text-slate-400" />
                    反选
                  </button>
                </div>
              </div>

              {availableSubgroups.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSubgroupFilter('all')}
                    className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition ${
                      subgroupFilter === 'all'
                        ? 'bg-[#FF7A2F] text-[#0B0D11] font-semibold'
                        : 'border border-white/[0.07] bg-[#12151C] text-slate-300 hover:text-white'
                    }`}
                  >
                    全部字幕组 ({allReleases.length})
                  </button>
                  {availableSubgroups.map(([sg, count]) => (
                    <button
                      key={sg}
                      type="button"
                      onClick={() => setSubgroupFilter(sg)}
                      className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition tabular-nums ${
                        subgroupFilter === sg
                          ? 'bg-[#FF7A2F] text-[#0B0D11] font-semibold'
                          : 'border border-white/[0.07] bg-[#12151C] text-slate-300 hover:text-white'
                      }`}
                    >
                      {sg} ({count})
                    </button>
                  ))}
                </div>
              )}

              {availableLanguages.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 inline-flex items-center gap-1 text-[11.5px] text-slate-400">
                    <Languages className="h-3.5 w-3.5 text-sky-400" />
                    字幕语言：
                  </span>
                  <button
                    type="button"
                    onClick={() => setLanguageFilter('all')}
                    className={`shrink-0 rounded-full px-3 py-1 text-[11.5px] font-medium transition tabular-nums ${
                      languageFilter === 'all'
                        ? 'bg-sky-500 text-[#0B0D11] font-semibold'
                        : 'border border-white/[0.07] bg-[#12151C] text-slate-300 hover:text-white'
                    }`}
                  >
                    全部语言 ({subgroupFilteredReleases.length})
                  </button>
                  {availableLanguages.map((lang) => (
                    <button
                      key={lang.id}
                      type="button"
                      onClick={() => setLanguageFilter(lang.id)}
                      className={`shrink-0 rounded-full px-3 py-1 text-[11.5px] font-medium transition tabular-nums ${
                        languageFilter === lang.id
                          ? 'bg-sky-500 text-[#0B0D11] font-semibold'
                          : 'border border-white/[0.07] bg-[#12151C] text-slate-300 hover:text-white'
                      }`}
                    >
                      {lang.shortLabel} ({lang.count})
                    </button>
                  ))}
                </div>
              )}

              {filteredReleases.length === 0 ? (
                <div className="card-elevated rounded-2xl py-12 text-center text-[13px] text-slate-400">
                  当前筛选条件下没有匹配的种子资源
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredReleases.map((rel) => (
                    <ReleaseRow
                      key={rel.id}
                      release={rel}
                      selectable
                      selected={selection.isSelected(rel.id)}
                      onToggleSelect={(r, shiftKey) => selection.toggle(r.id, shiftKey)}
                      onDownload={onRequestDownload}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <BatchActionBar
        selectedCount={selection.selectedCount}
        totalSizeBytes={selection.totalSizeBytes}
        allVisibleSelected={selection.allVisibleSelected}
        onSelectAll={selection.selectAll}
        onInvertSelection={selection.invertSelection}
        onClear={selection.clear}
        onBatchDownload={() =>
          onRequestBatchDownload(selection.selectedReleases, selection.clear)
        }
      />
    </div>
  );
};

import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  Link2,
  Rss,
  RefreshCw,
  Search,
  Sparkles,
  AlertCircle,
  Loader2,
  RotateCcw,
  CheckSquare,
  Languages,
} from 'lucide-react';
import type {
  MikanBangumiDetail,
  MikanRelease,
  SubtitleLanguageFilter,
} from '@shared/types';
import {
  countSubtitleLanguages,
  matchesSubtitleLanguage,
} from '@shared/subtitleLanguage';
import { api } from '@/lib/api';
import {
  getCachedRssFeed,
  setCachedRssFeed,
} from '@/lib/mikanClientCache';
import { ReleaseRow } from '@/components/ReleaseRow';
import { BatchActionBar } from '@/components/BatchActionBar';
import { useToast } from '@/hooks/useToast';
import { useReleaseSelection } from '@/hooks/useReleaseSelection';

interface LatestRssPageProps {
  initialRssUrl?: string;
  onOpenBangumiDetail: (id: string, detail?: MikanBangumiDetail) => void;
  onRequestDownload: (release: MikanRelease) => void;
  onRequestBatchDownload: (releases: MikanRelease[], onDoneClear: () => void) => void;
}

export const LatestRssPage: React.FC<LatestRssPageProps> = ({
  initialRssUrl,
  onOpenBangumiDetail,
  onRequestDownload,
  onRequestBatchDownload,
}) => {
  const { pushToast } = useToast();
  const [urlInput, setUrlInput] = useState(initialRssUrl || '');
  const [activeRssUrl, setActiveRssUrl] = useState<string | undefined>(initialRssUrl);
  const [releases, setReleases] = useState<MikanRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const deferredKeyword = useDeferredValue(keyword);
  const [languageFilter, setLanguageFilter] = useState<SubtitleLanguageFilter>('all');
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(60);

  const loadFeed = async (targetRss?: string, forceRefresh = false) => {
    const cacheKey = targetRss?.trim() || '__default__';
    if (!forceRefresh) {
      const cached = getCachedRssFeed(cacheKey);
      if (cached) {
        setReleases(cached);
        setLoading(false);
        setError(null);
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const list = await api.getRssFeed(targetRss);
      const safe = Array.isArray(list) ? list : [];
      setCachedRssFeed(cacheKey, safe);
      setReleases(safe);
      setLastFetched(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : '拉取 RSS 列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setActiveRssUrl(initialRssUrl);
    setLanguageFilter('all');
    if (initialRssUrl) {
      setUrlInput(initialRssUrl);
    }
    void loadFeed(initialRssUrl);
  }, [initialRssUrl]);

  const handleResolveUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setActiveRssUrl(undefined);
      void loadFeed(undefined);
      return;
    }

    setResolving(true);
    try {
      const resolved = await api.resolveMikanUrl(trimmed);
      if (resolved.kind === 'bangumi') {
        pushToast({
          kind: 'success',
          title: '已识别蜜柑番剧主页',
          description: resolved.detail?.title || `正在打开番剧 #${resolved.bangumiId}`,
        });
        onOpenBangumiDetail(resolved.bangumiId, resolved.detail);
      } else if (resolved.kind === 'episode' && resolved.release) {
        pushToast({
          kind: 'info',
          title: '已解析单集种子链接',
          description: '请确认保存目录后发送到 qBittorrent',
        });
        onRequestDownload(resolved.release);
      } else if (resolved.kind === 'rss') {
        setActiveRssUrl(resolved.rssUrl);
        if (resolved.releases) {
          setReleases(resolved.releases);
          setLastFetched(Date.now());
        } else {
          await loadFeed(resolved.rssUrl);
        }
        pushToast({
          kind: 'success',
          title: '已切换自定义 RSS 订阅源',
          description: resolved.rssUrl,
        });
      } else {
        pushToast({
          kind: 'error',
          title: '链接解析失败',
          description: resolved.kind === 'unknown' ? resolved.error : '未能识别该蜜柑链接格式',
        });
      }
    } catch (err) {
      pushToast({
        kind: 'error',
        title: '解析链接出错',
        description: err instanceof Error ? err.message : '请检查链接是否完整有效',
      });
    } finally {
      setResolving(false);
    }
  };

  const handleResetDefault = () => {
    setUrlInput('');
    setActiveRssUrl(undefined);
    setLanguageFilter('all');
    setVisibleCount(60);
    void loadFeed(undefined);
  };

  const availableLanguages = useMemo(
    () => countSubtitleLanguages(releases.map((r) => r.title)),
    [releases],
  );

  const unclassifiedLanguageCount = useMemo(() => {
    const classified = availableLanguages.reduce((sum, l) => sum + l.count, 0);
    return Math.max(0, releases.length - classified);
  }, [releases.length, availableLanguages]);

  const showLanguageFilterBar =
    availableLanguages.length >= 2 ||
    (availableLanguages.length === 1 && unclassifiedLanguageCount > 0);

  const filteredReleases = useMemo(() => {
    const q = deferredKeyword.trim().toLowerCase();
    return releases.filter((r) => {
      if (!matchesSubtitleLanguage(r.title, languageFilter)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.subgroup && r.subgroup.toLowerCase().includes(q)) ||
        (r.bangumiTitle && r.bangumiTitle.toLowerCase().includes(q))
      );
    });
  }, [releases, deferredKeyword, languageFilter]);

  useEffect(() => {
    setVisibleCount(60);
  }, [activeRssUrl, deferredKeyword, languageFilter]);

  const selection = useReleaseSelection(filteredReleases);

  return (
    <div
      className={`mx-auto max-w-[1320px] space-y-6 px-6 py-6 ${
        selection.selectedCount > 0 ? 'pb-24' : 'pb-14'
      }`}
    >
      {/* Smart Paste Mikan URL / Custom RSS Bar */}
      <section className="card-elevated relative overflow-hidden rounded-2xl p-5">
        <div className="relative space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#FF7A2F]" />
              <h2 className="text-[14.5px] font-semibold text-white">
                快速解析蜜柑计划链接 / 自定义 RSS
              </h2>
            </div>
            {activeRssUrl && (
              <button
                type="button"
                onClick={handleResetDefault}
                className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11.5px] text-slate-300 transition hover:bg-white/[0.09] hover:text-white"
              >
                <RotateCcw className="h-3 w-3" />
                恢复默认全站最新
              </button>
            )}
          </div>

          <form onSubmit={handleResolveUrl} className="flex flex-col gap-2.5 sm:flex-row">
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="粘贴 mikanani.kas.pub 番剧页、单集页或 RSS 订阅链接..."
                className="input-cinema h-10 w-full rounded-xl pr-4 pl-10 text-[13px] placeholder:text-slate-500"
              />
            </div>
            <button
              type="submit"
              disabled={resolving}
              className="btn-mikan inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-[13px]"
            >
              {resolving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  解析中...
                </>
              ) : (
                <>
                  <Rss className="h-4 w-4" />
                  解析并载入
                </>
              )}
            </button>
          </form>
        </div>
      </section>

      {/* Feed Toolbar */}
      <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#FF7A2F] shadow-[0_0_8px_rgba(255,122,47,0.8)]" />
            <h3 className="text-[15px] font-semibold text-white">
              {activeRssUrl ? '自定义 RSS 更新列表' : '蜜柑全站最新更新'}
            </h3>
          </div>
          <span className="rounded-md bg-white/[0.05] px-2 py-0.5 text-[11.5px] text-slate-400 tabular-nums">
            {filteredReleases.length} 条
          </span>
          {lastFetched && (
            <span className="hidden text-[11.5px] text-slate-500 tabular-nums md:inline">
              更新于 {new Date(lastFetched).toLocaleTimeString('zh-CN', { hour12: false })}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative flex-1 sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="快速筛选标题、字幕组..."
              className="input-cinema h-9 w-full rounded-xl pr-3 pl-8 text-[12.5px]"
            />
          </div>
          <button
            type="button"
            onClick={selection.allVisibleSelected ? selection.clear : selection.selectAll}
            disabled={filteredReleases.length === 0}
            className="btn-ghost-dark inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-medium disabled:opacity-50"
          >
            <CheckSquare className="h-3.5 w-3.5 text-[#FF9E4F]" />
            {selection.allVisibleSelected ? '取消全选' : '全选'}
          </button>
          <button
            type="button"
            onClick={() => void loadFeed(activeRssUrl, true)}
            disabled={loading}
            className="btn-ghost-dark inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </section>

      {/* Subtitle Language Filter Pills */}
      {showLanguageFilterBar && (
        <section className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/[0.06] bg-[#12151C]/55 px-3 py-2">
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
            全部语言 ({releases.length})
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
        </section>
      )}

      {/* Release Feed List */}
      {loading && releases.length === 0 ? (
        <div className="space-y-2.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer h-[76px] w-full rounded-xl" />
          ))}
        </div>
      ) : error && releases.length === 0 ? (
        <div className="card-elevated rounded-2xl p-10 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-[#FF7A2F]" />
          <h3 className="mt-3 text-[15px] font-semibold text-white">RSS 订阅拉取失败</h3>
          <p className="mt-1 text-[13px] text-slate-400">{error}</p>
          <button
            type="button"
            onClick={() => void loadFeed(activeRssUrl, true)}
            className="btn-mikan mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px]"
          >
            <RefreshCw className="h-4 w-4" />
            重新拉取
          </button>
        </div>
      ) : filteredReleases.length === 0 ? (
        <div className="card-elevated rounded-2xl py-14 text-center text-[13.5px] text-slate-400">
          没有匹配当前条件的发布资源
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredReleases.slice(0, visibleCount).map((rel) => (
            <ReleaseRow
              key={rel.id}
              release={rel}
              selectable
              selected={selection.isSelected(rel.id)}
              onToggleSelect={(r, shiftKey) => selection.toggle(r.id, shiftKey)}
              onDownload={onRequestDownload}
              onOpenBangumi={(bid) => onOpenBangumiDetail(bid)}
            />
          ))}
          {filteredReleases.length > visibleCount && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + 60)}
                className="btn-ghost-dark inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[12.5px] font-medium"
              >
                加载更多资源（剩余 {filteredReleases.length - visibleCount} 条）
              </button>
              <button
                type="button"
                onClick={() => setVisibleCount(filteredReleases.length)}
                className="btn-ghost-dark inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[12.5px] font-medium"
              >
                显示全部
              </button>
            </div>
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

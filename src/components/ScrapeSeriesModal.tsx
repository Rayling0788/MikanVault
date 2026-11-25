import React, { useEffect, useState } from 'react';
import {
  X,
  Search,
  Sparkles,
  Loader2,
  Check,
  AlertCircle,
  Wand2,
} from 'lucide-react';
import type {
  LibraryScrapeSeriesResult,
  LibrarySeries,
  MikanBangumiCard,
} from '@shared/types';
import { api } from '@/lib/api';
import { PosterImage } from './PosterImage';

interface ScrapeSeriesModalProps {
  series: LibrarySeries | null;
  onClose: () => void;
  onScraped: (res: LibraryScrapeSeriesResult) => void;
}

function deriveInitialQuery(rawTitle: string): string {
  return (
    rawTitle
      .replace(/^(?:[\[【][^\]】]+[\]】]\s*)+/, '')
      .replace(/[\[【][^\]】]*(?:1080p|720p|2160p|4k|bdrip|webrip|hevc|x265|10bit|简|繁|合集|全集)[^\]】]*[\]】]/gi, ' ')
      .replace(/\((?:19|20)\d{2}\)/g, ' ')
      .replace(/[._]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || rawTitle.trim()
  );
}

export const ScrapeSeriesModal: React.FC<ScrapeSeriesModalProps> = ({
  series,
  onClose,
  onScraped,
}) => {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<MikanBangumiCard[]>([]);
  const [searching, setSearching] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [autoMatching, setAutoMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setSearching(true);
    setError(null);
    try {
      const res = await api.searchMikan(clean);
      setCandidates(res.bangumis || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索蜜柑计划失败');
      setCandidates([]);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (!series) return;
    const initial = deriveInitialQuery(series.originalTitle || series.title);
    setQuery(initial);
    setCandidates([]);
    setApplyingId(null);
    setAutoMatching(false);
    setError(null);
    void runSearch(initial);
  }, [series]);

  useEffect(() => {
    if (!series) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !applyingId && !autoMatching) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [series, applyingId, autoMatching, onClose]);

  if (!series) return null;

  const busy = Boolean(applyingId) || autoMatching;

  const handleSelectCandidate = async (card: MikanBangumiCard) => {
    if (busy) return;
    setApplyingId(card.id);
    setError(null);
    try {
      const res = await api.libraryScrapeSeries({
        seriesId: series.seriesId,
        folderPath: series.folderPath,
        currentTitle: series.originalTitle || series.title,
        bangumiId: card.id,
      });
      if (res.ok) {
        onScraped(res);
        onClose();
      } else {
        setError(res.error || '应用刮削元数据失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '刮削失败');
    } finally {
      setApplyingId(null);
    }
  };

  const handleAutoMatch = async () => {
    if (busy) return;
    setAutoMatching(true);
    setError(null);
    try {
      const res = await api.libraryScrapeSeries({
        seriesId: series.seriesId,
        folderPath: series.folderPath,
        currentTitle: series.originalTitle || series.title,
        query: query.trim() || series.title,
      });
      if (res.ok) {
        onScraped(res);
        onClose();
      } else {
        setError(res.error || '未能自动匹配，请在下方选择或更换关键词');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '自动匹配失败');
    } finally {
      setAutoMatching(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="scrape-modal-title"
    >
      <div className="animate-modal-enter glass-panel flex max-h-[86vh] w-full max-w-[740px] flex-col overflow-hidden rounded-2xl border border-white/[0.1] shadow-[0_24px_80px_rgba(0,0,0,0.88)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FF7A2F]/15 text-[#FF7A2F] ring-1 ring-[#FF7A2F]/25">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 id="scrape-modal-title" className="truncate text-[15px] font-semibold text-white">
                刮削与匹配番剧元数据
              </h2>
              <p className="truncate text-[11.5px] text-slate-400" title={series.folderPath}>
                当前项目：{series.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
            aria-label="关闭弹窗"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search & Auto Match Controls */}
        <div className="border-b border-white/[0.06] bg-[#0B0D11]/55 px-5 py-3.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(query);
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="输入番剧中文名、日文名或英文名..."
                className="input-cinema h-10 w-full rounded-xl pr-3 pl-9 text-[13px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={searching || busy || !query.trim()}
                className="btn-ghost-dark inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-[12.5px] font-medium"
              >
                {searching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                搜索候选
              </button>
              <button
                type="button"
                onClick={() => void handleAutoMatch()}
                disabled={busy || !query.trim()}
                className="btn-mikan inline-flex h-10 items-center gap-1.5 rounded-xl px-4 text-[12.5px]"
              >
                {autoMatching ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                自动最佳匹配
              </button>
            </div>
          </form>

          {error && (
            <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Candidate Grid */}
        <div className="min-h-[260px] flex-1 overflow-y-auto p-5">
          {searching ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton-shimmer aspect-[3/4] rounded-xl" />
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] text-center">
              <Search className="h-7 w-7 text-slate-600" />
              <p className="mt-2.5 text-[13.5px] font-medium text-slate-300">
                未找到匹配的番剧卡片
              </p>
              <p className="mt-1 text-[12px] text-slate-500">
                请删减画质/季度后缀后重新搜索，例如只保留核心番剧名
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-[12px] text-slate-400">
                <span>点击下方任意海报即可写入封面、中文标准名与介绍信息：</span>
                <span className="tabular-nums text-slate-500">{candidates.length} 个候选</span>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {candidates.map((card) => {
                  const isApplying = applyingId === card.id;
                  const isCurrent = series.bangumiId === card.id;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void handleSelectCandidate(card)}
                      className={`poster-card group aspect-[3/4] text-left transition ${
                        isCurrent ? 'ring-2 ring-[#22C55E]' : ''
                      }`}
                    >
                      <PosterImage
                        url={card.coverUrl}
                        title={card.title}
                        className="h-full w-full"
                        imgClassName="poster-img"
                      />

                      {isCurrent && (
                        <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-[#22C55E] px-2 py-0.5 text-[10px] font-bold text-[#0B0D11]">
                          <Check className="h-3 w-3" />
                          当前
                        </span>
                      )}

                      {isApplying && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0B0D11]/75 backdrop-blur-xs">
                          <Loader2 className="h-6 w-6 animate-spin text-[#FF7A2F]" />
                          <span className="text-[11.5px] font-medium text-white">刮削写入中...</span>
                        </div>
                      )}

                      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#080A0E] via-[#0B0D11]/90 to-transparent px-2.5 pt-10 pb-2.5">
                        <div className="line-clamp-2 text-[12px] font-semibold leading-snug text-white group-hover:text-[#FF9E4F]">
                          {card.title}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

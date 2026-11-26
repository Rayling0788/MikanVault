import React, { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Sparkles,
  Calendar,
  ArrowRight,
  AlertCircle,
  Flame,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  MIKAN_DAY_LABELS,
  type MikanBangumiCard,
  type MikanScheduleResponse,
  type MikanSeasonName,
} from '@shared/types';
import { PosterImage } from '@/components/PosterImage';
import { useProxiedImage } from '@/hooks/useProxiedImage';

interface DiscoverPageProps {
  schedule: MikanScheduleResponse | null;
  loading: boolean;
  error: string | null;
  selectedSeason: { year?: number; season?: MikanSeasonName } | null;
  onSelectSeason: (year?: number, season?: MikanSeasonName) => void;
  onRefresh: () => void;
  onOpenBangumi: (card: MikanBangumiCard) => void;
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0, 7, 8];
const SEASON_NAMES: MikanSeasonName[] = ['冬', '春', '夏', '秋'];
const YEARS = Array.from({ length: 15 }, (_, idx) => 2026 - idx);

export const DiscoverPage: React.FC<DiscoverPageProps> = ({
  schedule,
  loading,
  error,
  selectedSeason,
  onSelectSeason,
  onRefresh,
  onOpenBangumi,
}) => {
  const [selectedDay, setSelectedDay] = useState<'all' | number>('all');
  const [spotlightIndex, setSpotlightIndex] = useState(0);
  const [heroHovered, setHeroHovered] = useState(false);

  const todayDow = new Date().getDay(); // 0=Sun..6=Sat

  const allItems = useMemo(() => {
    if (!schedule) return [];
    const seen = new Set<string>();
    const list: MikanBangumiCard[] = [];
    for (const g of schedule.groups) {
      for (const item of g.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          list.push(item);
        }
      }
    }
    return list;
  }, [schedule]);

  const groupMap = useMemo(() => {
    const map = new Map<number, MikanBangumiCard[]>();
    if (!schedule) return map;
    for (const g of schedule.groups) {
      map.set(g.dayOfWeek, g.items);
    }
    return map;
  }, [schedule]);

  // Featured candidates: prioritize updated anime or today's anime (up to 5)
  const featuredCandidates = useMemo(() => {
    const todayItems = groupMap.get(todayDow) || [];
    const updated = allItems.filter((i) => i.hasUpdate);
    const pool = [...todayItems.filter((i) => i.hasUpdate), ...updated, ...allItems];
    const unique: MikanBangumiCard[] = [];
    const ids = new Set<string>();
    for (const item of pool) {
      if (!ids.has(item.id)) {
        ids.add(item.id);
        unique.push(item);
      }
      if (unique.length >= 5) break;
    }
    return unique;
  }, [allItems, groupMap, todayDow]);

  // Auto-rotate Hero Spotlight every 8s when visible and not hovered
  useEffect(() => {
    if (featuredCandidates.length <= 1 || heroHovered) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        setSpotlightIndex((prev) => (prev + 1) % featuredCandidates.length);
      }
    }, 8000);
    return () => window.clearInterval(timer);
  }, [featuredCandidates.length, heroHovered]);

  const safeIndex = spotlightIndex % Math.max(featuredCandidates.length, 1);
  const activeHero = featuredCandidates[safeIndex] || null;
  const heroBg = useProxiedImage(activeHero?.coverUrl);

  const visibleItems = useMemo(() => {
    if (selectedDay === 'all') return allItems;
    return groupMap.get(selectedDay) || [];
  }, [selectedDay, allItems, groupMap]);

  if (loading && !schedule) {
    return (
      <div className="mx-auto max-w-[1440px] space-y-7 px-6 py-6">
        <div className="skeleton-shimmer h-[296px] w-full rounded-2xl border border-white/[0.06]" />
        <div className="flex gap-2">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="skeleton-shimmer h-9 w-20 rounded-full border border-white/[0.05]"
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, idx) => (
            <div key={idx} className="space-y-2.5">
              <div className="skeleton-shimmer aspect-[3/4] rounded-2xl border border-white/[0.05]" />
              <div className="skeleton-shimmer h-3.5 w-4/5 rounded-md" />
              <div className="skeleton-shimmer h-3 w-1/2 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !schedule) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="card-elevated max-w-md rounded-2xl p-7 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#FF7A2F]/14 text-[#FF7A2F]">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-[16px] font-semibold text-white">无法加载蜜柑计划放送表</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{error}</p>
          <button
            type="button"
            onClick={onRefresh}
            className="btn-mikan mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px]"
          >
            <RefreshCw className="h-4 w-4" />
            重新加载
          </button>
        </div>
      </div>
    );
  }

  const seasonSummary = schedule?.year
    ? `${schedule.year} 年${schedule.season ? `${schedule.season}季` : ''}新番`
    : '本季放送';

  return (
    <div className="mx-auto max-w-[1440px] space-y-7 px-6 py-6 pb-14">
      {/* Widescreen Cinema Hero Stage */}
      {activeHero && (
        <section
          onMouseEnter={() => setHeroHovered(true)}
          onMouseLeave={() => setHeroHovered(false)}
          className="hero-stage relative min-h-[296px] overflow-hidden rounded-2xl"
        >
          {/* Dual-layer Ambient Blurred Backdrop */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {heroBg.src && (
              <img
                src={heroBg.src}
                alt=""
                aria-hidden="true"
                className="h-full w-full scale-125 object-cover opacity-42 blur-2xl saturate-150 transition-opacity duration-500"
              />
            )}
            <div className="hero-scrim-h absolute inset-0" />
            <div className="hero-scrim-v absolute inset-0" />
            <div className="pointer-events-none absolute -top-24 -left-16 h-80 w-80 rounded-full bg-[#FF7A2F]/18 blur-2xl" />
          </div>

          <div className="relative flex min-h-[296px] flex-col justify-between gap-6 p-6 sm:flex-row sm:items-center md:px-8 md:py-7">
            {/* Left Editorial Info */}
            <div className="min-w-0 flex-1 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FF7A2F]/40 bg-[#FF7A2F]/18 px-3 py-1 text-[11px] font-semibold tracking-wide text-[#FF9E4F]">
                  <Sparkles className="h-3 w-3" />
                  本季焦点推荐
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-slate-200 backdrop-blur-md">
                  <Calendar className="h-3 w-3 text-slate-300" />
                  {MIKAN_DAY_LABELS[activeHero.updateDay] || '本季连载'}
                  {activeHero.updateDate ? ` · ${activeHero.updateDate}` : ''}
                </span>
                {activeHero.hasUpdate && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#22C55E]/20 px-2.5 py-1 text-[11px] font-medium text-emerald-300 ring-1 ring-[#22C55E]/35">
                    <Flame className="h-3 w-3" />
                    近期有新资源
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <h2 className="line-clamp-2 max-w-2xl text-[25px] leading-tight font-bold tracking-tight text-white md:text-[31px]">
                  {activeHero.title}
                </h2>
                <p className="max-w-2xl text-[13px] leading-relaxed text-slate-300/90">
                  {seasonSummary} · {MIKAN_DAY_LABELS[activeHero.updateDay] || '每周连载'}更新 ·
                  支持按简繁双语筛选与一键订阅追更
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenBangumi(activeHero)}
                  className="btn-mikan inline-flex h-10 items-center gap-2 rounded-xl px-5 text-[13.5px]"
                >
                  查看资源与字幕组
                  <ArrowRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={loading}
                  className="btn-ghost-dark inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-medium disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  刷新番组
                </button>
              </div>

              {/* Mini-Poster Switcher Strip with Animated Progress Hairline */}
              {featuredCandidates.length > 1 && (
                <div className="flex items-center gap-2 pt-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setSpotlightIndex(
                        (safeIndex - 1 + featuredCandidates.length) % featuredCandidates.length,
                      )
                    }
                    aria-label="上一部焦点番剧"
                    className="btn-ghost-dark flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="no-scrollbar flex items-center gap-2 overflow-x-auto py-0.5">
                    {featuredCandidates.map((cand, idx) => {
                      const active = idx === safeIndex;
                      return (
                        <button
                          key={cand.id}
                          type="button"
                          onClick={() => setSpotlightIndex(idx)}
                          title={cand.title}
                          aria-label={`切换焦点番剧 ${cand.title}`}
                          className={`group relative h-12 w-9 shrink-0 overflow-hidden rounded-lg border transition-all duration-200 ${
                            active
                              ? 'scale-105 border-[#FF7A2F] ring-2 ring-[#FF7A2F]/40'
                              : 'border-white/[0.14] opacity-60 hover:opacity-95'
                          }`}
                        >
                          <PosterImage
                            url={cand.coverUrl}
                            title={cand.title}
                            compactFallback
                            className="h-full w-full"
                          />
                          {active && (
                            <span
                              key={`prog-${cand.id}-${safeIndex}`}
                              style={{ animationPlayState: heroHovered ? 'paused' : 'running' }}
                              className="animate-hero-progress absolute right-0 bottom-0 left-0 h-[2.5px] bg-[#FF9E4F]"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setSpotlightIndex((safeIndex + 1) % featuredCandidates.length)
                    }
                    aria-label="下一部焦点番剧"
                    className="btn-ghost-dark flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Right Sharp Floating 3:4 Poster with Ambient Glow */}
            <div className="relative hidden shrink-0 sm:block">
              <div className="pointer-events-none absolute -inset-4 rounded-3xl bg-[#FF7A2F]/22 opacity-60 blur-2xl" />
              <button
                type="button"
                onClick={() => onOpenBangumi(activeHero)}
                className="group relative overflow-hidden rounded-2xl border border-white/[0.2] shadow-[0_24px_54px_rgba(0,0,0,0.9)] transition duration-300 hover:scale-[1.03] hover:border-[#FF7A2F]/65"
              >
                <PosterImage
                  key={activeHero.id}
                  url={activeHero.coverUrl}
                  title={activeHero.title}
                  className="h-[240px] w-[178px]"
                  imgClassName="transition duration-500 group-hover:scale-105"
                />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Weekday Segmented Filter Dock */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="segmented-dock no-scrollbar max-w-full overflow-x-auto">
          <button
            type="button"
            onClick={() => setSelectedDay('all')}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] ${
              selectedDay === 'all' ? 'segmented-tab-active' : 'segmented-tab font-medium'
            }`}
          >
            <span>全部新番</span>
            <span className="tabular-nums text-[11px] opacity-75">{allItems.length}</span>
          </button>

          {DAY_ORDER.map((day) => {
            const count = groupMap.get(day)?.length || 0;
            if (count === 0 && (day === 7 || day === 8)) return null;
            const isSelected = selectedDay === day;
            const isToday = day === todayDow;
            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDay(day)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] ${
                  isSelected ? 'segmented-tab-active' : 'segmented-tab font-medium'
                }`}
              >
                {isToday && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isSelected ? 'bg-current' : 'bg-[#FF7A2F]'
                    }`}
                  />
                )}
                <span>{MIKAN_DAY_LABELS[day]}</span>
                <span className="tabular-nums text-[11px] opacity-75">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-[12px] text-slate-400">
          <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#12151C] px-2.5 py-1.5">
            <Calendar className="h-3.5 w-3.5 text-[#FF7A2F]" />
            <select
              aria-label="选择年份"
              value={selectedSeason?.year ?? schedule?.year ?? 2026}
              onChange={(e) => {
                const yr = Number(e.target.value);
                const sn = selectedSeason?.season ?? schedule?.season ?? '秋';
                onSelectSeason(yr, sn);
              }}
              className="bg-transparent text-[12px] font-medium text-slate-200 focus:outline-none"
            >
              {YEARS.map((y) => (
                <option key={y} value={y} className="bg-[#12151C] text-slate-100">
                  {y} 年
                </option>
              ))}
            </select>
            <select
              aria-label="选择季度"
              value={selectedSeason?.season ?? schedule?.season ?? '秋'}
              onChange={(e) => {
                const yr = selectedSeason?.year ?? schedule?.year ?? 2026;
                onSelectSeason(yr, e.target.value as MikanSeasonName);
              }}
              className="bg-transparent text-[12px] font-medium text-slate-200 focus:outline-none"
            >
              {SEASON_NAMES.map((sn) => (
                <option key={sn} value={sn} className="bg-[#12151C] text-slate-100">
                  {sn}季
                </option>
              ))}
            </select>
            {selectedSeason && (
              <button
                type="button"
                onClick={() => onSelectSeason(undefined, undefined)}
                className="ml-1 rounded-md bg-[#FF7A2F]/18 px-1.5 py-0.5 text-[11px] font-medium text-[#FF9E4F] hover:bg-[#FF7A2F]/30"
              >
                回本季
              </button>
            )}
          </div>
          <span className="tabular-nums text-slate-500">
            共 <span className="font-semibold text-slate-300">{visibleItems.length}</span> 部番剧
          </span>
        </div>
      </section>

      {/* Gallery Unobstructed Seasonal Poster Wall */}
      {visibleItems.length === 0 ? (
        <div className="card-elevated flex flex-col items-center justify-center rounded-2xl py-16 text-center">
          <Calendar className="h-8 w-8 text-slate-600" />
          <p className="mt-3 text-[14px] font-medium text-slate-300">该分类暂无放送番剧</p>
          <p className="mt-1 text-[12px] text-slate-500">切换其他星期或查看全部新番</p>
        </div>
      ) : (
        <section className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenBangumi(item)}
              className="poster-tile group flex flex-col text-left focus:outline-none"
            >
              {/* Pure Unobstructed Artwork Frame */}
              <div className="poster-frame aspect-[3/4] w-full">
                <PosterImage
                  url={item.coverUrl}
                  title={item.title}
                  className="h-full w-full"
                  imgClassName="poster-img"
                />

                {/* Top Corner Minimal Glass Badges */}
                <div className="pointer-events-none absolute top-2.5 right-2.5 left-2.5 flex items-center justify-between gap-2">
                  <span className="poster-glass-badge rounded-full px-2 py-0.5 text-[10px] font-medium">
                    {MIKAN_DAY_LABELS[item.updateDay] || '新番'}
                  </span>
                  {item.hasUpdate && (
                    <span className="inline-flex items-center rounded-full bg-[#FF7A2F] px-2 py-0.5 text-[10px] font-bold text-[#0B0D11] shadow-[0_2px_10px_rgba(255,122,47,0.65)]">
                      NEW
                    </span>
                  )}
                </div>

                {/* Hover Bottom Frosted Quick-Inspect Pill */}
                <div className="pointer-events-none absolute inset-x-3 bottom-3 flex translate-y-1.5 justify-center opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
                  <span className="poster-hover-pill inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold">
                    查看资源
                    <ArrowRight className="h-3 w-3 text-[#FF7A2F]" />
                  </span>
                </div>
              </div>

              {/* Clean Below-Poster Editorial Caption */}
              <div className="w-full px-0.5 pt-2.5">
                <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-100 transition-colors group-hover:text-[#FF9E4F]">
                  {item.title}
                </h3>
                {item.updateDate && (
                  <p className="mt-1 truncate text-[11px] text-slate-500">{item.updateDate}</p>
                )}
              </div>
            </button>
          ))}
        </section>
      )}
    </div>
  );
};

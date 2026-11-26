import React from 'react';
import { Download, ExternalLink, Clock, HardDrive, Check, Film, Layers } from 'lucide-react';
import type { MikanRelease } from '@shared/types';
import {
  classifySubtitleLanguage,
  getSubtitleLanguageLabel,
} from '@shared/subtitleLanguage';
import {
  extractReleaseTags,
  formatEpisodeLabel,
  formatRelativeDate,
  parseEpisodeNumberFromTitle,
} from '@/lib/format';
import { TagBadge } from './TagBadge';
import { api } from '@/lib/api';

interface ReleaseRowProps {
  release: MikanRelease;
  showSubgroup?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (release: MikanRelease, shiftKey: boolean) => void;
  onDownload: (release: MikanRelease) => void;
  onOpenBangumi?: (bangumiId: string) => void;
}

const REDUNDANT_LANG_TAG_REGEX =
  /^(简繁|简日|繁日|简中|繁中|CHS|CHT|简体|繁体|简|繁)$/i;

export const ReleaseRow: React.FC<ReleaseRowProps> = React.memo(({
  release,
  showSubgroup = true,
  selectable = false,
  selected = false,
  onToggleSelect,
  onDownload,
  onOpenBangumi,
}) => {
  const normalizedSubgroup = (release.subgroup || '').trim().toLowerCase();
  const epNum = parseEpisodeNumberFromTitle(release.title);
  const isBatchCollection =
    epNum === undefined &&
    /(合集|全集|complete|batch|\b0?1[-~～_]\d{2,3}\b)/i.test(release.title);
  const langCategory = classifySubtitleLanguage(release.title);
  const langLabel =
    langCategory !== 'unknown' ? getSubtitleLanguageLabel(langCategory) : null;

  const tags = extractReleaseTags(release.title, release.tags).filter((tag) => {
    const clean = tag.trim();
    if (!clean) return false;
    if (normalizedSubgroup && clean.toLowerCase() === normalizedSubgroup) return false;
    if (langLabel && REDUNDANT_LANG_TAG_REGEX.test(clean)) return false;
    return true;
  });

  return (
    <div
      className={`release-row-item group flex flex-col gap-3 rounded-xl border px-4 py-3 transition-all duration-150 sm:flex-row sm:items-center sm:justify-between ${
        selected
          ? 'border-[#FF7A2F]/50 bg-[#FF7A2F]/[0.075] shadow-[inset_0_1px_0_rgba(255,122,47,0.16)]'
          : 'border-white/[0.07] bg-[#12151C]/92 hover:border-white/[0.14] hover:bg-[#171B24]'
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {selectable && onToggleSelect && (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={`选择 ${release.title}`}
            onClick={(e) => onToggleSelect(release, e.shiftKey)}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
              selected
                ? 'border-[#FF7A2F] bg-[#FF7A2F] text-[#0B0D11] shadow-[0_0_12px_rgba(255,122,47,0.45)]'
                : 'border-white/[0.18] bg-[#0B0D11]/70 text-transparent hover:border-[#FF7A2F]/60 hover:bg-white/[0.06]'
            }`}
          >
            <Check className="h-3.5 w-3.5 stroke-[2.8]" />
          </button>
        )}

        {/* Instant-scan Episode Capsule */}
        <div
          onClick={
            selectable && onToggleSelect ? (e) => onToggleSelect(release, e.shiftKey) : undefined
          }
          className={`flex h-10 w-[56px] shrink-0 items-center justify-center rounded-xl border text-center transition ${
            selectable && onToggleSelect ? 'cursor-pointer select-none' : ''
          } ${
            selected
              ? 'border-[#FF7A2F]/45 bg-[#FF7A2F]/18 text-[#FF9E4F]'
              : epNum !== undefined
                ? 'border-[#FF7A2F]/25 bg-[#FF7A2F]/[0.09] text-[#FF9E4F]'
                : isBatchCollection
                  ? 'border-sky-400/28 bg-sky-500/12 text-sky-300'
                  : 'border-white/[0.08] bg-white/[0.04] text-slate-400'
          }`}
        >
          {epNum !== undefined ? (
            <span className="font-mono text-[11.5px] font-bold tracking-tight tabular-nums">
              {formatEpisodeLabel(epNum)}
            </span>
          ) : isBatchCollection ? (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold">
              <Layers className="h-3 w-3" />
              合集
            </span>
          ) : (
            <Film className="h-4 w-4 opacity-75" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Metadata & Badges Primary Row */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            {showSubgroup && release.subgroup && (
              <span className="rounded-md border border-white/[0.09] bg-white/[0.05] px-2 py-0.5 text-[11px] font-semibold text-slate-200">
                {release.subgroup}
              </span>
            )}

            {langLabel && <TagBadge label={langLabel} variant="language" />}

            {tags.map((tag) => (
              <TagBadge key={tag} label={tag} />
            ))}

            {onOpenBangumi && release.bangumiId && release.bangumiTitle && (
              <button
                type="button"
                onClick={() => onOpenBangumi(release.bangumiId!)}
                className="max-w-[210px] truncate text-[11.5px] font-semibold text-[#FF9E4F] hover:underline"
              >
                {release.bangumiTitle}
              </button>
            )}

            <span className="ml-auto hidden items-center gap-3 text-[11px] text-slate-400 tabular-nums sm:inline-flex">
              <span className="inline-flex items-center gap-1">
                <HardDrive className="h-3 w-3 text-slate-500" />
                {release.size || '—'}
              </span>
              {release.pubDate && (
                <span className="inline-flex items-center gap-1 text-slate-500">
                  <Clock className="h-3 w-3" />
                  {formatRelativeDate(release.pubDate)}
                </span>
              )}
            </span>
          </div>

          {/* Title line (clean secondary detail on desktop, clear on mobile) */}
          <p
            onClick={
              selectable && onToggleSelect
                ? (e) => onToggleSelect(release, e.shiftKey)
                : undefined
            }
            title={release.title}
            className={`line-clamp-1 text-[13px] font-medium leading-snug ${
              selectable && onToggleSelect ? 'cursor-pointer select-none' : ''
            } ${selected ? 'text-white' : 'text-slate-100 group-hover:text-white'}`}
          >
            {release.title}
          </p>

          {/* Mobile size/date fallback */}
          <div className="flex items-center gap-3 text-[11px] text-slate-400 tabular-nums sm:hidden">
            <span className="inline-flex items-center gap-1">
              <HardDrive className="h-3 w-3 text-slate-500" />
              {release.size || '—'}
            </span>
            {release.pubDate && (
              <span className="inline-flex items-center gap-1 text-slate-500">
                <Clock className="h-3 w-3" />
                {formatRelativeDate(release.pubDate)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right actions */}
      <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
        {release.episodeUrl && (
          <button
            type="button"
            onClick={() => void api.openExternal(release.episodeUrl)}
            className="btn-ghost-dark flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-white"
            title="在蜜柑计划查看详情"
            aria-label="在蜜柑计划查看详情"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDownload(release)}
          className="btn-mikan flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[12.5px]"
        >
          <Download className="h-3.5 w-3.5" />
          下载
        </button>
      </div>
    </div>
  );
});

ReleaseRow.displayName = 'ReleaseRow';

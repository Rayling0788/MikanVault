import React from 'react';
import { Download, ExternalLink, Clock, HardDrive, Check } from 'lucide-react';
import type { MikanRelease } from '@shared/types';
import { extractReleaseTags, formatRelativeDate } from '@/lib/format';
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

export const ReleaseRow: React.FC<ReleaseRowProps> = ({
  release,
  showSubgroup = true,
  selectable = false,
  selected = false,
  onToggleSelect,
  onDownload,
  onOpenBangumi,
}) => {
  const normalizedSubgroup = (release.subgroup || '').trim().toLowerCase();
  const tags = extractReleaseTags(release.title, release.tags).filter(
    (tag) => !normalizedSubgroup || tag.trim().toLowerCase() !== normalizedSubgroup
  );

  return (
    <div
      className={`group flex flex-col gap-3 rounded-xl border px-4 py-3.5 transition-all duration-150 sm:flex-row sm:items-center sm:justify-between ${
        selected
          ? 'border-[#FF7A2F]/45 bg-[#FF7A2F]/[0.065] shadow-[inset_0_1px_0_rgba(255,122,47,0.14)]'
          : 'border-white/[0.065] bg-[#12151C]/90 hover:border-white/[0.13] hover:bg-[#171B24]'
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {selectable && onToggleSelect && (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={`选择 ${release.title}`}
            onClick={(e) => onToggleSelect(release, e.shiftKey)}
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
              selected
                ? 'border-[#FF7A2F] bg-[#FF7A2F] text-[#0B0D11] shadow-[0_0_12px_rgba(255,122,47,0.45)]'
                : 'border-white/[0.18] bg-[#0B0D11]/70 text-transparent hover:border-[#FF7A2F]/60 hover:bg-white/[0.06]'
            }`}
          >
            <Check className="h-3.5 w-3.5 stroke-[2.8]" />
          </button>
        )}

        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Title line */}
          <div className="flex items-start gap-2">
            <p
              onClick={selectable && onToggleSelect ? (e) => onToggleSelect(release, e.shiftKey) : undefined}
              className={`line-clamp-2 text-[13.5px] font-medium leading-snug ${
                selectable && onToggleSelect ? 'cursor-pointer select-none' : ''
              } ${selected ? 'text-white' : 'text-slate-100 group-hover:text-white'}`}
            >
              {release.title}
            </p>
          </div>

          {/* Metadata & Tags line */}
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-slate-400">
            {showSubgroup && release.subgroup && (
              <span className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-0.5 text-[11px] font-medium text-slate-200">
                {release.subgroup}
              </span>
            )}

            {onOpenBangumi && release.bangumiId && release.bangumiTitle && (
              <button
                type="button"
                onClick={() => onOpenBangumi(release.bangumiId!)}
                className="max-w-[200px] truncate text-[11.5px] font-medium text-[#FF9E4F] hover:underline"
              >
                {release.bangumiTitle}
              </button>
            )}

            {tags.map((tag) => (
              <TagBadge key={tag} label={tag} />
            ))}

            <span className="inline-flex items-center gap-1 text-slate-400 tabular-nums">
              <HardDrive className="h-3 w-3 text-slate-500" />
              {release.size || '—'}
            </span>

            {release.pubDate && (
              <span className="inline-flex items-center gap-1 text-slate-500 tabular-nums">
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
};

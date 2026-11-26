import React from 'react';
import { CheckSquare, Download, RefreshCw, X } from 'lucide-react';
import { formatBytes } from '@/lib/format';

interface BatchActionBarProps {
  selectedCount: number;
  totalSizeBytes: number;
  allVisibleSelected: boolean;
  onSelectAll: () => void;
  onInvertSelection: () => void;
  onClear: () => void;
  onBatchDownload: () => void;
}

export const BatchActionBar: React.FC<BatchActionBarProps> = ({
  selectedCount,
  totalSizeBytes,
  allVisibleSelected,
  onSelectAll,
  onInvertSelection,
  onClear,
  onBatchDownload,
}) => {
  if (selectedCount <= 0) return null;

  return (
    <div className="pointer-events-none sticky bottom-4 z-30 flex justify-center px-4 pt-2">
      <div className="pointer-events-auto animate-modal-enter glass-panel flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.13] px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.88)]">
        <div className="flex items-center gap-2.5 pr-1">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#FF7A2F]/35 bg-[#FF7A2F]/18 px-2.5 text-[12.5px] font-semibold text-[#FF9E4F] tabular-nums">
            <CheckSquare className="h-3.5 w-3.5" />
            已选 {selectedCount} 项
          </span>
          {totalSizeBytes > 0 && (
            <span className="text-[12px] text-slate-300 tabular-nums">
              共 <span className="font-semibold text-white">{formatBytes(totalSizeBytes)}</span>
            </span>
          )}
          <span className="hidden text-[11px] text-slate-500 md:inline">
            支持 Shift 连选
          </span>
        </div>

        <div className="h-5 w-px bg-white/[0.08]" />

        <div className="flex items-center gap-1.5">
          {!allVisibleSelected && (
            <button
              type="button"
              onClick={onSelectAll}
              className="btn-ghost-dark h-8 rounded-lg px-2.5 text-[12px] font-medium"
            >
              全选
            </button>
          )}
          <button
            type="button"
            onClick={onInvertSelection}
            className="btn-ghost-dark inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium"
          >
            <RefreshCw className="h-3 w-3 text-slate-400" />
            反选
          </button>
          <button
            type="button"
            onClick={onClear}
            className="btn-ghost-dark inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-slate-400 hover:text-white"
          >
            <X className="h-3 w-3" />
            清空
          </button>
        </div>

        <button
          type="button"
          onClick={onBatchDownload}
          className="btn-mikan inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[13px]"
        >
          <Download className="h-4 w-4" />
          批量下载 ({selectedCount})
        </button>
      </div>
    </div>
  );
};

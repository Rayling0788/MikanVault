import React, { useEffect, useState } from 'react';
import { Trash2, X, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import type { LibraryEpisode, LibrarySeries } from '@shared/types';
import { api } from '@/lib/api';

export type RemoveTarget =
  | { kind: 'series'; series: LibrarySeries }
  | { kind: 'episode'; episode: LibraryEpisode; seriesTitle: string };

interface RemoveConfirmModalProps {
  target: RemoveTarget | null;
  onClose: () => void;
  onRemoved: (info: { deletedFiles: boolean; title: string }) => void;
}

export const RemoveConfirmModal: React.FC<RemoveConfirmModalProps> = ({
  target,
  onClose,
  onRemoved,
}) => {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setDeleteFiles(false);
    setSubmitting(false);
    setError(null);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [target, submitting, onClose]);

  if (!target) return null;

  const isSeries = target.kind === 'series';
  const displayTitle = isSeries
    ? target.series.title
    : `${target.seriesTitle} · ${target.episode.title || target.episode.fileName}`;
  const pathPreview = isSeries ? target.series.folderPath : target.episode.filePath;

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = isSeries
        ? await api.libraryRemoveSeries({
            seriesId: target.series.seriesId,
            folderPath: target.series.folderPath,
            filePaths: target.series.episodes.map((e) => e.filePath),
            deleteFiles,
          })
        : await api.libraryRemoveEpisode({
            filePath: target.episode.filePath,
            deleteFile: deleteFiles,
          });

      if (res.ok) {
        onRemoved({ deletedFiles: deleteFiles, title: displayTitle });
        onClose();
      } else {
        setError(res.error || '移除失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '移除操作异常');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-modal-title"
    >
      <div className="animate-modal-enter glass-panel w-full max-w-[480px] overflow-hidden rounded-2xl border border-white/[0.1] shadow-[0_24px_80px_rgba(0,0,0,0.88)]">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/25">
              <Trash2 className="h-4 w-4" />
            </div>
            <div>
              <h2 id="remove-modal-title" className="text-[15px] font-semibold text-white">
                {isSeries ? '从媒体库移除番剧' : '从媒体库移除单集'}
              </h2>
              <p className="text-[11.5px] text-slate-400">
                可安全隐藏记录或同时移入系统回收站
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
            aria-label="关闭窗口"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-white/[0.07] bg-[#0B0D11]/65 p-3.5 space-y-1.5">
            <div className="text-[13.5px] font-semibold text-white">{displayTitle}</div>
            {isSeries && (
              <div className="text-[12px] text-slate-400 tabular-nums">
                包含 {target.series.totalEpisodes} 集本地视频
              </div>
            )}
            <div
              className="truncate font-mono text-[11px] text-slate-500"
              title={pathPreview}
            >
              {pathPreview}
            </div>
          </div>

          {!deleteFiles && (
            <div className="flex items-start gap-2.5 rounded-xl border border-[#22C55E]/25 bg-[#22C55E]/10 px-3.5 py-2.5 text-[12px] text-emerald-200">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#22C55E]" />
              <span>
                默认仅从 MikanVault 媒体库移除，<strong>不会删除硬盘上的视频文件</strong>，之后也可点击「恢复已移除」找回。
              </span>
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/[0.08] bg-[#12151C]/80 p-3 transition hover:border-rose-500/35">
            <input
              type="checkbox"
              checked={deleteFiles}
              onChange={(e) => setDeleteFiles(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-white/20 accent-rose-500"
            />
            <div className="text-[12.5px]">
              <div className="font-medium text-slate-200">同时将本地文件移入系统回收站</div>
              <div className="mt-0.5 text-[11.5px] text-slate-500">
                勾选后会把对应视频文件/番剧目录移至 Windows 回收站以释放磁盘空间
              </div>
            </div>
          </label>

          {deleteFiles && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/12 px-3.5 py-2.5 text-[12px] text-rose-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>已勾选删除本地文件：文件将被移入系统回收站。</span>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-white/[0.07] bg-[#0B0D11]/45 px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn-ghost-dark h-9 rounded-xl px-4 text-[13px] font-medium"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-rose-600 px-4 text-[13px] font-semibold text-white shadow-[0_6px_18px_rgba(225,29,72,0.35)] transition hover:bg-rose-500 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                处理中...
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                {deleteFiles ? '移除并移入回收站' : '确认从媒体库移除'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

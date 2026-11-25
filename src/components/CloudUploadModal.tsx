import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudUpload,
  HardDrive,
  Loader2,
  X,
} from 'lucide-react';
import type {
  CloudDriveStatus,
  CloudUploadLibraryResult,
  LibraryEpisode,
  LibrarySeries,
} from '@shared/types';
import { api } from '@/lib/api';
import { formatBytes, joinSavePath } from '@/lib/format';

export type CloudUploadTarget =
  | { kind: 'series'; series: LibrarySeries; defaultDeleteLocal: boolean }
  | {
      kind: 'episode';
      episode: LibraryEpisode;
      series: LibrarySeries;
      defaultDeleteLocal: boolean;
    };

interface CloudUploadModalProps {
  target: CloudUploadTarget | null;
  onClose: () => void;
  onUploaded: (
    res: CloudUploadLibraryResult,
    info: { title: string; kind: 'series' | 'episode'; deleteLocal: boolean },
  ) => void;
}

export const CloudUploadModal: React.FC<CloudUploadModalProps> = ({
  target,
  onClose,
  onUploaded,
}) => {
  const [deleteLocal, setDeleteLocal] = useState(true);
  const [cloudStatus, setCloudStatus] = useState<CloudDriveStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setDeleteLocal(target.defaultDeleteLocal);
    setSubmitting(false);
    setError(null);
    setLoadingStatus(true);
    let cancelled = false;
    void api
      .cloudGetStatus()
      .then((res) => {
        if (!cancelled) setCloudStatus(res);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingStatus(false);
      });
    return () => {
      cancelled = true;
    };
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

  const summary = useMemo(() => {
    if (!target) {
      return {
        isSeries: true,
        displayTitle: '',
        fileCount: 0,
        totalBytes: 0,
        sourcePath: '',
        filePaths: [] as string[],
      };
    }
    const isSeries = target.kind === 'series';
    const filePaths = isSeries
      ? target.series.episodes.map((ep) => ep.filePath)
      : [target.episode.filePath];
    const totalBytes = isSeries
      ? target.series.episodes.reduce((acc, ep) => acc + (ep.sizeBytes || 0), 0)
      : target.episode.sizeBytes || 0;
    const displayTitle = isSeries
      ? target.series.title
      : `${target.series.title} · ${target.episode.title || target.episode.fileName}`;

    return {
      isSeries,
      displayTitle,
      fileCount: filePaths.length,
      totalBytes,
      sourcePath: isSeries ? target.series.folderPath : target.episode.filePath,
      filePaths,
    };
  }, [target]);

  if (!target) return null;

  const cloudRoot = (cloudStatus?.configuredDir || cloudStatus?.defaultTargetDir || '').trim();
  const destPreview = cloudRoot
    ? joinSavePath(cloudRoot, target.series.title)
    : '未配置谷歌云盘目录';
  const driveUnavailable = !loadingStatus && cloudStatus !== null && !cloudStatus.configuredAccessible;

  const handleConfirm = async () => {
    if (submitting || summary.filePaths.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.cloudUploadLibrary({
        kind: target.kind,
        seriesId: target.series.seriesId,
        seriesTitle: target.series.title,
        folderPath: target.series.folderPath,
        filePaths: summary.filePaths,
        bangumiId: target.series.bangumiId,
        coverUrl: target.series.coverUrl,
        deleteLocal,
        background: true,
      });

      if (res.ok) {
        onUploaded(res, {
          title: summary.displayTitle,
          kind: target.kind,
          deleteLocal,
        });
        onClose();
      } else {
        setError(res.error || '上传到谷歌云盘失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传到谷歌云盘异常');
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
      aria-labelledby="cloud-upload-modal-title"
    >
      <div className="animate-modal-enter glass-panel w-full max-w-[520px] overflow-hidden rounded-2xl border border-white/[0.1] shadow-[0_24px_80px_rgba(0,0,0,0.88)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/15 text-sky-400 ring-1 ring-sky-400/30">
              <CloudUpload className="h-4 w-4" />
            </div>
            <div>
              <h2 id="cloud-upload-modal-title" className="text-[15px] font-semibold text-white">
                {summary.isSeries ? '上传番剧到谷歌云盘' : '上传单集到谷歌云盘'}
              </h2>
              <p className="text-[11.5px] text-slate-400">
                复制到 Google Drive 挂载目录并校验文件完整，保留封面与观看进度
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

        {/* Body */}
        <div className="space-y-4 p-5">
          {/* Source & Destination Info */}
          <div className="rounded-xl border border-white/[0.07] bg-[#0B0D11]/65 p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate text-[13.5px] font-semibold text-white">
                {summary.displayTitle}
              </div>
              <span className="shrink-0 rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-slate-300 tabular-nums">
                {summary.fileCount} 个文件 · {formatBytes(summary.totalBytes)}
              </span>
            </div>
            <div className="space-y-1 text-[11px]">
              <div className="truncate font-mono text-slate-500" title={summary.sourcePath}>
                本地：{summary.sourcePath}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-sky-300/90" title={destPreview}>
                  云盘：{destPreview}
                </span>
                {cloudStatus?.freeBytes !== undefined && (
                  <span className="shrink-0 text-sky-400/90 tabular-nums">
                    缓冲可用 {formatBytes(cloudStatus.freeBytes)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Mode Selector */}
          <div className="space-y-2">
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                deleteLocal
                  ? 'border-sky-400/60 bg-sky-500/12 shadow-[inset_0_1px_0_rgba(56,189,248,0.16)]'
                  : 'border-white/[0.08] bg-[#12151C]/75 hover:border-white/[0.18]'
              }`}
            >
              <input
                type="radio"
                name="cloud-upload-mode"
                checked={deleteLocal}
                disabled={submitting}
                onChange={() => setDeleteLocal(true)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-sky-400"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
                  <CloudUpload className="h-3.5 w-3.5 text-sky-400" />
                  <span>上传到谷歌云并删除本地（释放本地空间）</span>
                </div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-400">
                  先复制并逐文件校验字节大小一致，确认无误并同步番剧元数据后，再自动删除本地原文件。
                </p>
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                !deleteLocal
                  ? 'border-emerald-400/60 bg-emerald-500/10 shadow-[inset_0_1px_0_rgba(34,197,94,0.16)]'
                  : 'border-white/[0.08] bg-[#12151C]/75 hover:border-white/[0.18]'
              }`}
            >
              <input
                type="radio"
                name="cloud-upload-mode"
                checked={!deleteLocal}
                disabled={submitting}
                onChange={() => setDeleteLocal(false)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-400"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
                  <HardDrive className="h-3.5 w-3.5 text-emerald-400" />
                  <span>上传到谷歌云并保留本地（本地 + 云端双份）</span>
                </div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-400">
                  仅复制一份到谷歌云盘目录，本地原视频和文件夹原封不动保留。
                </p>
              </div>
            </label>
          </div>

          {driveUnavailable ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3.5 py-2.5 text-[12px] text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                未检测到可用的 Google Drive 目录，请确认 Google Drive Desktop 正在运行或前往设置页面配置目录。
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-[11.5px] text-slate-400">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
              <span>
                复制到虚拟云盘后，Google Drive 客户端会在后台完成云端上传，随后在「流式传输」模式下自动释放本地缓存。
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/12 px-3.5 py-2.5 text-[12px] text-rose-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
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
            disabled={submitting || driveUnavailable || summary.filePaths.length === 0}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-sky-500 px-4 text-[13px] font-semibold text-[#0B0D11] transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加入上传队列...
              </>
            ) : (
              <>
                <Cloud className="h-4 w-4" />
                {deleteLocal ? '确认上传并删除本地' : '确认上传并保留本地'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  FolderOpen,
  Download,
  AlertTriangle,
  CheckCircle2,
  Power,
  Loader2,
  RotateCcw,
  Tag,
  Layers,
  BellRing,
  Cloud,
  HardDrive,
  Languages,
} from 'lucide-react';
import type {
  AppSettings,
  CloudDriveStatus,
  MikanRelease,
  QbConnectionStatus,
  SubtitleLanguageFilter,
} from '@shared/types';
import {
  getSubtitleLanguageLabel,
  inferCommonSubtitleLanguage,
  SUBTITLE_LANGUAGE_OPTIONS,
} from '@shared/subtitleLanguage';
import { api } from '@/lib/api';
import {
  deriveSeriesFolderNameFromTitle,
  extractReleaseTags,
  formatBytes,
  joinSavePath,
  parseEpisodeNumberFromTitle,
  parseSizeTextToBytes,
} from '@/lib/format';
import { PosterImage } from './PosterImage';
import { TagBadge } from './TagBadge';

export interface DownloadModalTarget {
  release: MikanRelease;
  bangumiTitle?: string;
  bangumiId?: string;
  coverUrl?: string;
  subgroupId?: string;
  subgroupName?: string;
  rssUrl?: string;
  preferredLanguageFilter?: SubtitleLanguageFilter;
}

export interface DownloadModalSubmitSummary {
  ok: boolean;
  total: number;
  succeeded: number;
  failed: number;
  savePath?: string;
  error?: string;
  autoSubscribed?: boolean;
  startAfterEpisode?: number;
}

interface DownloadConfirmModalProps {
  targets: DownloadModalTarget[];
  settings: AppSettings | null;
  qbStatus: QbConnectionStatus | null;
  launchingQb: boolean;
  onLaunchQb: () => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  onSubmitted: (summary: DownloadModalSubmitSummary) => void;
}

export const DownloadConfirmModal: React.FC<DownloadConfirmModalProps> = ({
  targets,
  settings,
  qbStatus,
  launchingQb,
  onLaunchQb,
  onClose,
  onSubmitted,
}) => {
  const [items, setItems] = useState<DownloadModalTarget[]>([]);
  const [savePath, setSavePath] = useState('');
  const [category, setCategory] = useState('mikan');
  const [enableAutoSub, setEnableAutoSub] = useState(false);
  const [autoSubLanguage, setAutoSubLanguage] = useState<SubtitleLanguageFilter>('all');
  const [storageMode, setStorageMode] = useState<'local' | 'cloud_offload' | 'cloud_direct'>(
    'local',
  );
  const [cloudStatus, setCloudStatus] = useState<CloudDriveStatus | null>(null);
  const [cloudRootDir, setCloudRootDir] = useState('');
  const [deleteLocalAfterMove, setDeleteLocalAfterMove] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!targets || targets.length === 0) {
      setItems([]);
      return;
    }
    setItems(targets);
    setSubmitting(false);
    setEnableAutoSub(false);
    const explicitLang = targets.find((t) => t.preferredLanguageFilter)?.preferredLanguageFilter;
    setAutoSubLanguage(
      explicitLang && explicitLang !== 'all'
        ? explicitLang
        : inferCommonSubtitleLanguage(targets.map((t) => t.release.title)),
    );
    setStorageMode('local');
    setCategory(settings?.qbCategory || 'mikan');
    setDeleteLocalAfterMove(settings?.googleDriveAutoDeleteLocal ?? true);
    setCloudRootDir(settings?.googleDriveDir || '');
    void api
      .cloudGetStatus()
      .then((res) => {
        setCloudStatus(res);
        setCloudRootDir((prev) => prev || res.configuredDir || res.defaultTargetDir || '');
      })
      .catch(() => {});
  }, [
    targets,
    settings?.qbCategory,
    settings?.googleDriveDir,
    settings?.googleDriveAutoDeleteLocal,
  ]);

  const commonBangumiTitle = useMemo(() => {
    if (items.length === 0) return undefined;
    const titles = new Set(
      items
        .map((t) =>
          (
            t.bangumiTitle ||
            t.release.bangumiTitle ||
            deriveSeriesFolderNameFromTitle(t.release.title)
          ).trim()
        )
        .filter(Boolean)
    );
    if (titles.size === 1) {
      return Array.from(titles)[0];
    }
    return undefined;
  }, [items]);

  const defaultPath = useMemo(() => {
    if (items.length === 0) return '';
    return joinSavePath(settings?.downloadRootDir || '', commonBangumiTitle);
  }, [items.length, settings?.downloadRootDir, commonBangumiTitle]);

  const resolvedCloudRoot = useMemo(
    () => (cloudRootDir || cloudStatus?.configuredDir || cloudStatus?.defaultTargetDir || '').trim(),
    [cloudRootDir, cloudStatus?.configuredDir, cloudStatus?.defaultTargetDir],
  );

  const cloudPreviewPath = useMemo(() => {
    if (!resolvedCloudRoot) return '';
    return joinSavePath(resolvedCloudRoot, commonBangumiTitle);
  }, [resolvedCloudRoot, commonBangumiTitle]);

  useEffect(() => {
    if (items.length === 0) return;
    if (storageMode === 'cloud_direct' && resolvedCloudRoot) {
      setSavePath(cloudPreviewPath || resolvedCloudRoot);
    } else {
      setSavePath(defaultPath);
    }
  }, [defaultPath, cloudPreviewPath, resolvedCloudRoot, storageMode, items.length]);

  useEffect(() => {
    if (items.length === 0) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items.length, submitting, onClose]);

  const totalBytes = useMemo(
    () =>
      items.reduce(
        (sum, item) =>
          sum +
          (item.release.sizeBytes && item.release.sizeBytes > 0
            ? item.release.sizeBytes
            : parseSizeTextToBytes(item.release.size)),
        0
      ),
    [items]
  );

  const subscribableInfo = useMemo(() => {
    if (items.length === 0) return null;
    const bangumiIds = new Set(
      items.map((i) => (i.bangumiId || i.release.bangumiId || '').trim()).filter(Boolean)
    );
    const subgroupIds = new Set(
      items.map((i) => (i.subgroupId || i.release.subgroupId || '').trim()).filter(Boolean)
    );
    if (bangumiIds.size !== 1 || subgroupIds.size !== 1) return null;

    const first = items[0];
    const bangumiId = Array.from(bangumiIds)[0];
    const subgroupId = Array.from(subgroupIds)[0];
    const bangumiTitle =
      first.bangumiTitle ||
      first.release.bangumiTitle ||
      deriveSeriesFolderNameFromTitle(first.release.title) ||
      `番剧 #${bangumiId}`;
    const subgroupName = first.subgroupName || first.release.subgroup || `字幕组 #${subgroupId}`;
    const base = (settings?.mikanBaseUrl || 'https://mikanani.kas.pub').replace(/\/+$/, '');
    const rssUrl =
      first.rssUrl ||
      `${base}/RSS/Bangumi?bangumiId=${encodeURIComponent(bangumiId)}&subgroupid=${encodeURIComponent(subgroupId)}`;

    let maxSelectedEpisode = 0;
    for (const item of items) {
      const ep = parseEpisodeNumberFromTitle(item.release.title);
      if (ep !== undefined && ep > maxSelectedEpisode) {
        maxSelectedEpisode = ep;
      }
    }

    return {
      bangumiId,
      bangumiTitle,
      coverUrl: first.coverUrl,
      subgroupId,
      subgroupName,
      rssUrl,
      maxSelectedEpisode,
    };
  }, [items, settings?.mikanBaseUrl]);

  if (items.length === 0) return null;

  const isBatch = items.length > 1;
  const single = items[0];
  const connected = Boolean(qbStatus?.connected);

  const singleNormalizedSubgroup = (single.release.subgroup || '').trim().toLowerCase();
  const singleTags = extractReleaseTags(single.release.title, single.release.tags).filter(
    (tag) =>
      !singleNormalizedSubgroup || tag.trim().toLowerCase() !== singleNormalizedSubgroup
  );

  const handleRemoveItem = (id: string) => {
    const next = items.filter((item) => item.release.id !== id);
    if (next.length === 0) {
      onClose();
    } else {
      setItems(next);
    }
  };

  const handlePickFolder = async () => {
    const picked = await api.dialogPickFolder();
    if (picked) {
      setSavePath(picked);
    }
  };

  const handleConfirm = async () => {
    if (items.length === 0) return;
    setSubmitting(true);
    try {
      let submitOk = false;
      let resolvedSavePath = savePath.trim() || defaultPath || undefined;
      let summaryPayload: DownloadModalSubmitSummary;

      if (items.length === 1) {
        const item = items[0];
        const resolvedBangumiTitle =
          item.bangumiTitle ||
          item.release.bangumiTitle ||
          deriveSeriesFolderNameFromTitle(item.release.title) ||
          undefined;
        const cloudTargetDir =
          storageMode === 'cloud_offload' && resolvedCloudRoot
            ? joinSavePath(resolvedCloudRoot, resolvedBangumiTitle)
            : undefined;
        const res = await api.qbAddDownload({
          torrentUrl: item.release.torrentUrl,
          magnetUrl: item.release.magnetUrl,
          title: item.release.title,
          bangumiId: item.bangumiId || item.release.bangumiId,
          bangumiTitle: resolvedBangumiTitle,
          coverUrl: item.coverUrl,
          subgroup: item.release.subgroup,
          savePath: savePath.trim() || undefined,
          category: category.trim() || undefined,
          cloudTargetDir,
          deleteLocalAfterCloudMove: deleteLocalAfterMove,
        });
        submitOk = res.ok;
        if (res.savePath) resolvedSavePath = res.savePath;
        summaryPayload = {
          ok: res.ok,
          total: 1,
          succeeded: res.ok ? 1 : 0,
          failed: res.ok ? 0 : 1,
          savePath: res.savePath,
          error: res.error,
        };
      } else {
        const useAutoPerAnimeSubfolder =
          !commonBangumiTitle &&
          (savePath.trim() === defaultPath.trim() ||
            (storageMode === 'cloud_direct' && savePath.trim() === resolvedCloudRoot));
        const requests = items.map((item) => {
          const resolvedBangumiTitle =
            item.bangumiTitle ||
            item.release.bangumiTitle ||
            deriveSeriesFolderNameFromTitle(item.release.title) ||
            undefined;
          const itemCloudDirectPath =
            storageMode === 'cloud_direct' && useAutoPerAnimeSubfolder && resolvedCloudRoot
              ? joinSavePath(resolvedCloudRoot, resolvedBangumiTitle)
              : undefined;
          return {
            torrentUrl: item.release.torrentUrl,
            magnetUrl: item.release.magnetUrl,
            title: item.release.title,
            bangumiId: item.bangumiId || item.release.bangumiId,
            bangumiTitle: resolvedBangumiTitle,
            coverUrl: item.coverUrl,
            subgroup: item.release.subgroup,
            savePath:
              itemCloudDirectPath ??
              (useAutoPerAnimeSubfolder ? undefined : savePath.trim() || undefined),
            category: category.trim() || undefined,
            cloudTargetDir:
              storageMode === 'cloud_offload' && resolvedCloudRoot
                ? joinSavePath(resolvedCloudRoot, resolvedBangumiTitle)
                : undefined,
            deleteLocalAfterCloudMove: deleteLocalAfterMove,
          };
        });
        const batchRes = await api.qbAddDownloadBatch(requests);
        const firstSuccess = batchRes.results.find((r) => r.ok);
        const firstError = batchRes.results.find((r) => !r.ok)?.error;
        submitOk = batchRes.succeeded > 0;
        if (firstSuccess?.savePath) resolvedSavePath = firstSuccess.savePath;
        summaryPayload = {
          ok: submitOk,
          total: batchRes.total,
          succeeded: batchRes.succeeded,
          failed: batchRes.failed,
          savePath: firstSuccess?.savePath || savePath.trim() || undefined,
          error: batchRes.failed > 0 ? firstError : undefined,
        };
      }

      if (submitOk && enableAutoSub && subscribableInfo && resolvedSavePath) {
        try {
          await api.subUpsert({
            bangumiId: subscribableInfo.bangumiId,
            bangumiTitle: subscribableInfo.bangumiTitle,
            coverUrl: subscribableInfo.coverUrl,
            subgroupId: subscribableInfo.subgroupId,
            subgroupName: subscribableInfo.subgroupName,
            rssUrl: subscribableInfo.rssUrl,
            savePath: resolvedSavePath,
            category: category.trim() || undefined,
            startAfterEpisode: subscribableInfo.maxSelectedEpisode,
            languageFilter: autoSubLanguage,
            cloudTargetDir:
              storageMode === 'cloud_offload' && resolvedCloudRoot
                ? joinSavePath(resolvedCloudRoot, subscribableInfo.bangumiTitle)
                : undefined,
            deleteLocalAfterCloudMove: deleteLocalAfterMove,
            enabled: true,
            initialSkipReleaseIds: items.map((i) => i.release.id),
          });
          summaryPayload.autoSubscribed = true;
          summaryPayload.startAfterEpisode = subscribableInfo.maxSelectedEpisode;
        } catch {
          // Download succeeded even if subscription save failed
        }
      }

      onSubmitted(summaryPayload);
      if (submitOk) {
        onClose();
      }
    } catch (err) {
      onSubmitted({
        ok: false,
        total: items.length,
        succeeded: 0,
        failed: items.length,
        error: err instanceof Error ? err.message : '提交下载失败',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-modal-title"
    >
      <div className="animate-modal-enter glass-panel w-full max-w-[600px] overflow-hidden rounded-2xl border border-white/[0.1] shadow-[0_24px_80px_rgba(0,0,0,0.85)]">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF7A2F]/15 text-[#FF7A2F] ring-1 ring-[#FF7A2F]/25">
              {isBatch ? <Layers className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            </div>
            <div>
              <h2 id="download-modal-title" className="text-[15px] font-semibold text-white">
                {isBatch
                  ? `批量添加到 qBittorrent 队列（${items.length} 个任务）`
                  : '添加到 qBittorrent 下载队列'}
              </h2>
              <p className="text-[11.5px] text-slate-400">
                {isBatch && totalBytes > 0
                  ? `预计总大小 ${formatBytes(totalBytes)} · 确认保存目录后将批量推送到本地客户端`
                  : '确认保存目录与任务参数后将立即推送到本地客户端'}
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
        <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
          {/* Single or Batch Release Preview */}
          {!isBatch ? (
            <div className="flex gap-3.5 rounded-xl border border-white/[0.07] bg-[#0B0D11]/65 p-3.5">
              <PosterImage
                url={single.coverUrl}
                title={single.bangumiTitle || single.release.title}
                compactFallback
                className="h-[88px] w-[66px] shrink-0 rounded-lg border border-white/[0.08]"
              />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[13.5px] font-medium leading-snug text-slate-100">
                  {single.release.title}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-slate-400">
                  {single.release.subgroup && (
                    <span className="rounded-md bg-white/[0.06] px-2 py-0.5 font-medium text-slate-200">
                      {single.release.subgroup}
                    </span>
                  )}
                  <span className="tabular-nums font-medium text-slate-300">
                    {single.release.size || '—'}
                  </span>
                  {singleTags.slice(0, 3).map((tag) => (
                    <TagBadge key={tag} label={tag} />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-white/[0.07] bg-[#0B0D11]/65 p-2.5">
              <div className="max-h-[210px] space-y-1.5 overflow-y-auto pr-1">
                {items.map((item, idx) => (
                  <div
                    key={item.release.id}
                    className="flex items-center justify-between gap-2.5 rounded-lg border border-white/[0.05] bg-[#12151C]/85 px-3 py-2"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <span className="w-5 shrink-0 text-[11px] font-mono text-slate-500 tabular-nums">
                        {String(idx + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium text-slate-100">
                          {item.release.title}
                        </p>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                          {item.release.subgroup && (
                            <span className="text-slate-300">{item.release.subgroup}</span>
                          )}
                          <span className="tabular-nums">{item.release.size || '—'}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleRemoveItem(item.release.id)}
                      className="rounded-md p-1 text-slate-500 transition hover:bg-white/[0.08] hover:text-white"
                      title="从批量队列移除"
                      aria-label={`移除 ${item.release.title}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Storage Destination Mode (Local vs Google Drive) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-medium text-slate-300">存储位置</span>
              {cloudStatus?.detected && cloudStatus.freeBytes !== undefined && (
                <span className="text-[11px] text-sky-300">
                  ☁️ 云盘可用 {formatBytes(cloudStatus.freeBytes)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setStorageMode('local')}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12px] transition ${
                  storageMode === 'local'
                    ? 'border-[#FF7A2F]/60 bg-[#FF7A2F]/12 text-white'
                    : 'border-white/[0.08] bg-[#12151C]/75 text-slate-300 hover:border-white/[0.18]'
                }`}
              >
                <HardDrive className="h-4 w-4 shrink-0 text-[#FF9E4F]" />
                <div className="min-w-0">
                  <div className="font-semibold">本地磁盘</div>
                  <div className="truncate text-[10.5px] text-slate-400">常规本地保存</div>
                </div>
              </button>

              <button
                type="button"
                disabled={!resolvedCloudRoot}
                onClick={() => setStorageMode('cloud_offload')}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12px] transition disabled:cursor-not-allowed disabled:opacity-45 ${
                  storageMode === 'cloud_offload'
                    ? 'border-sky-400/60 bg-sky-500/14 text-white'
                    : 'border-white/[0.08] bg-[#12151C]/75 text-slate-300 hover:border-white/[0.18]'
                }`}
              >
                <Cloud className="h-4 w-4 shrink-0 text-sky-400" />
                <div className="min-w-0">
                  <div className="font-semibold">谷歌云盘 (推荐)</div>
                  <div className="truncate text-[10.5px] text-slate-400">下完转存删本地</div>
                </div>
              </button>

              <button
                type="button"
                disabled={!resolvedCloudRoot}
                onClick={() => setStorageMode('cloud_direct')}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12px] transition disabled:cursor-not-allowed disabled:opacity-45 ${
                  storageMode === 'cloud_direct'
                    ? 'border-sky-400/60 bg-sky-500/14 text-white'
                    : 'border-white/[0.08] bg-[#12151C]/75 text-slate-300 hover:border-white/[0.18]'
                }`}
              >
                <Cloud className="h-4 w-4 shrink-0 text-emerald-400" />
                <div className="min-w-0">
                  <div className="font-semibold">直存云盘目录</div>
                  <div className="truncate text-[10.5px] text-slate-400">qB 直写入云盘</div>
                </div>
              </button>
            </div>

            {storageMode === 'cloud_offload' && resolvedCloudRoot && (
              <div className="rounded-xl border border-sky-400/25 bg-sky-500/[0.07] px-3.5 py-2.5 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-sky-200">
                  <span className="font-medium">
                    将先高速下载到本地临时目录，完成后自动转存至云盘：
                  </span>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-slate-200">
                    <input
                      type="checkbox"
                      checked={deleteLocalAfterMove}
                      onChange={(e) => setDeleteLocalAfterMove(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-sky-400"
                    />
                    <span>校验后删除本地文件（省空间）</span>
                  </label>
                </div>
                <div className="truncate font-mono text-[11px] text-sky-300/90">
                  {cloudPreviewPath || resolvedCloudRoot}
                </div>
              </div>
            )}
          </div>

          {/* Save Path Input */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="download-save-path"
                className="text-[12px] font-medium text-slate-300"
              >
                保存路径
                {isBatch
                  ? !commonBangumiTitle && savePath.trim() === defaultPath.trim()
                    ? '（将按各番剧自动新建独立子文件夹）'
                    : '（所有选中任务共用）'
                  : ''}
              </label>
              {defaultPath && savePath !== defaultPath && (
                <button
                  type="button"
                  onClick={() => setSavePath(defaultPath)}
                  className="flex items-center gap-1 text-[11px] text-[#FF9E4F] hover:underline"
                >
                  <RotateCcw className="h-3 w-3" />
                  恢复默认路径
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                id="download-save-path"
                type="text"
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
                placeholder="例如 D:\Anime\番剧名"
                className="input-cinema h-10 flex-1 rounded-xl px-3.5 font-mono text-[12.5px]"
              />
              <button
                type="button"
                onClick={handlePickFolder}
                className="btn-ghost-dark flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium"
              >
                <FolderOpen className="h-4 w-4 text-slate-400" />
                浏览
              </button>
            </div>
          </div>

          {/* Category Input */}
          <div className="flex items-center gap-3">
            <label
              htmlFor="download-category"
              className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-slate-400"
            >
              <Tag className="h-3.5 w-3.5" />
              qB 分类
            </label>
            <input
              id="download-category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="mikan"
              className="input-cinema h-8 w-44 rounded-lg px-2.5 text-[12px]"
            />
            <span className="text-[11px] text-slate-500">用于队列归类与自动追踪封面</span>
          </div>

          {/* Auto-Subscription Toggle */}
          {subscribableInfo && (
            <div
              className={`rounded-xl border p-3.5 transition ${
                enableAutoSub
                  ? 'border-[#FF7A2F]/50 bg-[#FF7A2F]/[0.09] shadow-[inset_0_1px_0_rgba(255,122,47,0.16)]'
                  : 'border-white/[0.08] bg-[#12151C]/75 hover:border-white/[0.15]'
              }`}
            >
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={enableAutoSub}
                  onChange={(e) => setEnableAutoSub(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 accent-[#FF7A2F]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-white">
                    <BellRing className="h-3.5 w-3.5 text-[#FF9E4F]" />
                    <span>同时开启自动订阅追番（{subscribableInfo.subgroupName}）</span>
                    {autoSubLanguage !== 'all' && (
                      <span className="rounded-md bg-sky-500/18 px-1.5 py-0.5 text-[10.5px] font-medium text-sky-300">
                        {getSubtitleLanguageLabel(autoSubLanguage)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-400">
                    {subscribableInfo.maxSelectedEpisode > 0
                      ? `后续有第 ${subscribableInfo.maxSelectedEpisode + 1} 集等新更新推送时，将自动下载到上方同一文件夹（自动跳过本次已选）`
                      : '后续该字幕组有新集推送时，将自动下载到上方同一文件夹'}
                  </p>
                </div>
              </label>

              {enableAutoSub && (
                <div className="mt-2.5 ml-7 flex flex-wrap items-center gap-1.5 border-t border-white/[0.07] pt-2.5">
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                    <Languages className="h-3 w-3 text-sky-400" />
                    追更语言：
                  </span>
                  {SUBTITLE_LANGUAGE_OPTIONS.slice(0, 6).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setAutoSubLanguage(opt.id)}
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                        autoSubLanguage === opt.id
                          ? 'bg-sky-500 font-semibold text-[#0B0D11]'
                          : 'border border-white/[0.08] bg-[#0B0D11]/60 text-slate-300 hover:text-white'
                      }`}
                    >
                      {opt.shortLabel}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* qBittorrent Status Banner */}
          {connected ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-[#22C55E]/25 bg-[#22C55E]/10 px-3.5 py-2.5 text-[12px] text-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#22C55E]" />
              <span>
                qBittorrent {qbStatus?.version || ''} 已就绪，确认后将自动开始下载。
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3.5 py-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div className="text-[12px] leading-relaxed text-amber-100">
                  <div className="font-semibold">qBittorrent 当前未连接</div>
                  <div className="text-amber-200/75">
                    {qbStatus?.error || '请先启动本地 qBittorrent 并确保 WebUI 已开启'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onLaunchQb()}
                disabled={launchingQb}
                className="btn-ghost-dark flex shrink-0 items-center gap-1.5 rounded-lg border-amber-400/35 bg-amber-500/15 px-3 py-1.5 text-[12px] font-medium text-amber-100 hover:bg-amber-500/25"
              >
                {launchingQb ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Power className="h-3.5 w-3.5" />
                )}
                {launchingQb ? '启动中...' : '启动 qB'}
              </button>
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
            onClick={handleConfirm}
            disabled={submitting}
            className="btn-mikan flex h-9 items-center gap-2 rounded-xl px-4 text-[13px]"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在提交{isBatch ? ` (${items.length})` : ''}...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                {enableAutoSub && subscribableInfo
                  ? isBatch
                    ? `批量下载并开启自动追更 (${items.length})`
                    : '确认下载并开启自动追更'
                  : isBatch
                    ? `批量发送到 qBittorrent (${items.length})`
                    : '确认并发送到 qBittorrent'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

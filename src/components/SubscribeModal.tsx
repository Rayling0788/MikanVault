import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  BellRing,
  FolderOpen,
  Loader2,
  Sparkles,
  Tag,
  Filter,
  CheckCircle2,
  AlertCircle,
  Cloud,
  Languages,
} from 'lucide-react';
import type {
  AppSettings,
  CloudDriveStatus,
  MikanBangumiDetail,
  MikanSubgroup,
  SubscriptionItem,
  SubtitleLanguageFilter,
} from '@shared/types';
import {
  countSubtitleLanguages,
  getSubtitleLanguageLabel,
  SUBTITLE_LANGUAGE_OPTIONS,
} from '@shared/subtitleLanguage';
import { api } from '@/lib/api';
import { joinSavePath } from '@/lib/format';
import { PosterImage } from './PosterImage';

export interface SubscribeModalTarget {
  bangumiId: string;
  bangumiTitle: string;
  coverUrl?: string;
  detail?: MikanBangumiDetail | null;
  subgroup?: MikanSubgroup | null;
  existing?: SubscriptionItem | null;
  preferredSavePath?: string;
  detectedMaxEpisode?: number;
  preferredLanguageFilter?: SubtitleLanguageFilter;
}

interface SubscribeModalProps {
  target: SubscribeModalTarget | null;
  settings: AppSettings | null;
  onClose: () => void;
  onSaved: (sub: SubscriptionItem, checkImmediately: boolean) => void;
}

export const SubscribeModal: React.FC<SubscribeModalProps> = ({
  target,
  settings,
  onClose,
  onSaved,
}) => {
  const [detail, setDetail] = useState<MikanBangumiDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedSubgroupId, setSelectedSubgroupId] = useState('');
  const [startAfterEpisode, setStartAfterEpisode] = useState<number>(0);
  const [localDetectedCount, setLocalDetectedCount] = useState<number>(0);
  const [savePath, setSavePath] = useState('');
  const [category, setCategory] = useState('MikanVault');
  const [languageFilter, setLanguageFilter] = useState<SubtitleLanguageFilter>('all');
  const [includeKeywords, setIncludeKeywords] = useState('');
  const [excludeKeywords, setExcludeKeywords] = useState('');
  const [checkImmediately, setCheckImmediately] = useState(true);
  const [cloudStatus, setCloudStatus] = useState<CloudDriveStatus | null>(null);
  const [cloudOffload, setCloudOffload] = useState(false);
  const [deleteLocalAfterMove, setDeleteLocalAfterMove] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    const existing = target.existing;
    setError(null);
    setSubmitting(false);
    setCategory(existing?.category || settings?.qbCategory || 'MikanVault');
    setLanguageFilter(existing?.languageFilter || target.preferredLanguageFilter || 'all');
    setIncludeKeywords(existing?.includeKeywords || '');
    setExcludeKeywords(existing?.excludeKeywords || '');
    setCheckImmediately(!existing);
    setCloudOffload(Boolean(existing?.cloudTargetDir));
    setDeleteLocalAfterMove(
      existing?.deleteLocalAfterCloudMove ?? settings?.googleDriveAutoDeleteLocal ?? true,
    );
    void api
      .cloudGetStatus()
      .then((res) => {
        if (!cancelled) setCloudStatus(res);
      })
      .catch(() => {});

    const init = async () => {
      let resolvedDetail = target.detail || null;
      if (!resolvedDetail && target.bangumiId) {
        setLoadingDetail(true);
        try {
          resolvedDetail = await api.getBangumiDetail(target.bangumiId);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : '获取字幕组列表失败');
          }
        } finally {
          if (!cancelled) setLoadingDetail(false);
        }
      }

      if (cancelled) return;
      setDetail(resolvedDetail);

      let localHint = {
        savePath: target.preferredSavePath,
        maxEpisodeNumber: target.detectedMaxEpisode || 0,
        episodeCount: target.detectedMaxEpisode || 0,
        detectedSubgroup: undefined as string | undefined,
      };

      if (!existing) {
        try {
          const hint = await api.subDetectLocalProgress(
            target.bangumiId,
            resolvedDetail?.title || target.bangumiTitle,
            target.preferredSavePath
          );
          if (!cancelled) {
            localHint = {
              savePath: hint.savePath || target.preferredSavePath,
              maxEpisodeNumber: Math.max(
                hint.maxEpisodeNumber || 0,
                target.detectedMaxEpisode || 0
              ),
              episodeCount: Math.max(hint.episodeCount || 0, target.detectedMaxEpisode || 0),
              detectedSubgroup: hint.detectedSubgroup,
            };
          }
        } catch {
          // Ignore hint error
        }
      }

      if (cancelled) return;

      setLocalDetectedCount(localHint.episodeCount);
      setStartAfterEpisode(
        existing ? existing.startAfterEpisode : localHint.maxEpisodeNumber
      );
      setSavePath(
        existing?.savePath ||
          localHint.savePath ||
          joinSavePath(
            settings?.downloadRootDir || '',
            resolvedDetail?.title || target.bangumiTitle
          )
      );

      if (existing?.subgroupId) {
        setSelectedSubgroupId(existing.subgroupId);
      } else if (target.subgroup?.id) {
        setSelectedSubgroupId(target.subgroup.id);
      } else if (resolvedDetail?.subgroups?.length) {
        const matchedSg = localHint.detectedSubgroup
          ? resolvedDetail.subgroups.find((s) =>
              s.name.toLowerCase().includes(localHint.detectedSubgroup!.toLowerCase())
            )
          : undefined;
        setSelectedSubgroupId((matchedSg || resolvedDetail.subgroups[0]).id);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [target, settings?.downloadRootDir, settings?.qbCategory]);

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

  const activeSubgroup = useMemo(() => {
    if (target?.subgroup && !detail) return target.subgroup;
    if (!detail?.subgroups?.length) return target?.subgroup || null;
    return (
      detail.subgroups.find((s) => s.id === selectedSubgroupId) ||
      detail.subgroups[0]
    );
  }, [detail, selectedSubgroupId, target?.subgroup]);

  const subgroupDetectedLanguages = useMemo(() => {
    if (!activeSubgroup?.episodes?.length) return [];
    return countSubtitleLanguages(activeSubgroup.episodes.map((ep) => ep.title));
  }, [activeSubgroup]);

  const subgroupLanguageCounts = useMemo(() => {
    const map = new Map<SubtitleLanguageFilter, number>();
    for (const item of subgroupDetectedLanguages) {
      map.set(item.id, item.count);
    }
    return map;
  }, [subgroupDetectedLanguages]);

  if (!target) return null;

  const displayTitle = detail?.title || target.bangumiTitle;
  const displayCover = detail?.coverUrl || target.coverUrl;
  const subgroupId = activeSubgroup?.id || target.existing?.subgroupId || '';
  const subgroupName = activeSubgroup?.name || target.existing?.subgroupName || '';
  const rssUrl =
    activeSubgroup?.rssUrl ||
    target.existing?.rssUrl ||
    `${settings?.mikanBaseUrl || 'https://mikanani.kas.pub'}/RSS/Bangumi?bangumiId=${encodeURIComponent(target.bangumiId)}&subgroupid=${encodeURIComponent(subgroupId)}`;

  const resolvedCloudRoot = (
    settings?.googleDriveDir ||
    cloudStatus?.configuredDir ||
    cloudStatus?.defaultTargetDir ||
    ''
  ).trim();
  const cloudSeriesTarget = resolvedCloudRoot
    ? joinSavePath(resolvedCloudRoot, displayTitle)
    : '';

  const handlePickFolder = async () => {
    const picked = await api.dialogPickFolder();
    if (picked) setSavePath(picked);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subgroupId && !rssUrl) {
      setError('请选择一个字幕组再开启订阅');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const saved = await api.subUpsert({
        id: target.existing?.id,
        bangumiId: target.bangumiId,
        bangumiTitle: displayTitle,
        coverUrl: displayCover,
        subgroupId,
        subgroupName,
        rssUrl,
        savePath: savePath.trim(),
        category: category.trim() || undefined,
        startAfterEpisode: Math.max(0, Number(startAfterEpisode) || 0),
        languageFilter,
        includeKeywords: includeKeywords.trim() || undefined,
        excludeKeywords: excludeKeywords.trim() || undefined,
        cloudTargetDir: cloudOffload && cloudSeriesTarget ? cloudSeriesTarget : undefined,
        deleteLocalAfterCloudMove: deleteLocalAfterMove,
        enabled: target.existing ? target.existing.enabled : true,
      });
      onSaved(saved, checkImmediately);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存订阅失败');
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
      aria-labelledby="subscribe-modal-title"
    >
      <div className="animate-modal-enter glass-panel w-full max-w-[600px] overflow-hidden rounded-2xl border border-white/[0.1] shadow-[0_24px_80px_rgba(0,0,0,0.88)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FF7A2F]/15 text-[#FF7A2F] ring-1 ring-[#FF7A2F]/25">
              <BellRing className="h-4 w-4" />
            </div>
            <div>
              <h2 id="subscribe-modal-title" className="text-[15px] font-semibold text-white">
                {target.existing ? '编辑自动追更规则' : '订阅番剧自动追更'}
              </h2>
              <p className="text-[11.5px] text-slate-400">
                定时检查蜜柑 RSS 更新，自动跳过已下集数并推送至 qBittorrent
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

        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5">
            {/* Anime Banner */}
            <div className="flex items-center gap-3.5 rounded-xl border border-white/[0.07] bg-[#0B0D11]/65 p-3">
              <PosterImage
                url={displayCover}
                title={displayTitle}
                compactFallback
                className="h-[76px] w-[57px] shrink-0 rounded-lg border border-white/[0.08]"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="line-clamp-2 text-[14px] font-semibold text-white">
                  {displayTitle}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-slate-400">
                  <span className="rounded-md bg-[#FF7A2F]/15 px-2 py-0.5 font-medium text-[#FF9E4F]">
                    MIKAN #{target.bangumiId}
                  </span>
                  {subgroupName && (
                    <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-slate-200">
                      字幕组：{subgroupName}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Subgroup Selector (if multiple subgroups available and not editing locked id) */}
            {loadingDetail ? (
              <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#0B0D11]/50 px-3.5 py-3 text-[12.5px] text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-[#FF7A2F]" />
                正在加载蜜柑计划字幕组列表...
              </div>
            ) : (
              detail &&
              detail.subgroups.length > 0 &&
              !target.existing && (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-slate-300">
                    选择要追更的字幕组
                  </label>
                  <div className="flex max-h-36 flex-wrap items-center gap-1.5 overflow-y-auto pr-1">
                    {detail.subgroups.map((sg) => {
                      const active = activeSubgroup?.id === sg.id;
                      return (
                        <button
                          key={sg.id}
                          type="button"
                          onClick={() => setSelectedSubgroupId(sg.id)}
                          className={`shrink-0 rounded-xl px-3 py-1.5 text-[12px] font-medium transition ${
                            active
                              ? 'bg-[#FF7A2F] text-[#0B0D11] font-semibold'
                              : 'border border-white/[0.08] bg-[#12151C] text-slate-300 hover:text-white'
                          }`}
                        >
                          {sg.name} ({sg.episodes.length})
                        </button>
                      );
                    })}
                  </div>
                </div>
              )
            )}

            {/* Start After Episode */}
            <div className="rounded-xl border border-white/[0.08] bg-[#12151C]/70 p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="sub-start-after"
                  className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white"
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#FF7A2F]" />
                  已下载集数 / 跳过前 N 集
                </label>
                {localDetectedCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#22C55E]/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" />
                    本地已检测到 {localDetectedCount} 集
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-slate-400">跳过 ≤ 第</span>
                  <input
                    id="sub-start-after"
                    type="number"
                    min={0}
                    max={9999}
                    value={startAfterEpisode}
                    onChange={(e) =>
                      setStartAfterEpisode(Math.max(0, Number.parseInt(e.target.value || '0', 10)))
                    }
                    className="input-cinema h-9 w-20 rounded-lg px-2.5 text-center font-mono text-[13.5px] font-semibold text-[#FF9E4F] tabular-nums"
                  />
                  <span className="text-[12px] text-slate-400">集</span>
                </div>
                <span className="text-[12px] text-slate-300">
                  {startAfterEpisode > 0 ? (
                    <>
                      将自动从 <strong className="text-[#FF9E4F]">第 {startAfterEpisode + 1} 集</strong> 起下载新更新
                    </>
                  ) : (
                    '将自动下载该字幕组发布的所有集数'
                  )}
                </span>
              </div>
            </div>

            {/* Save Path */}
            <div className="space-y-1.5">
              <label htmlFor="sub-save-path" className="text-[12px] font-medium text-slate-300">
                自动下载保存路径
              </label>
              <div className="flex gap-2">
                <input
                  id="sub-save-path"
                  type="text"
                  value={savePath}
                  onChange={(e) => setSavePath(e.target.value)}
                  placeholder="例如 H:\无职转生 S3"
                  className="input-cinema h-10 flex-1 rounded-xl px-3.5 font-mono text-[12.5px]"
                />
                <button
                  type="button"
                  onClick={() => void handlePickFolder()}
                  className="btn-ghost-dark inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium"
                >
                  <FolderOpen className="h-4 w-4 text-slate-400" />
                  浏览
                </button>
              </div>
            </div>

            {/* Cloud Auto-Offload Option */}
            {resolvedCloudRoot && (
              <div
                className={`rounded-xl border p-3 transition ${
                  cloudOffload
                    ? 'border-sky-400/45 bg-sky-500/[0.08]'
                    : 'border-white/[0.08] bg-[#12151C]/65'
                }`}
              >
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={cloudOffload}
                    onChange={(e) => setCloudOffload(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded accent-sky-400"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-white">
                      <Cloud className="h-3.5 w-3.5 text-sky-400" />
                      <span>新剧集下完后自动转存到谷歌云盘（节省本地空间）</span>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-sky-300/85">
                      目标目录：{cloudSeriesTarget}
                    </p>
                  </div>
                </label>
                {cloudOffload && (
                  <label className="mt-2 ml-6.5 flex cursor-pointer items-center gap-2 text-[11.5px] text-slate-300">
                    <input
                      type="checkbox"
                      checked={deleteLocalAfterMove}
                      onChange={(e) => setDeleteLocalAfterMove(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-sky-400"
                    />
                    <span>校验云盘文件完整后自动删除本地暂存文件</span>
                  </label>
                )}
              </div>
            )}

            {/* Subtitle Language Filter */}
            <div className="space-y-1.5 rounded-xl border border-white/[0.08] bg-[#12151C]/65 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-slate-200">
                  <Languages className="h-3.5 w-3.5 text-sky-400" />
                  自动追更字幕语言筛选
                </span>
                <span className="text-[11px] text-slate-400">
                  当字幕组同时发布简/繁/双语多版本时，仅下载所选语言
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SUBTITLE_LANGUAGE_OPTIONS.map((opt) => {
                  const active = languageFilter === opt.id;
                  const hasSubgroupStats = Boolean(activeSubgroup?.episodes?.length);
                  const count =
                    opt.id === 'all'
                      ? activeSubgroup?.episodes?.length || 0
                      : subgroupLanguageCounts.get(opt.id) || 0;
                  const isZeroInSubgroup =
                    opt.id !== 'all' &&
                    hasSubgroupStats &&
                    subgroupLanguageCounts.size > 0 &&
                    count === 0;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setLanguageFilter(opt.id)}
                      title={opt.description}
                      className={`rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition tabular-nums ${
                        active
                          ? 'bg-sky-500 font-semibold text-[#0B0D11]'
                          : isZeroInSubgroup
                            ? 'border border-white/[0.05] bg-[#0B0D11]/45 text-slate-500 hover:border-white/[0.12] hover:text-slate-300'
                            : 'border border-white/[0.08] bg-[#0B0D11]/70 text-slate-300 hover:text-white'
                      }`}
                    >
                      {opt.shortLabel}
                      {hasSubgroupStats && count > 0 ? ` (${count})` : ''}
                    </button>
                  );
                })}
              </div>
              {languageFilter !== 'all' &&
                subgroupLanguageCounts.size > 0 &&
                !subgroupLanguageCounts.has(languageFilter) && (
                  <p className="text-[11px] text-amber-300/90">
                    提示：该字幕组近期资源检测到的语言为{' '}
                    {subgroupDetectedLanguages.map((item) => item.shortLabel).join(' / ')}
                    ，当前所选「{getSubtitleLanguageLabel(languageFilter)}」暂未匹配
                  </p>
                )}
            </div>

            {/* Keyword Filters & Category */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="sub-include"
                  className="flex items-center gap-1.5 text-[12px] font-medium text-slate-300"
                >
                  <Filter className="h-3.5 w-3.5 text-[#38BDF8]" />
                  包含关键词（可选，空格或逗号分隔）
                </label>
                <input
                  id="sub-include"
                  type="text"
                  value={includeKeywords}
                  onChange={(e) => setIncludeKeywords(e.target.value)}
                  placeholder="例如 1080p, 简繁"
                  className="input-cinema h-9 w-full rounded-xl px-3 text-[12.5px]"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="sub-exclude"
                  className="flex items-center gap-1.5 text-[12px] font-medium text-slate-300"
                >
                  <Filter className="h-3.5 w-3.5 text-rose-400" />
                  排除关键词（可选）
                </label>
                <input
                  id="sub-exclude"
                  type="text"
                  value={excludeKeywords}
                  onChange={(e) => setExcludeKeywords(e.target.value)}
                  placeholder="例如 720p, 合集"
                  className="input-cinema h-9 w-full rounded-xl px-3 text-[12.5px]"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <label
                  htmlFor="sub-category"
                  className="flex items-center gap-1.5 text-[12px] font-medium text-slate-400"
                >
                  <Tag className="h-3.5 w-3.5" />
                  qB 分类
                </label>
                <input
                  id="sub-category"
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="input-cinema h-8 w-36 rounded-lg px-2.5 text-[12px]"
                />
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-slate-300">
                <input
                  type="checkbox"
                  checked={checkImmediately}
                  onChange={(e) => setCheckImmediately(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 accent-[#FF7A2F]"
                />
                <span>保存后立即检查一次新集</span>
              </label>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/12 px-3.5 py-2.5 text-[12px] text-rose-200">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
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
              type="submit"
              disabled={submitting || loadingDetail}
              className="btn-mikan flex h-9 items-center gap-2 rounded-xl px-4 text-[13px]"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  保存中...
                </>
              ) : (
                <>
                  <BellRing className="h-4 w-4" />
                  {target.existing ? '保存追更规则' : '确认开启自动追更'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

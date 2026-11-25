import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  LibrarySeries,
  MikanBangumiCard,
  MikanBangumiDetail,
  MikanRelease,
  MikanScheduleResponse,
  MikanSearchResult,
  MikanSeasonName,
  SubscriptionItem,
} from '@shared/types';
import '@/styles/app.css';
import { api, isElectronRuntime } from '@/lib/api';
import { ToastProvider, useToast } from '@/hooks/useToast';
import { useQbStatus } from '@/hooks/useQbStatus';
import { useCloudStatus } from '@/hooks/useCloudStatus';
import { Sidebar, type NavSection } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import {
  DownloadConfirmModal,
  type DownloadModalTarget,
} from '@/components/DownloadConfirmModal';
import {
  SubscribeModal,
  type SubscribeModalTarget,
} from '@/components/SubscribeModal';
import { DiscoverPage } from '@/pages/DiscoverPage';
import { BangumiDetailView } from '@/pages/BangumiDetailView';
import { SearchResultsView } from '@/pages/SearchResultsView';
import { LatestRssPage } from '@/pages/LatestRssPage';
import { SubscriptionsPage } from '@/pages/SubscriptionsPage';
import { DownloadsPage } from '@/pages/DownloadsPage';
import { CloudUploadPage } from '@/pages/CloudUploadPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { SeriesDetailView } from '@/pages/SeriesDetailView';
import { SettingsPage } from '@/pages/SettingsPage';

type OverlayView =
  | { kind: 'none' }
  | {
      kind: 'bangumi';
      bangumiId: string;
      initialTitle?: string;
      initialCoverUrl?: string;
      initialDetail?: MikanBangumiDetail | null;
      returnToSearch?: boolean;
    }
  | { kind: 'series'; seriesId: string };

const SECTION_META: Record<NavSection, { title: string; subtitle: string }> = {
  discover: { title: '番剧探索', subtitle: '蜜柑计划本季放送表' },
  search: { title: '搜番 / 老番', subtitle: '全站关键词与历年季度老番库' },
  latest: { title: '最新更新', subtitle: '实时 RSS 与链接快速解析' },
  subscriptions: { title: '自动追更', subtitle: '定时检查更新并自动跳过已下集数' },
  downloads: { title: '下载队列', subtitle: 'qBittorrent 实时同步' },
  cloud: { title: '云盘上传', subtitle: 'Google Drive 传输中心' },
  library: { title: '我的媒体库', subtitle: '本地番剧收藏与外部播放器' },
  settings: { title: '偏好设置', subtitle: '源站、下载器与媒体目录' },
};

const MikanVaultShell: React.FC = () => {
  const { pushToast } = useToast();
  const mainScrollRef = useRef<HTMLDivElement>(null);

  const [activeSection, setActiveSection] = useState<NavSection>('discover');
  const [overlay, setOverlay] = useState<OverlayView>({ kind: 'none' });
  const [customRssUrl, setCustomRssUrl] = useState<string | undefined>(undefined);

  // Settings
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // Schedule state
  const [schedule, setSchedule] = useState<MikanScheduleResponse | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<{
    year?: number;
    season?: MikanSeasonName;
  } | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Search state
  const [searchInput, setSearchInput] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<MikanSearchResult | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Library state
  const [librarySeries, setLibrarySeries] = useState<LibrarySeries[]>([]);
  const [libraryScanning, setLibraryScanning] = useState(false);
  const [libraryInitialized, setLibraryInitialized] = useState(false);
  const [hiddenLibraryCount, setHiddenLibraryCount] = useState(0);

  // Download modal targets (1 or batch)
  const [downloadModal, setDownloadModal] = useState<{
    targets: DownloadModalTarget[];
    onSuccessClear?: () => void;
  }>({ targets: [] });

  // Subscriptions state & modal
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [subscribeTarget, setSubscribeTarget] = useState<SubscribeModalTarget | null>(null);

  // Live qBittorrent polling (2s on Downloads page, 6s in background)
  const qb = useQbStatus(activeSection === 'downloads' && overlay.kind === 'none');
  const cloudRefreshRef = useRef<() => void>(() => {});
  const cloud = useCloudStatus(
    activeSection === 'cloud' && overlay.kind === 'none',
    () => cloudRefreshRef.current(),
  );

  const scrollTop = () => {
    mainScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  };

  const loadSchedule = useCallback(async (year?: number, season?: MikanSeasonName) => {
    setScheduleLoading(true);
    setScheduleError(null);
    if (year !== undefined && season !== undefined) {
      setSelectedSeason({ year, season });
    } else {
      setSelectedSeason(null);
    }
    try {
      const data = await api.getSchedule(year, season);
      setSchedule(data);
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : '加载放送表失败');
    } finally {
      setScheduleLoading(false);
    }
  }, []);

  const scanLibrary = useCallback(async (silent = false) => {
    setLibraryScanning(true);
    try {
      const [list, hiddenCount] = await Promise.all([
        api.libraryScan(),
        api.libraryGetHiddenCount().catch(() => 0),
      ]);
      setLibrarySeries(Array.isArray(list) ? list : []);
      setHiddenLibraryCount(typeof hiddenCount === 'number' ? hiddenCount : 0);
      setLibraryInitialized(true);
      if (!silent) {
        pushToast({
          kind: 'success',
          title: '媒体库扫描完成',
          description: `共发现 ${list.length} 部本地番剧`,
        });
      }
    } catch (err) {
      if (!silent) {
        pushToast({
          kind: 'error',
          title: '扫描媒体库失败',
          description: err instanceof Error ? err.message : '请检查目录权限',
        });
      }
    } finally {
      setLibraryScanning(false);
    }
  }, [pushToast]);

  const handleRestoreHidden = useCallback(async () => {
    const res = await api.libraryRestoreHidden();
    if (res.ok) {
      pushToast({
        kind: 'success',
        title: '已恢复全部隐藏项',
        description: '正在重新扫描媒体库',
      });
      await scanLibrary(true);
    } else {
      pushToast({
        kind: 'error',
        title: '恢复失败',
        description: res.error,
      });
    }
  }, [pushToast, scanLibrary]);

  const loadSubscriptions = useCallback(async () => {
    try {
      const list = await api.subList();
      setSubscriptions(Array.isArray(list) ? list : []);
    } catch {
      // Ignore
    }
  }, []);

  cloudRefreshRef.current = () => {
    void scanLibrary(true);
  };

  // Initial boot loads
  useEffect(() => {
    void api.settingsGet().then(setSettings).catch(() => {});
    void loadSchedule();
    void loadSubscriptions();
    const unsub = api.onSubscriptionsUpdated?.(() => {
      void loadSubscriptions();
      void qb.refresh();
    });
    return () => unsub?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSchedule, loadSubscriptions]);

  // Auto-scan library first time user enters Library section
  useEffect(() => {
    if (activeSection === 'library' && !libraryInitialized && !libraryScanning) {
      void scanLibrary(true);
    }
  }, [activeSection, libraryInitialized, libraryScanning, scanLibrary]);

  const handleSelectSection = (section: NavSection) => {
    setActiveSection(section);
    setOverlay({ kind: 'none' });
    scrollTop();
  };

  const handleOpenBangumiCard = (card: MikanBangumiCard, fromSearch = false) => {
    setOverlay({
      kind: 'bangumi',
      bangumiId: card.id,
      initialTitle: card.title,
      initialCoverUrl: card.coverUrl,
      returnToSearch: fromSearch,
    });
    scrollTop();
  };

  const handleOpenBangumiId = (id: string, detail?: MikanBangumiDetail) => {
    setOverlay({
      kind: 'bangumi',
      bangumiId: id,
      initialTitle: detail?.title,
      initialCoverUrl: detail?.coverUrl,
      initialDetail: detail || null,
    });
    scrollTop();
  };

  const handleSearchSubmit = async (query: string) => {
    const clean = query.trim();
    if (!clean) return;
    setSearchInput(clean);
    setActiveSearchQuery(clean);
    setActiveSection('search');
    setOverlay({ kind: 'none' });
    setSearchLoading(true);
    setSearchError(null);
    scrollTop();
    try {
      const res = await api.searchMikan(clean);
      setSearchResult(res);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : '搜索失败');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setActiveSearchQuery('');
    setSearchResult(null);
    setSearchError(null);
  };

  const handleGoBack = () => {
    if (overlay.kind === 'bangumi' && overlay.returnToSearch) {
      setActiveSection('search');
      setOverlay({ kind: 'none' });
    } else {
      setOverlay({ kind: 'none' });
    }
    scrollTop();
  };

  const handleLaunchQbWithToast = async () => {
    const res = await qb.launchQb();
    if (res.ok) {
      pushToast({
        kind: 'success',
        title: 'qBittorrent 已启动',
        description: '正在同步本地下载队列',
      });
    } else {
      pushToast({
        kind: 'error',
        title: '无法启动 qBittorrent',
        description: res.error || '请在偏好设置中检查 qbittorrent.exe 路径',
      });
    }
    return res;
  };

  const activeSeries = useMemo(() => {
    if (overlay.kind !== 'series') return null;
    return librarySeries.find((s) => s.seriesId === overlay.seriesId) || null;
  }, [overlay, librarySeries]);

  const topBarMeta = useMemo(() => {
    if (overlay.kind === 'bangumi') {
      return {
        title: overlay.initialTitle || `番剧详情 #${overlay.bangumiId}`,
        subtitle: '字幕组与资源列表',
        canGoBack: true,
      };
    }
    if (overlay.kind === 'series' && activeSeries) {
      return {
        title: activeSeries.title,
        subtitle: `${activeSeries.totalEpisodes} 集本地影片`,
        canGoBack: true,
      };
    }
    if (activeSection === 'discover' && selectedSeason?.year && selectedSeason?.season) {
      return {
        title: SECTION_META.discover.title,
        subtitle: `${selectedSeason.year} 年${selectedSeason.season}季番剧表`,
        canGoBack: false,
      };
    }
    return {
      ...SECTION_META[activeSection],
      canGoBack: false,
    };
  }, [overlay, activeSection, activeSeries, selectedSeason]);

  return (
    <div className="app-canvas-glow flex h-screen w-screen overflow-hidden text-slate-100">
      {/* Left Navigation Rail */}
      <Sidebar
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        qbStatus={qb.status}
        activeDownloads={qb.activeCount}
        activeCloudJobs={cloud.activeCount + cloud.queuedCount}
        activeSubscriptions={subscriptions.filter((s) => s.enabled).length}
        totalDlSpeed={qb.totalDlSpeed}
        launchingQb={qb.launching}
        onLaunchQb={() => void handleLaunchQbWithToast()}
      />

      {/* Right Main Column */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          title={topBarMeta.title}
          subtitle={topBarMeta.subtitle}
          canGoBack={topBarMeta.canGoBack}
          onGoBack={handleGoBack}
          searchQuery={searchInput}
          onSearchChange={setSearchInput}
          onSearchSubmit={(q) => void handleSearchSubmit(q)}
          onClearSearch={handleClearSearch}
          isPreviewMode={!isElectronRuntime}
        />

        <main ref={mainScrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {overlay.kind === 'bangumi' ? (
            <BangumiDetailView
              bangumiId={overlay.bangumiId}
              initialTitle={overlay.initialTitle}
              initialCoverUrl={overlay.initialCoverUrl}
              initialDetail={overlay.initialDetail}
              subscriptions={subscriptions}
              onRequestDownload={(release, detail, subgroup, preferredLanguageFilter) =>
                setDownloadModal({
                  targets: [
                    {
                      release,
                      bangumiId: detail.id,
                      bangumiTitle: detail.title,
                      coverUrl: detail.coverUrl,
                      subgroupId: subgroup?.id || release.subgroupId,
                      subgroupName: subgroup?.name || release.subgroup,
                      rssUrl: subgroup?.rssUrl,
                      preferredLanguageFilter,
                    },
                  ],
                })
              }
              onRequestBatchDownload={(
                releases,
                detail,
                onDoneClear,
                subgroup,
                preferredLanguageFilter,
              ) =>
                setDownloadModal({
                  targets: releases.map((release) => ({
                    release,
                    bangumiId: detail.id,
                    bangumiTitle: detail.title,
                    coverUrl: detail.coverUrl,
                    subgroupId: subgroup?.id || release.subgroupId,
                    subgroupName: subgroup?.name || release.subgroup,
                    rssUrl: subgroup?.rssUrl,
                    preferredLanguageFilter,
                  })),
                  onSuccessClear: onDoneClear,
                })
              }
              onRequestSubscribe={(detail, subgroup, existing, preferredLanguageFilter) =>
                setSubscribeTarget({
                  bangumiId: detail.id,
                  bangumiTitle: detail.title,
                  coverUrl: detail.coverUrl,
                  detail,
                  subgroup,
                  existing,
                  preferredLanguageFilter,
                })
              }
              onOpenRssFeed={(rssUrl) => {
                setCustomRssUrl(rssUrl);
                setActiveSection('latest');
                setOverlay({ kind: 'none' });
                scrollTop();
              }}
            />
          ) : overlay.kind === 'series' && activeSeries ? (
            <SeriesDetailView
              series={activeSeries}
              subscriptions={subscriptions}
              onRefreshLibrary={() => scanLibrary(true)}
              onCloudUploaded={() => void cloud.refresh()}
              onSeriesRemoved={() => {
                setOverlay({ kind: 'none' });
                setActiveSection('library');
                void scanLibrary(true);
              }}
              onRequestSubscribe={(info) =>
                setSubscribeTarget({
                  bangumiId: info.bangumiId,
                  bangumiTitle: info.bangumiTitle,
                  coverUrl: info.coverUrl,
                  preferredSavePath: info.preferredSavePath,
                  detectedMaxEpisode: info.detectedMaxEpisode,
                  existing: info.existing,
                })
              }
            />
          ) : activeSection === 'discover' ? (
            <DiscoverPage
              schedule={schedule}
              loading={scheduleLoading}
              error={scheduleError}
              selectedSeason={selectedSeason}
              onSelectSeason={(year, season) => void loadSchedule(year, season)}
              onRefresh={() => void loadSchedule(selectedSeason?.year, selectedSeason?.season)}
              onOpenBangumi={(card) => handleOpenBangumiCard(card)}
            />
          ) : activeSection === 'search' ? (
            <SearchResultsView
              query={activeSearchQuery}
              result={searchResult}
              loading={searchLoading}
              error={searchError}
              onSearch={(q) => void handleSearchSubmit(q)}
              onOpenBangumi={(card) => handleOpenBangumiCard(card, true)}
              onRequestDownload={(release) =>
                setDownloadModal({
                  targets: [
                    {
                      release,
                      bangumiId: release.bangumiId,
                      bangumiTitle: release.bangumiTitle,
                    },
                  ],
                })
              }
              onRequestBatchDownload={(releases, onDoneClear) =>
                setDownloadModal({
                  targets: releases.map((release) => ({
                    release,
                    bangumiId: release.bangumiId,
                    bangumiTitle: release.bangumiTitle,
                  })),
                  onSuccessClear: onDoneClear,
                })
              }
            />
          ) : activeSection === 'latest' ? (
            <LatestRssPage
              initialRssUrl={customRssUrl}
              onOpenBangumiDetail={handleOpenBangumiId}
              onRequestDownload={(release) =>
                setDownloadModal({
                  targets: [
                    {
                      release,
                      bangumiId: release.bangumiId,
                      bangumiTitle: release.bangumiTitle,
                    },
                  ],
                })
              }
              onRequestBatchDownload={(releases, onDoneClear) =>
                setDownloadModal({
                  targets: releases.map((release) => ({
                    release,
                    bangumiId: release.bangumiId,
                    bangumiTitle: release.bangumiTitle,
                  })),
                  onSuccessClear: onDoneClear,
                })
              }
            />
          ) : activeSection === 'subscriptions' ? (
            <SubscriptionsPage
              subscriptions={subscriptions}
              settings={settings}
              onRefreshSubscriptions={loadSubscriptions}
              onEditSubscription={(sub) =>
                setSubscribeTarget({
                  bangumiId: sub.bangumiId,
                  bangumiTitle: sub.bangumiTitle,
                  coverUrl: sub.coverUrl,
                  existing: sub,
                })
              }
              onOpenBangumi={(id, title, coverUrl) => {
                setOverlay({
                  kind: 'bangumi',
                  bangumiId: id,
                  initialTitle: title,
                  initialCoverUrl: coverUrl,
                });
                scrollTop();
              }}
              onUpdateInterval={async (minutes) => {
                const updated = await api.settingsUpdate({
                  subscriptionCheckIntervalMin: minutes,
                });
                setSettings(updated);
                pushToast({
                  kind: 'success',
                  title: `已调整自动检查间隔为每 ${minutes} 分钟`,
                });
              }}
            />
          ) : activeSection === 'downloads' ? (
            <DownloadsPage
              status={qb.status}
              torrents={qb.torrents}
              loading={qb.loading}
              launching={qb.launching}
              activeCount={qb.activeCount}
              completedCount={qb.completedCount}
              totalDlSpeed={qb.totalDlSpeed}
              totalUlSpeed={qb.totalUlSpeed}
              onRefresh={qb.refresh}
              onLaunchQb={handleLaunchQbWithToast}
              onOpenSettings={() => handleSelectSection('settings')}
              onOpenCloudPage={() => handleSelectSection('cloud')}
            />
          ) : activeSection === 'cloud' ? (
            <CloudUploadPage
              status={cloud.status}
              jobs={cloud.jobs}
              loading={cloud.loading}
              activeCount={cloud.activeCount}
              queuedCount={cloud.queuedCount}
              completedCount={cloud.completedCount}
              failedOrCancelledCount={cloud.failedOrCancelledCount}
              totalSpeed={cloud.totalSpeed}
              totalUploadedBytes={cloud.totalUploadedBytes}
              librarySeries={librarySeries}
              onRefresh={cloud.refresh}
              onRefreshLibrary={() => scanLibrary(true)}
              onOpenSettings={() => handleSelectSection('settings')}
            />
          ) : activeSection === 'library' ? (
            <LibraryPage
              seriesList={librarySeries}
              scanning={libraryScanning}
              hiddenCount={hiddenLibraryCount}
              onScan={() => void scanLibrary(false)}
              onRefreshLibrary={() => scanLibrary(true)}
              onCloudUploaded={() => void cloud.refresh()}
              onRestoreHidden={handleRestoreHidden}
              onOpenSeries={(series) => {
                setOverlay({ kind: 'series', seriesId: series.seriesId });
                scrollTop();
              }}
              onOpenSettings={() => handleSelectSection('settings')}
              onRequestSubscribe={(series) => {
                if (!series.bangumiId) return;
                const maxEp = series.episodes.reduce(
                  (max, ep) => Math.max(max, ep.episodeNumber ?? 0),
                  0
                );
                setSubscribeTarget({
                  bangumiId: series.bangumiId,
                  bangumiTitle: series.title,
                  coverUrl: series.coverUrl,
                  preferredSavePath: series.folderPath,
                  detectedMaxEpisode: maxEp > 0 ? maxEp : series.totalEpisodes,
                  existing:
                    subscriptions.find((s) => s.bangumiId === series.bangumiId) || null,
                });
              }}
            />
          ) : (
            <SettingsPage
              settings={settings}
              onSettingsUpdated={setSettings}
              onRefreshQb={qb.refresh}
              onLaunchQb={handleLaunchQbWithToast}
              launchingQb={qb.launching}
            />
          )}
        </main>
      </div>

      {/* Global Download Confirmation Modal (Single & Batch) */}
      <DownloadConfirmModal
        targets={downloadModal.targets}
        settings={settings}
        qbStatus={qb.status}
        launchingQb={qb.launching}
        onLaunchQb={handleLaunchQbWithToast}
        onClose={() => setDownloadModal({ targets: [] })}
        onSubmitted={(summary) => {
          if (summary.ok) {
            downloadModal.onSuccessClear?.();
            if (summary.autoSubscribed) {
              void loadSubscriptions();
            }
            const subNote = summary.autoSubscribed
              ? ` · 已开启自动追更${summary.startAfterEpisode ? `（第 ${summary.startAfterEpisode + 1} 集起）` : ''}`
              : '';
            if (summary.total > 1) {
              pushToast({
                kind: summary.failed > 0 ? 'info' : 'success',
                title:
                  summary.failed > 0
                    ? `批量提交完成：成功 ${summary.succeeded} / ${summary.total}${subNote}`
                    : `已批量添加 ${summary.succeeded} 个任务到 qBittorrent${subNote}`,
                description: summary.savePath
                  ? `保存至 ${summary.savePath}`
                  : summary.error || '任务已开始下载',
              });
            } else {
              pushToast({
                kind: 'success',
                title: `已添加到 qBittorrent 队列${subNote}`,
                description: summary.savePath
                  ? `保存至 ${summary.savePath}`
                  : '任务已开始下载',
              });
            }
            void qb.refresh();
          } else {
            pushToast({
              kind: summary.total > 1 ? 'error' : 'error',
              title: summary.total > 1 ? '批量发送下载任务失败' : '发送下载任务失败',
              description: summary.error || '请检查 qBittorrent 连接状态',
            });
          }
        }}
      />

      {/* Global Auto-Subscription Modal */}
      <SubscribeModal
        target={subscribeTarget}
        settings={settings}
        onClose={() => setSubscribeTarget(null)}
        onSaved={(sub, checkImmediately) => {
          void loadSubscriptions();
          pushToast({
            kind: 'success',
            title: '已开启自动追更订阅',
            description:
              sub.startAfterEpisode > 0
                ? `${sub.bangumiTitle} · 跳过 ≤ 第 ${sub.startAfterEpisode} 集，从第 ${sub.startAfterEpisode + 1} 集起自动下载`
                : `${sub.bangumiTitle} (${sub.subgroupName})`,
          });
          if (checkImmediately) {
            void api.subCheckNow(sub.id).then((res) => {
              void loadSubscriptions();
              if (res.newDownloads > 0) {
                pushToast({
                  kind: 'success',
                  title: `立即检测到 ${res.newDownloads} 集新更新`,
                  description: '已自动发送至 qBittorrent 下载队列',
                });
                void qb.refresh();
              }
            });
          }
        }}
      />
    </div>
  );
};

export default function App() {
  return (
    <ToastProvider>
      <MikanVaultShell />
    </ToastProvider>
  );
}

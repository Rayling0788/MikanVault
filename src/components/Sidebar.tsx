import React, { useState } from 'react';
import {
  Compass,
  Search,
  Rss,
  BellRing,
  Download,
  Film,
  Settings,
  ArrowDown,
  Power,
  Loader2,
  CloudUpload,
  Cloud,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import type { CloudDriveStatus, QbConnectionStatus } from '@shared/types';
import { BrandLogo } from './BrandLogo';
import { formatBytes, formatSpeed } from '@/lib/format';

export type NavSection =
  | 'discover'
  | 'search'
  | 'latest'
  | 'subscriptions'
  | 'downloads'
  | 'cloud'
  | 'library'
  | 'settings';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  qbStatus: QbConnectionStatus | null;
  activeDownloads: number;
  activeCloudJobs?: number;
  cloudStatus?: CloudDriveStatus | null;
  cloudSpeed?: number;
  activeSubscriptions: number;
  totalDlSpeed: number;
  launchingQb: boolean;
  onLaunchQb: () => void;
}

const COLLAPSE_STORAGE_KEY = 'mikanvault_sidebar_collapsed';

const NAV_GROUPS: Array<{
  groupLabel: string;
  items: Array<{
    id: NavSection;
    label: string;
    icon: React.FC<{ className?: string }>;
  }>;
}> = [
  {
    groupLabel: '发现追番',
    items: [
      { id: 'discover', label: '番剧探索', icon: Compass },
      { id: 'search', label: '搜番 / 老番', icon: Search },
      { id: 'latest', label: '最新更新', icon: Rss },
    ],
  },
  {
    groupLabel: '追更与传输',
    items: [
      { id: 'subscriptions', label: '自动追更', icon: BellRing },
      { id: 'downloads', label: '下载队列', icon: Download },
      { id: 'cloud', label: '云盘上传', icon: CloudUpload },
    ],
  },
  {
    groupLabel: '媒体与系统',
    items: [
      { id: 'library', label: '我的媒体库', icon: Film },
      { id: 'settings', label: '偏好设置', icon: Settings },
    ],
  },
];

function readCollapsedState(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSelectSection,
  qbStatus,
  activeDownloads,
  activeCloudJobs = 0,
  cloudStatus,
  cloudSpeed = 0,
  activeSubscriptions,
  totalDlSpeed,
  launchingQb,
  onLaunchQb,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsedState());
  const connected = Boolean(qbStatus?.connected);
  const cloudReady = Boolean(cloudStatus?.detected || cloudStatus?.configuredDir);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Ignore storage error
      }
      return next;
    });
  };

  return (
    <aside
      className={`surface-sidebar flex h-full shrink-0 flex-col border-r select-none transition-[width] duration-200 ease-out ${
        collapsed ? 'w-[74px]' : 'w-[232px]'
      }`}
    >
      {/* Brand Mark + Collapse Toggle */}
      <div
        className={`titlebar-drag flex h-[54px] items-center border-b border-white/[0.055] ${
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandLogo
            size={30}
            className="shrink-0 drop-shadow-[0_4px_12px_rgba(255,122,47,0.34)]"
          />
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[14.5px] font-bold tracking-tight text-white">
                  MikanVault
                </span>
              </div>
              <div className="text-[10px] font-medium tracking-[0.14em] text-slate-500">
                ANIME VAULT
              </div>
            </div>
          )}
        </div>

        {!collapsed && (
          <button
            type="button"
            onClick={toggleCollapsed}
            title="收起侧边栏"
            aria-label="收起侧边栏"
            className="titlebar-no-drag flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {collapsed && (
        <div className="flex justify-center pt-2.5">
          <button
            type="button"
            onClick={toggleCollapsed}
            title="展开侧边栏"
            aria-label="展开侧边栏"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Grouped Navigation */}
      <nav className="no-scrollbar mt-3 flex-1 space-y-4 overflow-y-auto px-2.5" aria-label="主导航">
        {NAV_GROUPS.map((group) => (
          <div key={group.groupLabel} className="space-y-1">
            {!collapsed && (
              <div className="px-2.5 pb-0.5 text-[10.5px] font-semibold tracking-[0.08em] text-slate-500">
                {group.groupLabel}
              </div>
            )}
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              const badgeCount =
                item.id === 'downloads'
                  ? activeDownloads
                  : item.id === 'cloud'
                    ? activeCloudJobs
                    : item.id === 'subscriptions'
                      ? activeSubscriptions
                      : 0;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectSection(item.id)}
                  title={collapsed ? item.label : undefined}
                  className={`group relative flex w-full items-center rounded-xl transition-all duration-150 ${
                    collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2 text-left'
                  } ${
                    isActive
                      ? 'sidebar-nav-active'
                      : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-100'
                  }`}
                >
                  {isActive && (
                    <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-gradient-to-b from-[#FF9E4F] to-[#FF7A2F] shadow-[0_0_10px_rgba(255,122,47,0.75)]" />
                  )}

                  <Icon
                    className={`h-[18px] w-[18px] shrink-0 transition-colors ${
                      isActive ? 'text-[#FF7A2F]' : 'text-slate-500 group-hover:text-slate-300'
                    }`}
                  />

                  {!collapsed && (
                    <span className="flex-1 truncate text-[13px] font-medium">{item.label}</span>
                  )}

                  {!collapsed && badgeCount > 0 && (
                    <span
                      className={`tabular-nums rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ${
                        item.id === 'downloads'
                          ? 'bg-[#38BDF8]/18 text-[#38BDF8] ring-[#38BDF8]/30'
                          : item.id === 'cloud'
                            ? 'bg-sky-500/20 text-sky-300 ring-sky-400/35'
                            : 'bg-[#FF7A2F]/18 text-[#FF9E4F] ring-[#FF7A2F]/30'
                      }`}
                    >
                      {badgeCount}
                    </span>
                  )}

                  {collapsed && badgeCount > 0 && (
                    <span className="absolute top-1.5 right-2.5 h-2 w-2 rounded-full bg-[#FF7A2F] ring-2 ring-[#0D1016]" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom Dual Status Deck: Google Drive + qBittorrent */}
      <div className="space-y-2 border-t border-white/[0.055] p-2.5">
        {collapsed ? (
          <>
            <button
              type="button"
              onClick={() => onSelectSection('cloud')}
              title={
                cloudReady
                  ? activeCloudJobs > 0
                    ? `云盘传输中 (${activeCloudJobs})`
                    : 'Google Drive 已就绪'
                  : '配置 Google Drive'
              }
              className="flex h-10 w-full items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] transition hover:border-sky-400/35 hover:bg-sky-500/10"
            >
              <Cloud className={`h-4 w-4 ${cloudReady ? 'text-sky-400' : 'text-slate-500'}`} />
            </button>
            <button
              type="button"
              onClick={connected || qbStatus?.qbRunning ? () => onSelectSection('downloads') : onLaunchQb}
              disabled={!connected && !qbStatus?.qbRunning && launchingQb}
              title={
                connected
                  ? `qBittorrent 在线 · ${formatSpeed(totalDlSpeed)}`
                  : qbStatus?.qbRunning
                    ? 'qB WebUI 未连接'
                    : '点击启动 qBittorrent'
              }
              className="flex h-10 w-full items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] transition hover:border-[#FF7A2F]/40"
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  connected ? 'bg-[#22C55E] shadow-[0_0_8px_rgba(34,197,94,0.7)]' : 'bg-amber-400'
                }`}
              />
            </button>
          </>
        ) : (
          <>
            {/* Compact Google Drive Status Pill */}
            <button
              type="button"
              onClick={() => onSelectSection('cloud')}
              className="group flex w-full items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-[#12151C]/85 px-3 py-2 text-left transition hover:border-sky-400/35"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Cloud
                  className={`h-3.5 w-3.5 shrink-0 ${
                    cloudReady ? 'text-sky-400' : 'text-slate-500'
                  }`}
                />
                <span className="truncate text-[11.5px] font-medium text-slate-200">
                  {activeCloudJobs > 0
                    ? `云盘传输 (${activeCloudJobs})`
                    : cloudReady
                      ? '谷歌云盘就绪'
                      : '云盘未挂载'}
                </span>
              </div>
              <span className="shrink-0 text-[10.5px] text-slate-400 tabular-nums">
                {activeCloudJobs > 0 && cloudSpeed > 0
                  ? formatSpeed(cloudSpeed)
                  : cloudStatus?.freeBytes !== undefined
                    ? formatBytes(cloudStatus.freeBytes)
                    : '查看'}
              </span>
            </button>

            {/* qBittorrent Live Status */}
            {connected ? (
              <button
                type="button"
                onClick={() => onSelectSection('downloads')}
                className="group w-full rounded-xl border border-white/[0.07] bg-[#12151C] p-2.5 text-left transition hover:border-[#22C55E]/35 hover:bg-[#161A23]"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-55" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#22C55E]" />
                    </span>
                    <span className="truncate text-[12px] font-semibold text-slate-200">
                      qBittorrent 在线
                    </span>
                  </div>
                  {qbStatus?.version && (
                    <span className="shrink-0 font-mono text-[10px] text-slate-500">
                      {qbStatus.version.replace(/^v/i, 'v')}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-center justify-between border-t border-white/[0.05] pt-1.5 text-[11.5px]">
                  <span className="flex items-center gap-1 font-medium text-[#38BDF8] tabular-nums">
                    <ArrowDown className="h-3 w-3" />
                    {formatSpeed(totalDlSpeed)}
                  </span>
                  <span className="text-slate-400 tabular-nums">
                    {activeDownloads > 0 ? `${activeDownloads} 任务活跃` : '队列空闲'}
                  </span>
                </div>
              </button>
            ) : qbStatus?.qbRunning ? (
              <button
                type="button"
                onClick={() => onSelectSection('downloads')}
                className="sidebar-status-warn group w-full rounded-xl p-2.5 text-left transition hover:border-amber-400/55"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
                    <span className="text-[12px] font-semibold text-amber-200">WebUI 未连接</span>
                  </div>
                  <Settings className="h-3.5 w-3.5 text-amber-300 transition-transform group-hover:rotate-45" />
                </div>
                <div className="mt-1 text-[11px] text-slate-400">点击诊断端口或账号</div>
              </button>
            ) : (
              <button
                type="button"
                onClick={onLaunchQb}
                disabled={launchingQb}
                className="sidebar-status-mikan group w-full rounded-xl p-2.5 text-left transition hover:border-[#FF7A2F]/50 disabled:opacity-65"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
                    <span className="text-[12px] font-semibold text-amber-200">
                      {launchingQb ? '正在启动 qB...' : 'qB 未运行'}
                    </span>
                  </div>
                  {launchingQb ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FF7A2F]" />
                  ) : (
                    <Power className="h-3.5 w-3.5 text-[#FF7A2F] transition-transform group-hover:scale-110" />
                  )}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {launchingQb ? '等待 WebUI 就绪中...' : '点击一键启动本地客户端'}
                </div>
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
};

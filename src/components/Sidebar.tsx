import React from 'react';
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
} from 'lucide-react';
import type { QbConnectionStatus } from '@shared/types';
import { BrandLogo } from './BrandLogo';
import { formatSpeed } from '@/lib/format';

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
  activeSubscriptions: number;
  totalDlSpeed: number;
  launchingQb: boolean;
  onLaunchQb: () => void;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  sublabel: string;
  icon: React.FC<{ className?: string }>;
}> = [
  { id: 'discover', label: '番剧探索', sublabel: '本季放送', icon: Compass },
  { id: 'search', label: '搜番 / 老番', sublabel: '全站与历年库', icon: Search },
  { id: 'latest', label: '最新更新', sublabel: '蜜柑 RSS', icon: Rss },
  { id: 'subscriptions', label: '自动追更', sublabel: 'RSS 定时下载', icon: BellRing },
  { id: 'downloads', label: '下载队列', sublabel: 'qBittorrent', icon: Download },
  { id: 'cloud', label: '云盘上传', sublabel: 'Google Drive', icon: CloudUpload },
  { id: 'library', label: '我的媒体库', sublabel: '本地番剧', icon: Film },
  { id: 'settings', label: '偏好设置', sublabel: '客户端配置', icon: Settings },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSelectSection,
  qbStatus,
  activeDownloads,
  activeCloudJobs = 0,
  activeSubscriptions,
  totalDlSpeed,
  launchingQb,
  onLaunchQb,
}) => {
  const connected = Boolean(qbStatus?.connected);

  return (
    <aside className="flex h-full w-[228px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0D1016]/95 select-none">
      {/* Frameless top drag spacer + Brand Mark */}
      <div className="titlebar-drag flex h-[54px] items-center gap-3 border-b border-white/[0.055] px-4">
        <BrandLogo size={30} className="shrink-0 drop-shadow-[0_4px_12px_rgba(255,122,47,0.32)]" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[14.5px] font-bold tracking-tight text-white">MikanVault</span>
          </div>
          <div className="text-[10px] font-medium tracking-[0.14em] text-slate-500">
            ANIME VAULT · 蜜柑
          </div>
        </div>
      </div>

      {/* Primary Navigation */}
      <nav className="mt-3 flex-1 space-y-1 px-3" aria-label="主导航">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSection(item.id)}
              className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-150 ${
                isActive
                  ? 'bg-gradient-to-r from-[#FF7A2F]/16 via-[#FF7A2F]/8 to-transparent text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                  : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
              }`}
            >
              {/* Active Tangerine Pill Indicator */}
              {isActive && (
                <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-gradient-to-b from-[#FF9E4F] to-[#FF7A2F] shadow-[0_0_10px_rgba(255,122,47,0.8)]" />
              )}

              <Icon
                className={`h-[18px] w-[18px] shrink-0 transition-colors ${
                  isActive ? 'text-[#FF7A2F]' : 'text-slate-500 group-hover:text-slate-300'
                }`}
              />
              <span className="flex-1 truncate text-[13.5px] font-medium">{item.label}</span>

              {item.id === 'downloads' && activeDownloads > 0 && (
                <span className="tabular-nums rounded-full bg-[#38BDF8]/18 px-2 py-0.5 text-[11px] font-semibold text-[#38BDF8] ring-1 ring-[#38BDF8]/30">
                  {activeDownloads}
                </span>
              )}

              {item.id === 'cloud' && activeCloudJobs > 0 && (
                <span className="tabular-nums rounded-full bg-sky-500/20 px-2 py-0.5 text-[11px] font-semibold text-sky-300 ring-1 ring-sky-400/35">
                  {activeCloudJobs}
                </span>
              )}

              {item.id === 'subscriptions' && activeSubscriptions > 0 && (
                <span className="tabular-nums rounded-full bg-[#FF7A2F]/18 px-2 py-0.5 text-[11px] font-semibold text-[#FF9E4F] ring-1 ring-[#FF7A2F]/30">
                  {activeSubscriptions}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom qBittorrent Live Status Widget */}
      <div className="p-3">
        {connected ? (
          <button
            type="button"
            onClick={() => onSelectSection('downloads')}
            className="group w-full rounded-xl border border-white/[0.07] bg-[#12151C] p-3 text-left transition hover:border-[#22C55E]/30 hover:bg-[#161A23]"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-55" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#22C55E]" />
                </span>
                <span className="truncate text-[12px] font-semibold text-slate-200">
                  qBittorrent 在线
                </span>
              </div>
              {qbStatus?.version && (
                <span className="shrink-0 text-[10px] font-mono text-slate-500">
                  {qbStatus.version.replace(/^v/i, 'v')}
                </span>
              )}
            </div>

            <div className="mt-2 flex items-center justify-between border-t border-white/[0.05] pt-2 text-[11.5px]">
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
            className="group w-full rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-500/14 to-[#12151C] p-3 text-left transition hover:border-amber-400/55 hover:from-amber-500/20"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
                <span className="text-[12px] font-semibold text-amber-200">
                  WebUI 未连接
                </span>
              </div>
              <Settings className="h-3.5 w-3.5 text-amber-300 transition-transform group-hover:rotate-45" />
            </div>
            <div className="mt-1.5 text-[11px] text-slate-400 group-hover:text-slate-300">
              点击查看诊断或修改端口/密码
            </div>
          </button>
        ) : (
          <button
            type="button"
            onClick={onLaunchQb}
            disabled={launchingQb}
            className="group w-full rounded-xl border border-[#FF7A2F]/25 bg-gradient-to-br from-[#FF7A2F]/12 to-[#12151C] p-3 text-left transition hover:border-[#FF7A2F]/50 hover:from-[#FF7A2F]/18 disabled:opacity-65"
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
            <div className="mt-1.5 text-[11px] text-slate-400 group-hover:text-slate-300">
              {launchingQb ? '等待 WebUI 就绪中...' : '点击一键启动本地客户端'}
            </div>
          </button>
        )}
      </div>
    </aside>
  );
};

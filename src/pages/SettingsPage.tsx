import React, { useEffect, useState } from 'react';
import {
  Globe,
  Download,
  FolderOpen,
  MonitorPlay,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Power,
  Plus,
  Trash2,
  Save,
  Loader2,
  PlugZap,
  RotateCcw,
  BellRing,
  Cloud,
  Bot,
  Copy,
  Monitor,
  Moon,
  Palette,
  Sun,
} from 'lucide-react';
import type {
  AppSettings,
  CloudDriveStatus,
  McpServerInfo,
  QbConnectionStatus,
  ResolvedTheme,
  ThemeMode,
} from '@shared/types';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useToast } from '@/hooks/useToast';

interface SettingsPageProps {
  settings: AppSettings | null;
  onSettingsUpdated: (updated: AppSettings) => void;
  onRefreshQb: () => Promise<void>;
  onLaunchQb: () => Promise<{ ok: boolean; error?: string }>;
  launchingQb: boolean;
  themeMode?: ThemeMode;
  resolvedTheme?: ResolvedTheme;
  onChangeThemeMode?: (mode: ThemeMode) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  onSettingsUpdated,
  onRefreshQb,
  onLaunchQb,
  launchingQb,
  themeMode = 'dark',
  resolvedTheme = 'dark',
  onChangeThemeMode,
}) => {
  const { pushToast } = useToast();
  const [form, setForm] = useState<AppSettings | null>(settings);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<QbConnectionStatus | null>(null);
  const [cloudStatus, setCloudStatus] = useState<CloudDriveStatus | null>(null);
  const [mcpInfo, setMcpInfo] = useState<McpServerInfo | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    void api
      .cloudGetStatus()
      .then(setCloudStatus)
      .catch(() => {});
    void api
      .mcpGetInfo()
      .then(setMcpInfo)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (settings && !dirty) {
      setForm(settings);
    }
  }, [settings, dirty]);

  if (!form) {
    return (
      <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer h-40 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const updated = await api.settingsUpdate(form);
      setForm(updated);
      setDirty(false);
      onSettingsUpdated(updated);
      await onRefreshQb();
      pushToast({
        kind: 'success',
        title: '偏好设置已保存',
        description: '新配置已立即生效',
      });
    } catch (err) {
      pushToast({
        kind: 'error',
        title: '保存设置失败',
        description: err instanceof Error ? err.message : '未知错误',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await api.qbTestConnection({
        qbUrl: form.qbUrl,
        qbUsername: form.qbUsername,
        qbPassword: form.qbPassword,
        qbExePath: form.qbExePath,
      });
      setTestResult(res);
      if (res.connected) {
        pushToast({
          kind: 'success',
          title: 'qBittorrent 连接成功',
          description: res.version ? `客户端版本 ${res.version}` : 'WebUI 通信正常',
        });
      } else {
        pushToast({
          kind: 'error',
          title: '无法连接到 qBittorrent',
          description: res.error || '请检查地址、账号密码或先启动客户端',
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const handlePickQbExe = async () => {
    const picked = await api.dialogPickExecutable();
    if (picked) updateField('qbExePath', picked);
  };

  const handlePickDownloadRoot = async () => {
    const picked = await api.dialogPickFolder();
    if (picked) updateField('downloadRootDir', picked);
  };

  const handleAddExtraDir = async () => {
    const picked = await api.dialogPickFolder();
    if (!picked) return;
    if (form.extraLibraryDirs.includes(picked)) {
      pushToast({ kind: 'info', title: '该目录已在扫描列表中' });
      return;
    }
    updateField('extraLibraryDirs', [...form.extraLibraryDirs, picked]);
  };

  const handleRemoveExtraDir = (dir: string) => {
    updateField(
      'extraLibraryDirs',
      form.extraLibraryDirs.filter((d) => d !== dir)
    );
  };

  const handlePickCustomPlayer = async () => {
    const picked = await api.dialogPickExecutable();
    if (picked) updateField('customPlayerPath', picked);
  };

  const handlePickCloudDir = async () => {
    const picked = await api.dialogPickFolder();
    if (picked) updateField('googleDriveDir', picked);
  };

  const handleRefreshCloud = async () => {
    const status = await api.cloudGetStatus();
    setCloudStatus(status);
    if (!form?.googleDriveDir && status.defaultTargetDir) {
      updateField('googleDriveDir', status.defaultTargetDir);
      updateField('googleDriveEnabled', true);
    }
  };

  return (
    <div className="mx-auto max-w-[880px] space-y-6 px-6 py-6 pb-20">
      {/* Header + Save Button */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-bold tracking-tight text-white">偏好设置</h2>
          <p className="mt-0.5 text-[12.5px] text-slate-400">
            配置蜜柑计划站点源、qBittorrent 连接参数、媒体库路径与本地播放器
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !dirty}
          className="btn-mikan inline-flex h-10 items-center gap-2 rounded-xl px-5 text-[13px]"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              保存中...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              {dirty ? '保存更改' : '已保存'}
            </>
          )}
        </button>
      </div>

      {/* Section 0: Theme & Appearance */}
      {onChangeThemeMode && (
        <section className="card-elevated rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FF7A2F]/14 text-[#FF7A2F]">
                <Palette className="h-4.5 w-4.5" />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-white">外观与主题</h3>
                <p className="text-[12px] text-slate-400">
                  支持暗夜影院与霜白浅色即时切换（当前生效：{resolvedTheme === 'light' ? '浅色' : '暗色'}）
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(
              [
                {
                  id: 'dark' as ThemeMode,
                  title: '暗夜影院',
                  desc: '深邃黑曜石画布，沉浸式海报对比度',
                  Icon: Moon,
                  previewBg: 'bg-[#090B10] border-white/15',
                  previewCard: 'bg-[#151A24] border-white/10',
                },
                {
                  id: 'light' as ThemeMode,
                  title: '霜白浅色',
                  desc: '通透磨砂日光质感，日间阅读更轻松',
                  Icon: Sun,
                  previewBg: 'bg-[#F3F5FA] border-slate-300',
                  previewCard: 'bg-white border-slate-200',
                },
                {
                  id: 'system' as ThemeMode,
                  title: '跟随系统',
                  desc: '自动匹配 Windows 深浅色外观设置',
                  Icon: Monitor,
                  previewBg: 'bg-gradient-to-br from-[#090B10] via-[#1B2230] to-[#F3F5FA] border-white/20',
                  previewCard: 'bg-white/20 border-white/25',
                },
              ] as const
            ).map(({ id, title, desc, Icon, previewBg, previewCard }) => {
              const active = themeMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChangeThemeMode(id)}
                  className={`flex flex-col gap-3 rounded-xl border p-3.5 text-left transition ${
                    active
                      ? 'border-[#FF7A2F]/65 bg-[#FF7A2F]/[0.1] ring-1 ring-[#FF7A2F]/35'
                      : 'border-white/[0.08] bg-[#0B0D11]/55 hover:border-white/[0.16]'
                  }`}
                >
                  <div className={`flex h-12 w-full items-center gap-2 rounded-lg border px-2.5 ${previewBg}`}>
                    <div className="h-7 w-5 rounded bg-[#FF7A2F]/85" />
                    <div className={`h-7 flex-1 rounded border ${previewCard}`} />
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white">
                        <Icon className="h-3.5 w-3.5 text-[#FF9E4F]" />
                        {title}
                      </span>
                      {active && (
                        <span className="rounded-full bg-[#FF7A2F] px-2 py-0.5 text-[10px] font-bold text-[#0B0D11]">
                          使用中
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400">{desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 1: Mikan Source */}
      <section className="card-elevated rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FF7A2F]/14 text-[#FF7A2F]">
            <Globe className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-white">蜜柑计划源</h3>
            <p className="text-[12px] text-slate-400">用于抓取当季放送表、字幕组资源与 RSS 订阅</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="mikan-base-url" className="text-[12.5px] font-medium text-slate-300">
              站点基础地址 (Base URL)
            </label>
            {form.mikanBaseUrl !== 'https://mikanani.kas.pub' && (
              <button
                type="button"
                onClick={() => updateField('mikanBaseUrl', 'https://mikanani.kas.pub')}
                className="inline-flex items-center gap-1 text-[11.5px] text-[#FF9E4F] hover:underline"
              >
                <RotateCcw className="h-3 w-3" />
                恢复默认镜像
              </button>
            )}
          </div>
          <input
            id="mikan-base-url"
            type="text"
            value={form.mikanBaseUrl}
            onChange={(e) => updateField('mikanBaseUrl', e.target.value)}
            placeholder="https://mikanani.kas.pub"
            className="input-cinema h-10 w-full rounded-xl px-3.5 font-mono text-[13px]"
          />
        </div>
      </section>

      {/* Section 2: qBittorrent */}
      <section className="card-elevated rounded-2xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#38BDF8]/14 text-[#38BDF8]">
              <Download className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-white">qBittorrent 连接</h3>
              <p className="text-[12px] text-slate-400">
                通过本地 WebUI 自动推送种子并监控实时下载速度
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleTestConnection()}
              disabled={testing}
              className="btn-ghost-dark inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium"
            >
              {testing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#38BDF8]" />
              ) : (
                <PlugZap className="h-3.5 w-3.5 text-[#38BDF8]" />
              )}
              测试连接
            </button>
            <button
              type="button"
              onClick={() => void onLaunchQb()}
              disabled={launchingQb}
              className="btn-ghost-dark inline-flex h-9 items-center gap-1.5 rounded-xl border-[#FF7A2F]/30 bg-[#FF7A2F]/10 px-3.5 text-[12.5px] font-medium text-[#FF9E4F] hover:bg-[#FF7A2F]/18"
            >
              {launchingQb ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Power className="h-3.5 w-3.5" />
              )}
              启动 qBittorrent
            </button>
          </div>
        </div>

        {testResult && (
          <div
            className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] ${
              testResult.connected
                ? 'border-[#22C55E]/25 bg-[#22C55E]/10 text-emerald-200'
                : 'border-amber-400/25 bg-amber-500/10 text-amber-200'
            }`}
          >
            {testResult.connected ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#22C55E]" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            )}
            <span>
              {testResult.connected
                ? `连接正常 · qBittorrent ${testResult.version || ''}`
                : testResult.error || '连接失败，请确认 WebUI 已启用且凭据正确'}
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="qb-url" className="text-[12.5px] font-medium text-slate-300">
              WebUI 地址
            </label>
            <input
              id="qb-url"
              type="text"
              value={form.qbUrl}
              onChange={(e) => updateField('qbUrl', e.target.value)}
              placeholder="http://127.0.0.1:8080"
              className="input-cinema h-10 w-full rounded-xl px-3.5 font-mono text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="qb-category" className="text-[12.5px] font-medium text-slate-300">
              默认分类
            </label>
            <input
              id="qb-category"
              type="text"
              value={form.qbCategory}
              onChange={(e) => updateField('qbCategory', e.target.value)}
              placeholder="mikan"
              className="input-cinema h-10 w-full rounded-xl px-3.5 text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="qb-username" className="text-[12.5px] font-medium text-slate-300">
              用户名
            </label>
            <input
              id="qb-username"
              type="text"
              value={form.qbUsername}
              onChange={(e) => updateField('qbUsername', e.target.value)}
              placeholder="admin"
              className="input-cinema h-10 w-full rounded-xl px-3.5 text-[13px]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="qb-password" className="text-[12.5px] font-medium text-slate-300">
              密码
            </label>
            <div className="relative">
              <input
                id="qb-password"
                type={showPassword ? 'text' : 'password'}
                value={form.qbPassword}
                onChange={(e) => updateField('qbPassword', e.target.value)}
                placeholder="如开启本地免密可留空"
                className="input-cinema h-10 w-full rounded-xl pr-10 pl-3.5 text-[13px]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:text-white"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="qb-exe-path" className="text-[12.5px] font-medium text-slate-300">
            本地 qbittorrent.exe 路径
          </label>
          <div className="flex gap-2">
            <input
              id="qb-exe-path"
              type="text"
              value={form.qbExePath}
              onChange={(e) => updateField('qbExePath', e.target.value)}
              placeholder="D:\Files\qBittorrent\qbittorrent.exe"
              className="input-cinema h-10 flex-1 rounded-xl px-3.5 font-mono text-[12.5px]"
            />
            <button
              type="button"
              onClick={() => void handlePickQbExe()}
              className="btn-ghost-dark inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium"
            >
              <FolderOpen className="h-4 w-4 text-slate-400" />
              选择程序
            </button>
          </div>
        </div>
      </section>

      {/* Section 3: Media Library Directories */}
      <section className="card-elevated rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#22C55E]/14 text-[#22C55E]">
            <FolderOpen className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-white">媒体库目录</h3>
            <p className="text-[12px] text-slate-400">
              默认番剧下载根目录与额外需要扫描的本地动漫文件夹
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="download-root-dir" className="text-[12.5px] font-medium text-slate-300">
            默认番剧下载目录
          </label>
          <div className="flex gap-2">
            <input
              id="download-root-dir"
              type="text"
              value={form.downloadRootDir}
              onChange={(e) => updateField('downloadRootDir', e.target.value)}
              placeholder="D:\Anime"
              className="input-cinema h-10 flex-1 rounded-xl px-3.5 font-mono text-[12.5px]"
            />
            <button
              type="button"
              onClick={() => void handlePickDownloadRoot()}
              className="btn-ghost-dark inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium"
            >
              <FolderOpen className="h-4 w-4 text-slate-400" />
              选择目录
            </button>
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-slate-300">额外媒体库扫描目录</span>
            <button
              type="button"
              onClick={() => void handleAddExtraDir()}
              className="btn-ghost-dark inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium"
            >
              <Plus className="h-3.5 w-3.5 text-[#FF7A2F]" />
              添加目录
            </button>
          </div>

          {form.extraLibraryDirs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.08] bg-[#0B0D11]/40 px-4 py-4 text-center text-[12px] text-slate-500">
              暂无额外扫描目录，默认仅扫描下载根目录
            </div>
          ) : (
            <div className="space-y-2">
              {form.extraLibraryDirs.map((dir) => (
                <div
                  key={dir}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-[#0B0D11]/65 px-3.5 py-2.5"
                >
                  <span className="truncate font-mono text-[12.5px] text-slate-300">{dir}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveExtraDir(dir)}
                    className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-300"
                    aria-label={`移除目录 ${dir}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Section 4: Local Video Player */}
      <section className="card-elevated rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/14 text-amber-300">
            <MonitorPlay className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-white">本地播放器</h3>
            <p className="text-[12px] text-slate-400">
              直接调用原画质本地播放器打开 MKV / MP4（完整支持内封 ASS 字幕与硬解）
            </p>
          </div>
        </div>

        {/* Segmented Control */}
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/[0.07] bg-[#0B0D11]/70 p-1.5">
          <button
            type="button"
            onClick={() => updateField('playerMode', 'system')}
            className={`rounded-lg py-2.5 text-[13px] font-medium transition ${
              form.playerMode === 'system'
                ? 'bg-[#FF7A2F] text-[#0B0D11] font-semibold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            系统默认播放器
          </button>
          <button
            type="button"
            onClick={() => updateField('playerMode', 'custom')}
            className={`rounded-lg py-2.5 text-[13px] font-medium transition ${
              form.playerMode === 'custom'
                ? 'bg-[#FF7A2F] text-[#0B0D11] font-semibold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            指定播放器 (PotPlayer / MPV / VLC)
          </button>
        </div>

        {form.playerMode === 'custom' && (
          <div className="space-y-1.5">
            <label htmlFor="custom-player-path" className="text-[12.5px] font-medium text-slate-300">
              播放器可执行文件路径
            </label>
            <div className="flex gap-2">
              <input
                id="custom-player-path"
                type="text"
                value={form.customPlayerPath}
                onChange={(e) => updateField('customPlayerPath', e.target.value)}
                placeholder="例如 C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe"
                className="input-cinema h-10 flex-1 rounded-xl px-3.5 font-mono text-[12.5px]"
              />
              <button
                type="button"
                onClick={() => void handlePickCustomPlayer()}
                className="btn-ghost-dark inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium"
              >
                <FolderOpen className="h-4 w-4 text-slate-400" />
                选择播放器
              </button>
            </div>
          </div>
        )}
      </section>
      {/* Section 5: Auto Subscriptions */}
      <section className="card-elevated rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FF7A2F]/14 text-[#FF7A2F]">
            <BellRing className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-white">自动追更订阅</h3>
            <p className="text-[12px] text-slate-400">
              配置后台轮询蜜柑 RSS 的频率，以及检测到新剧集时是否自动拉起本地 qBittorrent
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="sub-interval-min" className="text-[12.5px] font-medium text-slate-300">
              RSS 自动检查间隔（分钟）
            </label>
            <select
              id="sub-interval-min"
              value={form.subscriptionCheckIntervalMin}
              onChange={(e) => updateField('subscriptionCheckIntervalMin', Number(e.target.value))}
              className="input-cinema h-10 w-full rounded-xl px-3.5 text-[13px]"
            >
              {[5, 10, 15, 30, 60].map((m) => (
                <option key={m} value={m} className="bg-[#12151C] text-slate-100">
                  每 {m} 分钟检查一次
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#0B0D11]/60 px-3.5 py-2.5 text-[12.5px] text-slate-200 transition hover:border-[#FF7A2F]/35">
              <input
                type="checkbox"
                checked={form.subscriptionAutoLaunchQb}
                onChange={(e) => updateField('subscriptionAutoLaunchQb', e.target.checked)}
                className="h-4 w-4 rounded border-white/20 accent-[#FF7A2F]"
              />
              <span>发现新集且 qB 未运行时自动启动 qBittorrent</span>
            </label>
          </div>
        </div>
      </section>

      {/* Section 6: Google Drive Cloud Offload */}
      <section className="card-elevated rounded-2xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
              <Cloud className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-white">谷歌云盘 (Google Drive) 自动转存</h3>
              <p className="text-[12px] text-slate-400">
                下载完成后自动复制到 Google Drive 挂载盘并清理本地磁盘空间
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleRefreshCloud()}
            className="btn-ghost-dark inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium"
          >
            <RotateCcw className="h-3.5 w-3.5 text-sky-400" />
            重新检测挂载盘
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-[#0B0D11]/65 px-4 py-3 text-[12px]">
          <div className="flex items-center gap-2">
            {cloudStatus?.detected ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-emerald-200 font-medium">
                  已检测到 Google Drive 挂载：{cloudStatus.mountRoot}
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span className="text-amber-200">
                  未检测到 Google Drive Desktop 挂载盘，也可手动指定云同步目录
                </span>
              </>
            )}
          </div>
          {cloudStatus?.freeBytes !== undefined && (
            <span className="tabular-nums text-sky-300 font-medium">
              剩余可用空间 {formatBytes(cloudStatus.freeBytes)}
            </span>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="google-drive-dir" className="text-[12.5px] font-medium text-slate-300">
            云盘番剧根目录
          </label>
          <div className="flex gap-2">
            <input
              id="google-drive-dir"
              type="text"
              value={form.googleDriveDir}
              onChange={(e) => updateField('googleDriveDir', e.target.value)}
              placeholder={cloudStatus?.defaultTargetDir || '例如 J:\\我的云端硬盘\\MikanVault'}
              className="input-cinema h-10 flex-1 rounded-xl px-3.5 font-mono text-[12.5px]"
            />
            <button
              type="button"
              onClick={() => void handlePickCloudDir()}
              className="btn-ghost-dark inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-[12.5px] font-medium"
            >
              <FolderOpen className="h-4 w-4 text-slate-400" />
              选择目录
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#0B0D11]/60 px-3.5 py-2.5 text-[12.5px] text-slate-200 transition hover:border-sky-400/35">
            <input
              type="checkbox"
              checked={form.googleDriveAutoDeleteLocal}
              onChange={(e) => updateField('googleDriveAutoDeleteLocal', e.target.checked)}
              className="h-4 w-4 rounded border-white/20 accent-sky-400"
            />
            <span>转存校验成功后自动删除本地文件</span>
          </label>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#0B0D11]/60 px-3.5 py-2.5 text-[12.5px] text-slate-200 transition hover:border-sky-400/35">
            <input
              type="checkbox"
              checked={form.googleDriveIncludeInLibrary}
              onChange={(e) => updateField('googleDriveIncludeInLibrary', e.target.checked)}
              className="h-4 w-4 rounded border-white/20 accent-sky-400"
            />
            <span>媒体库自动扫描谷歌云盘目录并标记云端徽章</span>
          </label>
        </div>
      </section>

      {/* Section 7: Built-in MCP AI Assistant */}
      <section className="card-elevated rounded-2xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
              <Bot className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-white">内置 MCP AI 助手（Agent 接入）</h3>
              <p className="text-[12px] text-slate-400">
                标准 stdio MCP Server，让外部 AI Agent 自动找番、推 qB 下载、管理追更及上传谷歌云盘
              </p>
            </div>
          </div>

          {mcpInfo && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-medium ${
                mcpInfo.exists
                  ? 'border-emerald-400/30 bg-emerald-500/12 text-emerald-300'
                  : 'border-amber-400/30 bg-amber-500/12 text-amber-200'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {mcpInfo.exists ? 'MCP 服务已内置就绪' : '未编译 MCP 服务（请运行 npm run build:mcp）'}
            </span>
          )}
        </div>

        {mcpInfo && (
          <>
            <div className="space-y-2 rounded-xl border border-white/[0.07] bg-[#0B0D11]/65 p-4 text-[12px]">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-slate-400">MCP 服务入口脚本</span>
                <span className="truncate font-mono text-[11.5px] text-violet-200">
                  {mcpInfo.entryPath}
                </span>
              </div>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-slate-400">与桌面端共享的数据目录</span>
                <span className="truncate font-mono text-[11.5px] text-slate-300">
                  {mcpInfo.dataDir}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-slate-300">
                  MCP 客户端配置 JSON（适用于 Antigravity / Claude Desktop / Cursor / Windsurf）
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const dir = mcpInfo.entryPath.replace(/[\\/][^\\/]+$/, '');
                      void api.libraryOpenFolder(dir);
                    }}
                    className="btn-ghost-dark inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px]"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-slate-400" />
                    打开 MCP 目录
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(mcpInfo.configJson).then(() => {
                        pushToast({
                          kind: 'success',
                          title: '已复制 MCP 配置 JSON',
                          description: '可直接粘贴到你的 AI 客户端 MCP 配置文件中',
                        });
                      });
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-violet-500/20 px-3 text-[12px] font-semibold text-violet-200 ring-1 ring-violet-400/35 transition hover:bg-violet-500/30"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    一键复制配置
                  </button>
                </div>
              </div>
              <pre className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#080A0E] p-3.5 font-mono text-[11.5px] leading-relaxed text-slate-300">
                {mcpInfo.configJson}
              </pre>
            </div>
          </>
        )}
      </section>
    </div>
  );
};

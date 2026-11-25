export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes) || bytes < 0) {
    return '—';
  }
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number | undefined | null): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null || seconds < 0 || seconds >= 8640000) {
    return '∞';
  }
  if (seconds === 0) return '已完成';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function formatRelativeDate(input: string | number | undefined): string {
  if (!input) return '—';
  const date = typeof input === 'number'
    ? new Date(input > 1e12 ? input : input * 1000)
    : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return typeof input === 'string' ? input : '—';
  }
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const nowYear = new Date().getFullYear();
  return y === nowYear ? `${mo}-${d}` : `${y}-${mo}-${d}`;
}

export function sanitizeFolderName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function joinSavePath(rootDir: string, folderName?: string): string {
  const cleanRoot = (rootDir || '').replace(/[\\/]+$/, '');
  const cleanFolder = folderName ? sanitizeFolderName(folderName) : '';
  const normalizedRoot = /^[a-zA-Z]:$/.test(cleanRoot) ? `${cleanRoot}\\` : cleanRoot;
  if (!normalizedRoot) return cleanFolder;
  if (!cleanFolder) return normalizedRoot;
  const sep = cleanRoot.includes('\\') || /^[a-zA-Z]:/.test(cleanRoot) ? '\\' : '/';
  return `${cleanRoot}${sep}${cleanFolder}`;
}

export function deriveSeriesFolderNameFromTitle(rawTitle: string): string {
  if (!rawTitle?.trim()) return '';
  let name = rawTitle.trim();
  // Strip leading subgroup tag [Subgroup] or 【Subgroup】
  name = name.replace(/^[\[【][^\]】]+[\]】]\s*/, '');
  // Cut at episode / quality / release metadata boundaries
  name = name
    .replace(/\s+-\s+\d{1,4}(?:\.\d)?(?:v\d)?.*$/i, '')
    .replace(/\s*(?:S\d{1,2})?(?:EP|E)\d{1,4}.*$/i, '')
    .replace(/\s*第\s*\d{1,4}\s*[话話集回].*$/, '')
    .replace(/\s*[\[【]\d{1,4}(?:v\d)?(?:-\d{1,4})?[\]】].*$/i, '')
    .replace(/\s*[\[【](?:1080P|720P|4K|2160P|BDRip|WebRip|WEB-DL|HEVC|AVC|简|繁|正片).*$/i, '');
  // Unwrap bracketed title like [名侦探柯南]
  name = name.trim().replace(/^[\[【]([^\]】]+)[\]】]$/, '$1');
  // Take primary title before bilingual slash separator
  if (name.includes('/')) {
    const primary = name.split('/')[0].trim();
    if (primary) name = primary;
  }
  return sanitizeFolderName(name.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim());
}

export function extractReleaseTags(title: string, existingTags: string[] = []): string[] {
  const found = new Set<string>(existingTags.filter(Boolean));
  const patterns: Array<[RegExp, string]> = [
    [/\b(2160p|4K|UHD)\b/i, '4K'],
    [/\b1080p\b/i, '1080P'],
    [/\b720p\b/i, '720P'],
    [/\b(HEVC|x265|H\.?265)\b/i, 'HEVC'],
    [/\b(AVC|x264|H\.?264)\b/i, 'AVC'],
    [/\b10-?bit\b/i, '10bit'],
    [/\b(BDRip|BD-?Remux|Blu-?Ray)\b/i, 'BDRip'],
    [/\b(WebRip|WEB-?DL)\b/i, 'WebRip'],
    [/(简繁日内封|简繁内封|简繁中字|简繁)/i, '简繁'],
    [/(简日双语|简日内嵌|简日)/i, '简日'],
    [/(繁日双语|繁日内嵌|繁日)/i, '繁日'],
    [/(简体|简中|CHS)/i, '简中'],
    [/(繁体|繁中|CHT)/i, '繁中'],
  ];

  for (const [regex, label] of patterns) {
    if (regex.test(title)) {
      found.add(label);
    }
  }

  // Avoid duplicate redundant Chinese subtitle tags
  if (found.has('简繁')) {
    found.delete('简中');
    found.delete('繁中');
  }
  if (found.has('简日')) {
    found.delete('简中');
  }
  if (found.has('繁日')) {
    found.delete('繁中');
  }

  return Array.from(found).slice(0, 5);
}

export type TorrentVisualCategory = 'downloading' | 'completed' | 'paused' | 'queued' | 'error';

export interface TorrentStateMeta {
  label: string;
  category: TorrentVisualCategory;
  isPaused: boolean;
}

export function getTorrentStateMeta(state: string): TorrentStateMeta {
  const s = (state || '').toLowerCase();
  switch (s) {
    case 'downloading':
    case 'forceddl':
      return { label: '下载中', category: 'downloading', isPaused: false };
    case 'metadl':
      return { label: '获取元数据', category: 'downloading', isPaused: false };
    case 'stalleddl':
      return { label: '等待做种', category: 'downloading', isPaused: false };
    case 'allocating':
    case 'checkingdl':
    case 'checkingup':
    case 'checkingresumedata':
    case 'moving':
      return { label: '校验中', category: 'queued', isPaused: false };
    case 'queueddl':
    case 'queuedup':
      return { label: '排队中', category: 'queued', isPaused: false };
    case 'uploading':
    case 'forcedup':
      return { label: '做种中', category: 'completed', isPaused: false };
    case 'stalledup':
      return { label: '已完成', category: 'completed', isPaused: false };
    case 'pauseddl':
    case 'stoppeddl':
      return { label: '已暂停', category: 'paused', isPaused: true };
    case 'pausedup':
    case 'stoppedup':
      return { label: '已完成', category: 'completed', isPaused: true };
    case 'error':
    case 'missingfiles':
      return { label: '错误', category: 'error', isPaused: true };
    default:
      return { label: state || '未知', category: 'queued', isPaused: false };
  }
}

export function formatEpisodeLabel(epNum?: number): string {
  if (epNum === undefined || epNum === null || Number.isNaN(epNum)) return 'SP';
  if (Number.isInteger(epNum)) {
    return `EP ${String(epNum).padStart(2, '0')}`;
  }
  return `EP ${epNum}`;
}

export function parseSizeTextToBytes(sizeText?: string): number {
  if (!sizeText) return 0;
  const match = sizeText.trim().match(/([\d.]+)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB)/i);
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    KIB: 1024,
    MB: 1024 ** 2,
    MIB: 1024 ** 2,
    GB: 1024 ** 3,
    GIB: 1024 ** 3,
    TB: 1024 ** 4,
    TIB: 1024 ** 4,
  };
  return Math.round(value * (multipliers[unit] ?? 1));
}

function isLikelyFalseEpNumber(num: number): boolean {
  if (!Number.isFinite(num) || num < 0) return true;
  if (num === 480 || num === 720 || num === 1080 || num === 2160 || num === 264 || num === 265) {
    return true;
  }
  if (num >= 1980 && num <= 2099) return true;
  return false;
}

export function parseEpisodeNumberFromTitle(title: string): number | undefined {
  if (!title?.trim()) return undefined;
  const cnMatch = title.match(/第\s*(\d{1,4}(?:\.\d)?)\s*[话話集回]/);
  if (cnMatch) {
    const val = Number.parseFloat(cnMatch[1]);
    if (!isLikelyFalseEpNumber(val)) return val;
  }
  const seMatch = title.match(/(?:^|[\s._\-\[\(])(?:S\d{1,2})?(?:EP|E)\s*(\d{1,4}(?:\.\d)?)(?!\d)/i);
  if (seMatch) {
    const val = Number.parseFloat(seMatch[1]);
    if (!isLikelyFalseEpNumber(val)) return val;
  }
  const dashMatch = title.match(/\s-\s(\d{1,4}(?:\.\d)?)(?:v\d)?(?=$|[\s\[\(._\-]|END)/i);
  if (dashMatch) {
    const val = Number.parseFloat(dashMatch[1]);
    if (!isLikelyFalseEpNumber(val)) return val;
  }
  const bracketRegex = /[\[【](\d{1,4}(?:\.\d)?)(?:v\d)?[\]】]/gi;
  let bMatch: RegExpExecArray | null;
  while ((bMatch = bracketRegex.exec(title)) !== null) {
    const val = Number.parseFloat(bMatch[1]);
    if (!isLikelyFalseEpNumber(val)) return val;
  }
  const hashMatch = title.match(/#(\d{1,4}(?:\.\d)?)(?!\d)/);
  if (hashMatch) {
    const val = Number.parseFloat(hashMatch[1]);
    if (!isLikelyFalseEpNumber(val)) return val;
  }
  return undefined;
}

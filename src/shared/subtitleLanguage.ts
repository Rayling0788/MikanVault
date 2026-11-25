import type { SubtitleLanguageFilter } from './types';

export interface SubtitleLanguageOption {
  id: SubtitleLanguageFilter;
  label: string;
  shortLabel: string;
  description: string;
}

export const SUBTITLE_LANGUAGE_OPTIONS: readonly SubtitleLanguageOption[] = [
  {
    id: 'all',
    label: '全部语言',
    shortLabel: '全部',
    description: '不过滤字幕语言，保留字幕组发布的全部版本',
  },
  {
    id: 'chs',
    label: '简体中文（含简日/简繁）',
    shortLabel: '简中',
    description: '匹配简体、简中、简日、简繁内封及 CHS/GB/SC 等版本',
  },
  {
    id: 'cht',
    label: '繁体中文（含繁日/简繁）',
    shortLabel: '繁中',
    description: '匹配繁体、繁中、繁日、简繁内封及 CHT/BIG5/TC 等版本',
  },
  {
    id: 'bilingual',
    label: '简繁双语 / 多语内封',
    shortLabel: '简繁双语',
    description: '仅匹配同时包含简繁双语或简繁内封的版本',
  },
  {
    id: 'chs_jp',
    label: '仅简日双语',
    shortLabel: '简日双语',
    description: '仅匹配简日双语 / 简日内嵌（JPSC / CHS_JP）版本',
  },
  {
    id: 'cht_jp',
    label: '仅繁日双语',
    shortLabel: '繁日双语',
    description: '仅匹配繁日双语 / 繁日内嵌（JPTC / CHT_JP）版本',
  },
  {
    id: 'raw',
    label: '日语 / 生肉 / 无字幕',
    shortLabel: '日语/生肉',
    description: '匹配无中文字幕的生肉（RAW / 无字幕 / 仅日语）版本',
  },
] as const;

export function getSubtitleLanguageLabel(filter?: SubtitleLanguageFilter): string {
  if (!filter || filter === 'all') return '全部语言';
  const found = SUBTITLE_LANGUAGE_OPTIONS.find((o) => o.id === filter);
  return found?.shortLabel || found?.label || filter;
}

export interface DetectedSubtitleLanguage {
  isBilingual: boolean;
  isChsJp: boolean;
  isChtJp: boolean;
  hasChs: boolean;
  hasCht: boolean;
  isRawOrJpnOnly: boolean;
}

// Boundary-safe Latin/CJK token helpers to prevent false positives like "1.2 GB", "Disc", "Sub"
const BILINGUAL_REGEX =
  /(简繁日内封|简繁日|繁简日|简繁内封|简繁中字|简繁双语|简繁|繁简|CHS\s*[&+_\/-]\s*CHT|CHT\s*[&+_\/-]\s*CHS|BIG5\s*[&+_\/-]\s*GB|GB\s*[&+_\/-]\s*BIG5|SC\s*[&+_\/-]\s*TC|TC\s*[&+_\/-]\s*SC|简\s*[&+]\s*繁)/i;
const CHS_JP_REGEX =
  /(简日双语|简日内嵌|简日内封|简日字幕|简日|(?<![a-zA-Z0-9])(JPSC|CHS[_&\s+-]*JP(?:N)?|GB[_&\s+-]*JP(?:N)?|SC[_&\s+-]*JP(?:N)?)(?![a-zA-Z0-9]))/i;
const CHT_JP_REGEX =
  /(繁日双语|繁日内嵌|繁日内封|繁日字幕|繁日|(?<![a-zA-Z0-9])(JPTC|CHT[_&\s+-]*JP(?:N)?|BIG5[_&\s+-]*JP(?:N)?|TC[_&\s+-]*JP(?:N)?)(?![a-zA-Z0-9]))/i;
const CHS_TOKEN_REGEX =
  /(简体中文|简体|簡體|简中|簡中|简体内嵌|简体内封|(?<![a-zA-Z0-9])(CHS|SC|zh[-_]Hans)(?![a-zA-Z0-9])|(?<![a-zA-Z0-9])(?<!\d\s*)GB(?![a-zA-Z0-9]))/i;
const CHT_TOKEN_REGEX =
  /(繁体中文|繁体|繁體|繁中|繁体内嵌|繁体内封|(?<![a-zA-Z0-9])(CHT|BIG5|TC|zh[-_]Hant)(?![a-zA-Z0-9]))/i;
const RAW_REGEX =
  /(生肉|无字幕|無字幕|(?<![a-zA-Z0-9])(RAW|WEBRIP[-_\s]?RAW)(?![a-zA-Z0-9]))/i;
const JPN_REGEX =
  /(日语|日文|日配|(?<![a-zA-Z0-9])(JPN|JP)(?![a-zA-Z0-9]))/i;

export function detectSubtitleLanguage(title: string): DetectedSubtitleLanguage {
  const input = (title || '').trim();
  if (!input) {
    return {
      isBilingual: false,
      isChsJp: false,
      isChtJp: false,
      hasChs: false,
      hasCht: false,
      isRawOrJpnOnly: false,
    };
  }

  const isBilingual = BILINGUAL_REGEX.test(input);
  const isChsJp = CHS_JP_REGEX.test(input);
  const isChtJp = CHT_JP_REGEX.test(input);
  const explicitChs = CHS_TOKEN_REGEX.test(input);
  const explicitCht = CHT_TOKEN_REGEX.test(input);

  const hasChs = explicitChs || isChsJp || isBilingual || (explicitChs && explicitCht);
  const hasCht = explicitCht || isChtJp || isBilingual || (explicitChs && explicitCht);
  const combinedBilingual = isBilingual || (hasChs && hasCht);

  const isRaw = RAW_REGEX.test(input);
  const hasJpn = JPN_REGEX.test(input);
  const isRawOrJpnOnly = isRaw || (hasJpn && !hasChs && !hasCht);

  return {
    isBilingual: combinedBilingual,
    isChsJp,
    isChtJp,
    hasChs: hasChs || combinedBilingual,
    hasCht: hasCht || combinedBilingual,
    isRawOrJpnOnly,
  };
}

export function matchesSubtitleLanguage(
  title: string,
  filter?: SubtitleLanguageFilter,
): boolean {
  if (!filter || filter === 'all') return true;
  const d = detectSubtitleLanguage(title);
  switch (filter) {
    case 'chs':
      return d.hasChs;
    case 'cht':
      return d.hasCht;
    case 'bilingual':
      return d.isBilingual;
    case 'chs_jp':
      return d.isChsJp;
    case 'cht_jp':
      return d.isChtJp;
    case 'raw':
      return d.isRawOrJpnOnly;
    default:
      return true;
  }
}

export function countSubtitleLanguages(
  titles: string[],
): Array<{ id: SubtitleLanguageFilter; label: string; shortLabel: string; count: number }> {
  const result: Array<{
    id: SubtitleLanguageFilter;
    label: string;
    shortLabel: string;
    count: number;
  }> = [];

  for (const opt of SUBTITLE_LANGUAGE_OPTIONS) {
    if (opt.id === 'all') continue;
    let count = 0;
    for (const title of titles) {
      if (matchesSubtitleLanguage(title, opt.id)) {
        count += 1;
      }
    }
    if (count > 0) {
      result.push({
        id: opt.id,
        label: opt.label,
        shortLabel: opt.shortLabel,
        count,
      });
    }
  }
  return result;
}

export function inferCommonSubtitleLanguage(titles: string[]): SubtitleLanguageFilter {
  const valid = titles.map((t) => t.trim()).filter(Boolean);
  if (valid.length === 0) return 'all';

  const detected = valid.map((t) => detectSubtitleLanguage(t));
  if (detected.every((d) => d.isChsJp)) return 'chs_jp';
  if (detected.every((d) => d.isChtJp)) return 'cht_jp';
  if (detected.every((d) => d.isBilingual)) return 'bilingual';
  if (detected.every((d) => d.hasChs) && !detected.every((d) => d.hasCht)) return 'chs';
  if (detected.every((d) => d.hasCht) && !detected.every((d) => d.hasChs)) return 'cht';
  if (detected.every((d) => d.isRawOrJpnOnly)) return 'raw';
  return 'all';
}

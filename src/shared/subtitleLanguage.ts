import type { SubtitleLanguageFilter } from './types';

export type SubtitleLanguageCategory = Exclude<SubtitleLanguageFilter, 'all'> | 'unknown';

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
    label: '简体中文',
    shortLabel: '简体',
    description: '匹配纯简体中文字幕（简体/简中/CHS/SC/GB）版本',
  },
  {
    id: 'cht',
    label: '繁体中文',
    shortLabel: '繁体',
    description: '匹配纯繁体中文字幕（繁体/繁中/CHT/TC/BIG5）版本',
  },
  {
    id: 'chs_jp',
    label: '简日双语',
    shortLabel: '简日双语',
    description: '匹配简日双语 / 简日内嵌（JPSC / CHS_JP / 中日双语）版本',
  },
  {
    id: 'cht_jp',
    label: '繁日双语',
    shortLabel: '繁日双语',
    description: '匹配繁日双语 / 繁日内嵌（JPTC / CHT_JP）版本',
  },
  {
    id: 'bilingual',
    label: '简繁/多语内封',
    shortLabel: '简繁/多语',
    description: '匹配简繁内封、简繁日内封、简繁外挂或多语 ASSx2 版本',
  },
  {
    id: 'raw',
    label: '日语/生肉',
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
  category: SubtitleLanguageCategory;
  isBilingual: boolean;
  isChsJp: boolean;
  isChtJp: boolean;
  hasChs: boolean;
  hasCht: boolean;
  isRawOrJpnOnly: boolean;
}

// Boundary-safe Latin/CJK token helpers to prevent false positives like "1.2 GB", "Disc", "Sub"
const BILINGUAL_PAIR_REGEX =
  /(?<![a-zA-Z0-9])(?:(?:CHS|SC|GB)(?:[_-]?JP(?:N)?)?\s*[&+_/-]\s*(?:CHT|TC|BIG5)(?:[_-]?JP(?:N)?)?|(?:CHT|TC|BIG5)(?:[_-]?JP(?:N)?)?\s*[&+_/-]\s*(?:CHS|SC|GB)(?:[_-]?JP(?:N)?)?|JPSC\s*[&+_/-]\s*JPTC|JPTC\s*[&+_/-]\s*JPSC|ASSx[2-9]|SRTx[2-9]|Multi[-_\s]?Sub(?:s)?)(?![a-zA-Z0-9])/i;

const BILINGUAL_REGEX =
  /(简繁日内封|简繁日内嵌|简繁日双语|简繁日英|简繁日|繁简日|简繁内封|简繁内嵌|简繁外挂|简繁字幕|简繁中字|简繁双语|简繁英|简繁|繁简|多语内封|多语字幕|多国字幕|简\s*[&+/]\s*繁|繁\s*[&+/]\s*简)/i;

const CHS_JP_REGEX =
  /(简日双语|简日内嵌|简日内封|简日外挂|简日字幕|简日|中日双语|中日内嵌|中日内封|中日字幕|(?<![a-zA-Z0-9])(JPSC|SCJP|CHS[_&\s+-]*JP(?:N)?|GB[_&\s+-]*JP(?:N)?|SC[_&\s+-]*JP(?:N)?|JP(?:N)?[_&\s+-]*CHS|JP(?:N)?[_&\s+-]*SC|JP(?:N)?[_&\s+-]*GB)(?![a-zA-Z0-9]))/i;

const CHT_JP_REGEX =
  /((?<!简)(?:繁日双语|繁日内嵌|繁日内封|繁日外挂|繁日字幕|繁日)|(?<![a-zA-Z0-9])(JPTC|TCJP|CHT[_&\s+-]*JP(?:N)?|BIG5[_&\s+-]*JP(?:N)?|TC[_&\s+-]*JP(?:N)?|JP(?:N)?[_&\s+-]*CHT|JP(?:N)?[_&\s+-]*TC|JP(?:N)?[_&\s+-]*BIG5)(?![a-zA-Z0-9]))/i;

const CHS_TOKEN_REGEX =
  /(简体中文|简体内嵌|简体内封|简体外挂|简体字幕|简中|簡中|简体|簡體|中简|简字|(?<![a-zA-Z0-9])(CHS|SC|zh[-_]Hans)(?![a-zA-Z0-9])|(?<![a-zA-Z0-9])(?<!\d\s*)GB(?![a-zA-Z0-9]))/i;

const CHT_TOKEN_REGEX =
  /(繁体中文|繁体内嵌|繁体内封|繁体外挂|繁体字幕|繁中|繁体|繁體|中繁|繁字|(?<![a-zA-Z0-9])(CHT|BIG5|TC|zh[-_]Hant)(?![a-zA-Z0-9]))/i;

const RAW_REGEX =
  /(生肉|无字幕|無字幕|(?<![a-zA-Z0-9])(RAW|WEBRIP[-_\s]?RAW|BDRIP[-_\s]?RAW)(?![a-zA-Z0-9]))/i;

const JPN_SUB_REGEX =
  /(日语字幕|日文字幕|日语|日文|日字|(?<![a-zA-Z0-9])(JPN|JP)(?![a-zA-Z0-9]))/i;

export function classifySubtitleLanguage(title: string): SubtitleLanguageCategory {
  const input = (title || '').trim();
  if (!input) return 'unknown';

  const hasChsJp = CHS_JP_REGEX.test(input);
  const hasChtJp = CHT_JP_REGEX.test(input);
  const hasChsToken = CHS_TOKEN_REGEX.test(input);
  const hasChtToken = CHT_TOKEN_REGEX.test(input);

  const hasChsSignal = hasChsJp || hasChsToken;
  const hasChtSignal = hasChtJp || hasChtToken;

  if (BILINGUAL_REGEX.test(input) || BILINGUAL_PAIR_REGEX.test(input) || (hasChsSignal && hasChtSignal)) {
    return 'bilingual';
  }

  const hasJpnSub = JPN_SUB_REGEX.test(input);
  if (hasChsJp || (hasChsToken && hasJpnSub)) {
    return 'chs_jp';
  }
  if (hasChtJp || (hasChtToken && hasJpnSub)) {
    return 'cht_jp';
  }

  if (hasChsToken) {
    return 'chs';
  }
  if (hasChtToken) {
    return 'cht';
  }

  if (RAW_REGEX.test(input) || hasJpnSub) {
    return 'raw';
  }

  return 'unknown';
}

export function detectSubtitleLanguage(title: string): DetectedSubtitleLanguage {
  const category = classifySubtitleLanguage(title);
  return {
    category,
    isBilingual: category === 'bilingual',
    isChsJp: category === 'chs_jp',
    isChtJp: category === 'cht_jp',
    hasChs: category === 'chs' || category === 'chs_jp' || category === 'bilingual',
    hasCht: category === 'cht' || category === 'cht_jp' || category === 'bilingual',
    isRawOrJpnOnly: category === 'raw',
  };
}

export function matchesSubtitleLanguage(
  title: string,
  filter?: SubtitleLanguageFilter,
): boolean {
  if (!filter || filter === 'all') return true;
  return classifySubtitleLanguage(title) === filter;
}

export function countSubtitleLanguages(
  titles: string[],
): Array<{ id: SubtitleLanguageFilter; label: string; shortLabel: string; count: number }> {
  const counts = new Map<SubtitleLanguageCategory, number>();
  for (const title of titles) {
    const category = classifySubtitleLanguage(title);
    if (category === 'unknown') continue;
    counts.set(category, (counts.get(category) || 0) + 1);
  }

  const result: Array<{
    id: SubtitleLanguageFilter;
    label: string;
    shortLabel: string;
    count: number;
  }> = [];

  for (const opt of SUBTITLE_LANGUAGE_OPTIONS) {
    if (opt.id === 'all') continue;
    const count = counts.get(opt.id) || 0;
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

  const firstCategory = classifySubtitleLanguage(valid[0]);
  if (firstCategory === 'unknown') return 'all';

  for (let i = 1; i < valid.length; i += 1) {
    if (classifySubtitleLanguage(valid[i]) !== firstCategory) {
      return 'all';
    }
  }
  return firstCategory;
}

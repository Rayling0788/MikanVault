import type {
  AppSettings,
  LibrarySeries,
  MikanBangumiDetail,
  MikanRelease,
  MikanScheduleResponse,
  QbTorrentItem,
} from '@shared/types';

function makePosterSvg(
  title: string,
  subtitle: string,
  c1: string,
  c2: string,
  accent: string,
  motif: 'moon' | 'arch' | 'wave' | 'sun' | 'grid' | 'diamond'
): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let shape = '';
  if (motif === 'moon') {
    shape = `
      <circle cx="205" cy="118" r="68" fill="${accent}" fill-opacity="0.22"/>
      <circle cx="205" cy="118" r="46" fill="${accent}" fill-opacity="0.72"/>
      <circle cx="222" cy="108" r="40" fill="${c1}"/>
      <path d="M0 320 Q150 250 300 305 L300 400 L0 400 Z" fill="#0B0D11" fill-opacity="0.55"/>
    `;
  } else if (motif === 'arch') {
    shape = `
      <path d="M60 320 L60 140 A90 90 0 0 1 240 140 L240 320" fill="none" stroke="${accent}" stroke-opacity="0.55" stroke-width="2"/>
      <path d="M85 320 L85 148 A65 65 0 0 1 215 148 L215 320" fill="${accent}" fill-opacity="0.14"/>
      <circle cx="150" cy="145" r="24" fill="${accent}" fill-opacity="0.8"/>
    `;
  } else if (motif === 'wave') {
    shape = `
      <path d="M-20 220 C70 155, 160 275, 320 190 L320 400 L-20 400 Z" fill="${accent}" fill-opacity="0.24"/>
      <path d="M-20 255 C90 195, 190 300, 320 235 L320 400 L-20 400 Z" fill="${accent}" fill-opacity="0.38"/>
      <circle cx="88" cy="112" r="34" fill="#FFF7ED" fill-opacity="0.85"/>
    `;
  } else if (motif === 'sun') {
    shape = `
      <circle cx="150" cy="160" r="82" fill="${accent}" fill-opacity="0.22"/>
      <circle cx="150" cy="160" r="54" fill="${accent}" fill-opacity="0.82"/>
      <line x1="30" y1="242" x2="270" y2="242" stroke="#FFF" stroke-opacity="0.22" stroke-width="1"/>
    `;
  } else if (motif === 'grid') {
    shape = `
      <rect x="48" y="68" width="204" height="170" rx="18" fill="${accent}" fill-opacity="0.14" stroke="${accent}" stroke-opacity="0.45"/>
      <line x1="48" y1="153" x2="252" y2="153" stroke="${accent}" stroke-opacity="0.35"/>
      <line x1="150" y1="68" x2="150" y2="238" stroke="${accent}" stroke-opacity="0.35"/>
      <circle cx="150" cy="153" r="22" fill="${accent}" fill-opacity="0.88"/>
    `;
  } else {
    shape = `
      <polygon points="150,52 244,160 150,268 56,160" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-opacity="0.55" stroke-width="1.5"/>
      <polygon points="150,94 206,160 150,226 94,160" fill="${accent}" fill-opacity="0.45"/>
    `;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400" width="300" height="400">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#0B0D11" stop-opacity="0.05"/>
        <stop offset="68%" stop-color="#0B0D11" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="#0B0D11" stop-opacity="0.92"/>
      </linearGradient>
    </defs>
    <rect width="300" height="400" fill="url(#bg)"/>
    ${shape}
    <rect width="300" height="400" fill="url(#fade)"/>
    <text x="24" y="42" fill="#FFFFFF" fill-opacity="0.6" font-family="sans-serif" font-size="11" letter-spacing="3">${esc(subtitle)}</text>
    <text x="24" y="348" fill="#FFFFFF" font-family="sans-serif" font-weight="700" font-size="22">${esc(title.slice(0, 10))}</text>
  </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export const MOCK_POSTERS = {
  frieren: makePosterSvg('葬送的芙莉莲', 'SOUSOU NO FRIEREN', '#13263A', '#0B131E', '#67E8F9', 'moon'),
  kusuriya: makePosterSvg('药屋少女的呢喃', 'KUSURIYA NO HITORIGOTO', '#35191A', '#130D12', '#FF7A2F', 'arch'),
  dandadan: makePosterSvg('胆大党', 'DANDADAN', '#2C1712', '#121017', '#FB923C', 'diamond'),
  sakamoto: makePosterSvg('坂本日常', 'SAKAMOTO DAYS', '#18242E', '#0D1218', '#38BDF8', 'grid'),
  dungeon: makePosterSvg('迷宫饭', 'DUNGEON MESHI', '#2C2214', '#12100C', '#F59E0B', 'sun'),
  bocchi: makePosterSvg('孤独摇滚！剧场版', 'BOCCHI THE ROCK!', '#2D1622', '#120D14', '#FB7185', 'wave'),
  violet: makePosterSvg('紫罗兰永恒花园', 'VIOLET EVERGARDEN', '#16292B', '#0C1417', '#2DD4BF', 'arch'),
  solo: makePosterSvg('我独自升级', 'SOLO LEVELING', '#111B2E', '#090D15', '#38BDF8', 'diamond'),
  apothecary: makePosterSvg('青之箱', 'BLUE BOX', '#122A38', '#0A131A', '#34D399', 'wave'),
  medalist: makePosterSvg('金牌得主', 'MEDALIST', '#1C2538', '#0D1119', '#FBBF24', 'sun'),
  rezero: makePosterSvg('Re:从零开始', 'RE:ZERO S3', '#231D2E', '#0E0D14', '#F472B6', 'moon'),
  drstone: makePosterSvg('石纪元 科学未来', 'DR. STONE', '#132A1F', '#0B1410', '#22C55E', 'grid'),
};

export const MOCK_SCHEDULE: MikanScheduleResponse = {
  fetchedAt: Date.now(),
  groups: [
    {
      dayOfWeek: 1,
      label: '周一',
      items: [
        { id: '3512', title: '坂本日常 SAKAMOTO DAYS', coverUrl: MOCK_POSTERS.sakamoto, updateDay: 1, hasUpdate: true, updateDate: '今日 00:30' },
        { id: '3519', title: '金牌得主 Medalist', coverUrl: MOCK_POSTERS.medalist, updateDay: 1, hasUpdate: false, updateDate: '周一 01:30' },
      ],
    },
    {
      dayOfWeek: 2,
      label: '周二',
      items: [
        { id: '3524', title: '青之箱 Blue Box', coverUrl: MOCK_POSTERS.apothecary, updateDay: 2, hasUpdate: true, updateDate: '周二 00:00' },
      ],
    },
    {
      dayOfWeek: 3,
      label: '周三',
      items: [
        { id: '3531', title: 'Re:从零开始的异世界生活 第三季', coverUrl: MOCK_POSTERS.rezero, updateDay: 3, hasUpdate: true, updateDate: '周三 22:30' },
      ],
    },
    {
      dayOfWeek: 4,
      label: '周四',
      items: [
        { id: '3540', title: '石纪元 科学未来', coverUrl: MOCK_POSTERS.drstone, updateDay: 4, hasUpdate: false, updateDate: '周四 22:00' },
        { id: '3544', title: '迷宫饭 第二季', coverUrl: MOCK_POSTERS.dungeon, updateDay: 4, hasUpdate: true, updateDate: '周四 23:00' },
      ],
    },
    {
      dayOfWeek: 5,
      label: '周五',
      items: [
        { id: '3501', title: '葬送的芙莉莲 第二季', coverUrl: MOCK_POSTERS.frieren, updateDay: 5, hasUpdate: true, updateDate: '周五 23:00' },
        { id: '3502', title: '药屋少女的呢喃 第二季', coverUrl: MOCK_POSTERS.kusuriya, updateDay: 5, hasUpdate: true, updateDate: '周五 23:30' },
      ],
    },
    {
      dayOfWeek: 6,
      label: '周六',
      items: [
        { id: '3560', title: '我独自升级 第二季 起于暗影', coverUrl: MOCK_POSTERS.solo, updateDay: 6, hasUpdate: true, updateDate: '周六 23:30' },
      ],
    },
    {
      dayOfWeek: 0,
      label: '周日',
      items: [
        { id: '3571', title: '胆大党 DANDADAN', coverUrl: MOCK_POSTERS.dandadan, updateDay: 0, hasUpdate: true, updateDate: '周日 00:26' },
      ],
    },
    {
      dayOfWeek: 7,
      label: '剧场版',
      items: [
        { id: '3588', title: '剧场总集篇 孤独摇滚！Re:Re:', coverUrl: MOCK_POSTERS.bocchi, updateDay: 7, hasUpdate: false, updateDate: '剧场版' },
      ],
    },
    {
      dayOfWeek: 8,
      label: 'OVA',
      items: [
        { id: '3595', title: '紫罗兰永恒花园 特别篇', coverUrl: MOCK_POSTERS.violet, updateDay: 8, hasUpdate: false, updateDate: 'OVA' },
      ],
    },
  ],
};

export function createMockBangumiDetail(id: string): MikanBangumiDetail {
  const allItems = MOCK_SCHEDULE.groups.flatMap((g) => g.items);
  const found = allItems.find((i) => i.id === id) ?? allItems[0];
  const now = Date.now();
  return {
    id: found.id,
    title: found.title,
    coverUrl: found.coverUrl,
    mikanUrl: `https://mikanani.kas.pub/Home/Bangumi/${found.id}`,
    infoLines: [
      `放送日期：${found.updateDate || '每周五 23:00'}`,
      '放送开始：2026年春季新番',
      '制片国家 / 地区：日本',
      '蜜柑计划聚合字幕源 · 支持 RSS 自动追更',
    ],
    subgroups: [
      {
        id: '370',
        name: 'LoliHouse',
        rssUrl: `https://mikanani.kas.pub/RSS/Bangumi?bangumiId=${found.id}&subgroupid=370`,
        episodes: [
          {
            id: `${found.id}-lh-12`,
            title: `[LoliHouse] ${found.title} - 12 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]`,
            bangumiTitle: found.title,
            bangumiId: found.id,
            subgroup: 'LoliHouse',
            size: '612.4 MB',
            sizeBytes: 642150400,
            pubDate: new Date(now - 38 * 60 * 1000).toISOString(),
            torrentUrl: `https://mikanani.kas.pub/Download/2026/lh-${found.id}-12.torrent`,
            episodeUrl: `https://mikanani.kas.pub/Home/Episode/lh-${found.id}-12`,
            tags: ['1080P', 'HEVC', '10bit', '简繁'],
          },
          {
            id: `${found.id}-lh-11`,
            title: `[LoliHouse] ${found.title} - 11 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]`,
            bangumiTitle: found.title,
            bangumiId: found.id,
            subgroup: 'LoliHouse',
            size: '584.1 MB',
            sizeBytes: 612474880,
            pubDate: new Date(now - 7 * 86400 * 1000).toISOString(),
            torrentUrl: `https://mikanani.kas.pub/Download/2026/lh-${found.id}-11.torrent`,
            episodeUrl: `https://mikanani.kas.pub/Home/Episode/lh-${found.id}-11`,
            tags: ['1080P', 'HEVC', '10bit', '简繁'],
          },
          {
            id: `${found.id}-lh-10`,
            title: `[LoliHouse] ${found.title} - 10 [BDRip 2160p 4K HEVC-10bit FLAC][简繁内封字幕]`,
            bangumiTitle: found.title,
            bangumiId: found.id,
            subgroup: 'LoliHouse',
            size: '1.84 GB',
            sizeBytes: 1975684956,
            pubDate: new Date(now - 14 * 86400 * 1000).toISOString(),
            torrentUrl: `https://mikanani.kas.pub/Download/2026/lh-${found.id}-10.torrent`,
            episodeUrl: `https://mikanani.kas.pub/Home/Episode/lh-${found.id}-10`,
            tags: ['4K', 'HEVC', 'BDRip', '简繁'],
          },
        ],
      },
      {
        id: '583',
        name: 'ANi',
        rssUrl: `https://mikanani.kas.pub/RSS/Bangumi?bangumiId=${found.id}&subgroupid=583`,
        episodes: [
          {
            id: `${found.id}-ani-12`,
            title: `[ANi] ${found.title} - 12 [1080P][Baha][WEB-DL][AAC AVC][CHT]`,
            bangumiTitle: found.title,
            bangumiId: found.id,
            subgroup: 'ANi',
            size: '436.2 MB',
            sizeBytes: 457388032,
            pubDate: new Date(now - 2 * 3600 * 1000).toISOString(),
            torrentUrl: `https://mikanani.kas.pub/Download/2026/ani-${found.id}-12.torrent`,
            episodeUrl: `https://mikanani.kas.pub/Home/Episode/ani-${found.id}-12`,
            tags: ['1080P', 'AVC', '繁中'],
          },
          {
            id: `${found.id}-ani-11`,
            title: `[ANi] ${found.title} - 11 [1080P][Baha][WEB-DL][AAC AVC][CHT]`,
            bangumiTitle: found.title,
            bangumiId: found.id,
            subgroup: 'ANi',
            size: '428.8 MB',
            sizeBytes: 449629388,
            pubDate: new Date(now - 7 * 86400 * 1000).toISOString(),
            torrentUrl: `https://mikanani.kas.pub/Download/2026/ani-${found.id}-11.torrent`,
            episodeUrl: `https://mikanani.kas.pub/Home/Episode/ani-${found.id}-11`,
            tags: ['1080P', 'AVC', '繁中'],
          },
        ],
      },
      {
        id: '615',
        name: '桜都字幕组',
        rssUrl: `https://mikanani.kas.pub/RSS/Bangumi?bangumiId=${found.id}&subgroupid=615`,
        episodes: [
          {
            id: `${found.id}-sakura-12`,
            title: `[桜都字幕组] ${found.title} [12][1080p][简日双语][HEVC]`,
            bangumiTitle: found.title,
            bangumiId: found.id,
            subgroup: '桜都字幕组',
            size: '542.0 MB',
            sizeBytes: 568328192,
            pubDate: new Date(now - 5 * 3600 * 1000).toISOString(),
            torrentUrl: `https://mikanani.kas.pub/Download/2026/sakura-${found.id}-12.torrent`,
            episodeUrl: `https://mikanani.kas.pub/Home/Episode/sakura-${found.id}-12`,
            tags: ['1080P', 'HEVC', '简日'],
          },
        ],
      },
    ],
  };
}

export const MOCK_RSS_RELEASES: MikanRelease[] = [
  {
    id: 'rss-1',
    title: '[LoliHouse] 葬送的芙莉莲 第二季 / Sousou no Frieren S2 - 12 [WebRip 1080p HEVC-10bit AAC][简繁内封字幕]',
    bangumiTitle: '葬送的芙莉莲 第二季',
    bangumiId: '3501',
    subgroup: 'LoliHouse',
    size: '612.4 MB',
    pubDate: new Date(Date.now() - 22 * 60 * 1000).toISOString(),
    torrentUrl: 'https://mikanani.kas.pub/Download/2026/frieren-12.torrent',
    episodeUrl: 'https://mikanani.kas.pub/Home/Episode/frieren-12',
    tags: ['1080P', 'HEVC', '10bit', '简繁'],
  },
  {
    id: 'rss-2',
    title: '[ANi] 药屋少女的呢喃 第二季 - 18 [1080P][Baha][WEB-DL][AAC AVC][CHT]',
    bangumiTitle: '药屋少女的呢喃 第二季',
    bangumiId: '3502',
    subgroup: 'ANi',
    size: '458.6 MB',
    pubDate: new Date(Date.now() - 68 * 60 * 1000).toISOString(),
    torrentUrl: 'https://mikanani.kas.pub/Download/2026/kusuriya-18.torrent',
    episodeUrl: 'https://mikanani.kas.pub/Home/Episode/kusuriya-18',
    tags: ['1080P', 'WebRip', '繁中'],
  },
  {
    id: 'rss-3',
    title: '[桜都字幕组] 胆大党 DANDADAN [12][2160p 4K][HEVC-10bit][简日双语]',
    bangumiTitle: '胆大党 DANDADAN',
    bangumiId: '3571',
    subgroup: '桜都字幕组',
    size: '1.42 GB',
    pubDate: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    torrentUrl: 'https://mikanani.kas.pub/Download/2026/dandadan-12.torrent',
    episodeUrl: 'https://mikanani.kas.pub/Home/Episode/dandadan-12',
    tags: ['4K', 'HEVC', '简日'],
  },
  {
    id: 'rss-4',
    title: '[北宇治字幕组] 迷宫饭 第二季 [09][WebRip][1080p][HEVC_AAC][简繁内封]',
    bangumiTitle: '迷宫饭 第二季',
    bangumiId: '3544',
    subgroup: '北宇治字幕组',
    size: '528.9 MB',
    pubDate: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
    torrentUrl: 'https://mikanani.kas.pub/Download/2026/dungeon-09.torrent',
    episodeUrl: 'https://mikanani.kas.pub/Home/Episode/dungeon-09',
    tags: ['1080P', 'HEVC', '简繁'],
  },
  {
    id: 'rss-5',
    title: '[VCB-Studio] 剧场总集篇 孤独摇滚！Re:Re: [Ma10p_1080p][BDRip][简繁外挂字幕]',
    bangumiTitle: '剧场总集篇 孤独摇滚！Re:Re:',
    bangumiId: '3588',
    subgroup: 'VCB-Studio',
    size: '3.68 GB',
    pubDate: new Date(Date.now() - 15 * 3600 * 1000).toISOString(),
    torrentUrl: 'https://mikanani.kas.pub/Download/2026/bocchi-bd.torrent',
    episodeUrl: 'https://mikanani.kas.pub/Home/Episode/bocchi-bd',
    tags: ['1080P', 'BDRip', '简繁'],
  },
];

export const MOCK_TORRENTS: QbTorrentItem[] = [
  {
    hash: 'a1b2c3d4e5f60001',
    name: '[LoliHouse] 葬送的芙莉莲 第二季 - 12 [WebRip 1080p HEVC-10bit][简繁内封].mkv',
    state: 'downloading',
    progress: 0.684,
    size: 642150400,
    downloaded: 439230873,
    dlspeed: 8_420_000,
    upspeed: 640_000,
    eta: 24,
    ratio: 0.18,
    savePath: 'D:\\Anime\\葬送的芙莉莲 第二季',
    category: 'mikan',
    addedOn: Math.floor(Date.now() / 1000) - 180,
    bangumiId: '3501',
    bangumiTitle: '葬送的芙莉莲 第二季',
    coverUrl: MOCK_POSTERS.frieren,
  },
  {
    hash: 'a1b2c3d4e5f60002',
    name: '[桜都字幕组] 胆大党 DANDADAN [12][2160p 4K][HEVC-10bit][简日双语].mkv',
    state: 'downloading',
    progress: 0.312,
    size: 1524713390,
    downloaded: 475710577,
    dlspeed: 4_850_000,
    upspeed: 210_000,
    eta: 216,
    ratio: 0.05,
    savePath: 'D:\\Anime\\胆大党 DANDADAN',
    category: 'mikan',
    addedOn: Math.floor(Date.now() / 1000) - 420,
    bangumiId: '3571',
    bangumiTitle: '胆大党 DANDADAN',
    coverUrl: MOCK_POSTERS.dandadan,
  },
  {
    hash: 'a1b2c3d4e5f60003',
    name: '[ANi] 药屋少女的呢喃 第二季 - 18 [1080P][WEB-DL][CHT].mp4',
    state: 'stalledUP',
    progress: 1,
    size: 480876953,
    downloaded: 480876953,
    dlspeed: 0,
    upspeed: 120_000,
    eta: 8640000,
    ratio: 1.42,
    savePath: 'D:\\Anime\\药屋少女的呢喃 第二季',
    category: 'mikan',
    addedOn: Math.floor(Date.now() / 1000) - 5400,
    bangumiId: '3502',
    bangumiTitle: '药屋少女的呢喃 第二季',
    coverUrl: MOCK_POSTERS.kusuriya,
  },
];

export const MOCK_LIBRARY: LibrarySeries[] = [
  {
    seriesId: 'lib-frieren',
    title: '葬送的芙莉莲 第二季',
    bangumiId: '3501',
    coverUrl: MOCK_POSTERS.frieren,
    folderPath: 'D:\\Anime\\葬送的芙莉莲 第二季',
    totalEpisodes: 4,
    watchedCount: 3,
    lastUpdated: Date.now() - 3600 * 1000,
    episodes: [
      {
        id: 'ep-f-1',
        title: '第 01 集 · 旅途的彼端',
        fileName: '[LoliHouse] Sousou no Frieren S2 - 01 [1080p HEVC 10bit].mkv',
        filePath: 'D:\\Anime\\葬送的芙莉莲 第二季\\[LoliHouse] Sousou no Frieren S2 - 01.mkv',
        episodeNumber: 1,
        resolution: '1080P',
        tags: ['HEVC', '10bit', '简繁'],
        sizeBytes: 604_120_000,
        watched: true,
        lastPlayedAt: Date.now() - 86400 * 3 * 1000,
        addedAt: Date.now() - 86400 * 21 * 1000,
      },
      {
        id: 'ep-f-2',
        title: '第 02 集 · 北方高原的风',
        fileName: '[LoliHouse] Sousou no Frieren S2 - 02 [1080p HEVC 10bit].mkv',
        filePath: 'D:\\Anime\\葬送的芙莉莲 第二季\\[LoliHouse] Sousou no Frieren S2 - 02.mkv',
        episodeNumber: 2,
        resolution: '1080P',
        tags: ['HEVC', '10bit', '简繁'],
        sizeBytes: 589_440_000,
        watched: true,
        lastPlayedAt: Date.now() - 86400 * 2 * 1000,
        addedAt: Date.now() - 86400 * 14 * 1000,
      },
      {
        id: 'ep-f-3',
        title: '第 03 集 · 黄金乡的回响',
        fileName: '[LoliHouse] Sousou no Frieren S2 - 03 [1080p HEVC 10bit].mkv',
        filePath: 'D:\\Anime\\葬送的芙莉莲 第二季\\[LoliHouse] Sousou no Frieren S2 - 03.mkv',
        episodeNumber: 3,
        resolution: '1080P',
        tags: ['HEVC', '10bit', '简繁'],
        sizeBytes: 621_880_000,
        watched: true,
        lastPlayedAt: Date.now() - 86400 * 1000,
        addedAt: Date.now() - 86400 * 7 * 1000,
      },
      {
        id: 'ep-f-4',
        title: '第 04 集 · 静谧的魔法使',
        fileName: '[LoliHouse] Sousou no Frieren S2 - 04 [1080p HEVC 10bit].mkv',
        filePath: 'D:\\Anime\\葬送的芙莉莲 第二季\\[LoliHouse] Sousou no Frieren S2 - 04.mkv',
        episodeNumber: 4,
        resolution: '1080P',
        tags: ['HEVC', '10bit', '简繁'],
        sizeBytes: 642_150_400,
        watched: false,
        addedAt: Date.now() - 3600 * 1000,
      },
    ],
  },
  {
    seriesId: 'lib-kusuriya',
    title: '药屋少女的呢喃 第二季',
    bangumiId: '3502',
    coverUrl: MOCK_POSTERS.kusuriya,
    folderPath: 'D:\\Anime\\药屋少女的呢喃 第二季',
    totalEpisodes: 3,
    watchedCount: 1,
    lastUpdated: Date.now() - 7200 * 1000,
    episodes: [
      {
        id: 'ep-k-1',
        title: '第 01 集',
        fileName: '[ANi] Kusuriya no Hitorigoto S2 - 01 [1080P].mp4',
        filePath: 'D:\\Anime\\药屋少女的呢喃 第二季\\Kusuriya S2 - 01.mp4',
        episodeNumber: 1,
        resolution: '1080P',
        tags: ['AVC', '繁中'],
        sizeBytes: 452_000_000,
        watched: true,
        addedAt: Date.now() - 86400 * 10 * 1000,
      },
      {
        id: 'ep-k-2',
        title: '第 02 集',
        fileName: '[ANi] Kusuriya no Hitorigoto S2 - 02 [1080P].mp4',
        filePath: 'D:\\Anime\\药屋少女的呢喃 第二季\\Kusuriya S2 - 02.mp4',
        episodeNumber: 2,
        resolution: '1080P',
        tags: ['AVC', '繁中'],
        sizeBytes: 468_300_000,
        watched: false,
        addedAt: Date.now() - 86400 * 3 * 1000,
      },
      {
        id: 'ep-k-3',
        title: '第 03 集',
        fileName: '[ANi] Kusuriya no Hitorigoto S2 - 03 [1080P].mp4',
        filePath: 'D:\\Anime\\药屋少女的呢喃 第二季\\Kusuriya S2 - 03.mp4',
        episodeNumber: 3,
        resolution: '1080P',
        tags: ['AVC', '繁中'],
        sizeBytes: 480_876_953,
        watched: false,
        addedAt: Date.now() - 7200 * 1000,
      },
    ],
  },
  {
    seriesId: 'lib-bocchi',
    title: '剧场总集篇 孤独摇滚！Re:Re:',
    bangumiId: '3588',
    coverUrl: MOCK_POSTERS.bocchi,
    folderPath: 'D:\\Anime\\孤独摇滚 剧场版',
    totalEpisodes: 1,
    watchedCount: 1,
    lastUpdated: Date.now() - 86400 * 4 * 1000,
    episodes: [
      {
        id: 'ep-b-1',
        title: '剧场版正片',
        fileName: '[VCB-Studio] Bocchi the Rock! ReRe [BDRip 1080p].mkv',
        filePath: 'D:\\Anime\\孤独摇滚 剧场版\\Bocchi ReRe.mkv',
        episodeNumber: 1,
        resolution: '1080P',
        tags: ['BDRip', 'HEVC', '简繁'],
        sizeBytes: 3_951_369_912,
        watched: true,
        addedAt: Date.now() - 86400 * 4 * 1000,
      },
    ],
  },
  {
    seriesId: 'lib-local',
    title: '星际牛仔 Cowboy Bebop (本地收藏)',
    folderPath: 'E:\\Media\\Anime\\Cowboy Bebop',
    totalEpisodes: 2,
    watchedCount: 0,
    lastUpdated: Date.now() - 86400 * 12 * 1000,
    episodes: [
      {
        id: 'ep-cb-1',
        title: 'Session 01 · Asteroid Blues',
        fileName: 'Cowboy.Bebop.S01E01.1080p.BluRay.x265.mkv',
        filePath: 'E:\\Media\\Anime\\Cowboy Bebop\\Cowboy.Bebop.S01E01.mkv',
        episodeNumber: 1,
        resolution: '1080P',
        tags: ['BDRip', 'HEVC'],
        sizeBytes: 1_245_000_000,
        watched: false,
        addedAt: Date.now() - 86400 * 12 * 1000,
      },
      {
        id: 'ep-cb-2',
        title: 'Session 02 · Stray Dog Strut',
        fileName: 'Cowboy.Bebop.S01E02.1080p.BluRay.x265.mkv',
        filePath: 'E:\\Media\\Anime\\Cowboy Bebop\\Cowboy.Bebop.S01E02.mkv',
        episodeNumber: 2,
        resolution: '1080P',
        tags: ['BDRip', 'HEVC'],
        sizeBytes: 1_198_000_000,
        watched: false,
        addedAt: Date.now() - 86400 * 12 * 1000,
      },
    ],
  },
];

export const MOCK_SETTINGS: AppSettings = {
  mikanBaseUrl: 'https://mikanani.kas.pub',
  qbUrl: 'http://127.0.0.1:8080',
  qbUsername: 'admin',
  qbPassword: '',
  qbExePath: 'D:\\Files\\qBittorrent\\qbittorrent.exe',
  qbCategory: 'mikan',
  downloadRootDir: 'D:\\Anime',
  extraLibraryDirs: ['E:\\Media\\Anime'],
  playerMode: 'system',
  customPlayerPath: '',
  subscriptionCheckIntervalMin: 15,
  subscriptionAutoLaunchQb: false,
  googleDriveEnabled: true,
  googleDriveDir: 'J:\\我的云端硬盘\\MikanVault',
  googleDriveAutoDeleteLocal: true,
  googleDriveIncludeInLibrary: true,
};

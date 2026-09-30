// Массовая выгрузка объявлений в Мету. Не черновики, а настоящие объявления
// на паузе: в Ads Manager у них видны текст, Instagram и кнопка, их можно
// проверить и включить. Медиа сначала загружаются в библиотеку кабинета
// (Ads Manager, Media), а в таблице на них ссылаются по названию файла.

const API = 'https://graph.facebook.com/v21.0';

const PAGE_ID = () => process.env.META_PAGE_ID || '1388717667652943';
const IG_ID = () => process.env.META_IG_USER_ID || '17841461844323372';
const ACCOUNT = () => String(process.env.META_AD_ACCOUNT_ID || '').split(',')[0].trim().replace(/^act_/, '');
const TOKEN = () => process.env.META_ADS_WRITE_TOKEN || '';

export const DEFAULT_URL_TAGS =
  'campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&utm_source=meta&utm_campaign={{campaign.name}}';
export const DEFAULT_LINK = 'https://www.sayyestoenglish.com/learn_easy';

export const COLUMNS = ['adset_id', 'name', 'media', 'text', 'headline', 'description', 'cta', 'link'];

async function graph(method, path, params = {}) {
  const url = new URL(API + path);
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const v = typeof value === 'string' ? value : JSON.stringify(value);

    if (method === 'GET') url.searchParams.set(key, v);
    else body.set(key, v);
  }

  if (method === 'GET') url.searchParams.set('access_token', TOKEN());
  else body.set('access_token', TOKEN());

  const resp = await fetch(url.toString(), method === 'GET' ? { cache: 'no-store' } : { method, body });
  const data = await resp.json();

  if (data.error) {
    const e = data.error;
    throw new Error([e.error_user_title, e.error_user_msg || e.message].filter(Boolean).join(': '));
  }

  return data;
}

async function all(path, params) {
  const out = [];
  let data = await graph('GET', path, { limit: '500', ...params });

  for (;;) {
    out.push(...(data.data || []));
    const next = data.paging && data.paging.next;
    if (!next) break;
    const resp = await fetch(next, { cache: 'no-store' });
    data = await resp.json();
    if (data.error) throw new Error(data.error.message);
  }

  return out;
}

const key = s => String(s || '').trim().toLowerCase().replace(/\.(mp4|mov|m4v|webm|jpe?g|png|gif)$/i, '');

// Библиотека кабинета: видео по названию, картинки по имени файла.
export async function loadLibrary() {
  const act = '/act_' + ACCOUNT();
  const [videos, images] = await Promise.all([
    all(act + '/advideos', { fields: 'id,title,picture' }),
    all(act + '/adimages', { fields: 'hash,name,width,height' })
  ]);
  const lib = new Map();

  for (const v of videos) if (v.title && !lib.has(key(v.title))) lib.set(key(v.title), { type: 'video', id: v.id, title: v.title });
  for (const i of images) if (i.name && !lib.has(key(i.name))) lib.set(key(i.name), { type: 'image', hash: i.hash, title: i.name, w: i.width, h: i.height });

  return lib;
}

// CSV из Google Таблиц: кавычки, переносы строк внутри ячеек, запятая или точка с запятой.
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split('\n')[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';'
    : firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }

  if (cell || row.length) { row.push(cell); rows.push(row); }

  const clean = rows.filter(r => r.some(c => c.trim()));
  if (!clean.length) return [];

  const head = clean[0].map(h => h.trim().toLowerCase());

  return clean.slice(1).map((r, n) => {
    const obj = { line: n + 2 };
    head.forEach((h, i) => { obj[h] = (r[i] || '').trim(); });
    return obj;
  });
}

// Проверка строки без обращения к Мете на запись. Возвращает готовый план или ошибки.
export function planRow(row, lib) {
  const errors = [];
  const names = String(row.media || '').split('|').map(s => s.trim()).filter(Boolean);
  const media = names.map(n => ({ name: n, found: lib.get(key(n)) }));

  if (!/^\d+$/.test(row.adset_id || '')) errors.push('нет adset_id');
  if (!row.name) errors.push('нет name');
  if (!row.text) errors.push('нет текста');
  if (!names.length) errors.push('нет media');
  if (names.length > 2) errors.push('media: максимум два файла, лента|вертикаль');
  for (const m of media) if (!m.found) errors.push('нет в библиотеке: ' + m.name);
  if (media.length === 2 && media[0].found && media[1].found && media[0].found.type !== media[1].found.type) {
    errors.push('оба файла должны быть видео или оба картинками');
  }

  return {
    line: row.line,
    adsetId: row.adset_id,
    name: row.name,
    media,
    text: row.text,
    headline: row.headline || '',
    description: row.description || '',
    cta: (row.cta || 'BOOK_NOW').toUpperCase().replace(/\s+/g, '_'),
    link: row.link || DEFAULT_LINK,
    errors
  };
}

async function thumb(videoId) {
  const data = await graph('GET', '/' + videoId, { fields: 'thumbnails{uri,is_preferred}' });
  const list = (data.thumbnails && data.thumbnails.data) || [];
  const best = list.find(t => t.is_preferred) || list[0];

  if (!best) throw new Error('у видео ' + videoId + ' ещё нет обложки, Мета его обрабатывает');

  return best.uri;
}

const VERTICAL = {
  publisher_platforms: ['facebook', 'instagram'],
  facebook_positions: ['story', 'facebook_reels'],
  instagram_positions: ['story', 'reels']
};

async function buildCreative(p) {
  const base = { page_id: PAGE_ID(), instagram_user_id: IG_ID() };
  const [feed, vertical] = p.media.map(m => m.found);
  const common = { name: p.name, url_tags: DEFAULT_URL_TAGS, contextual_multi_ads: { enroll_status: 'OPT_OUT' } };

  // Один файл: обычное объявление с одним видео или картинкой.
  if (!vertical) {
    if (feed.type === 'video') {
      const video_data = {
        video_id: feed.id,
        image_url: await thumb(feed.id),
        message: p.text,
        call_to_action: { type: p.cta, value: { link: p.link } }
      };
      if (p.headline) video_data.title = p.headline;
      if (p.description) video_data.link_description = p.description;
      return { ...common, object_story_spec: { ...base, video_data } };
    }

    const link_data = {
      image_hash: feed.hash,
      link: p.link,
      message: p.text,
      call_to_action: { type: p.cta, value: { link: p.link } }
    };
    if (p.headline) link_data.name = p.headline;
    if (p.description) link_data.description = p.description;
    return { ...common, object_story_spec: { ...base, link_data } };
  }

  // Два файла: лента получает первый, Stories и Reels второй (вертикаль).
  const isVideo = feed.type === 'video';
  const asset = (f, label) => isVideo
    ? { video_id: f.id, adlabels: [{ name: label }] }
    : { hash: f.hash, adlabels: [{ name: label }] };
  const labelKey = isVideo ? 'video_label' : 'image_label';
  const spec = {
    [isVideo ? 'videos' : 'images']: [asset(feed, 'sy_feed'), asset(vertical, 'sy_vertical')],
    bodies: [{ text: p.text }],
    link_urls: [{ website_url: p.link }],
    call_to_action_types: [p.cta],
    ad_formats: [isVideo ? 'SINGLE_VIDEO' : 'SINGLE_IMAGE'],
    optimization_type: 'PLACEMENT',
    asset_customization_rules: [
      { customization_spec: VERTICAL, [labelKey]: { name: 'sy_vertical' }, priority: 1 },
      { customization_spec: {}, [labelKey]: { name: 'sy_feed' }, priority: 2 }
    ]
  };
  if (p.headline) spec.titles = [{ text: p.headline }];
  if (p.description) spec.descriptions = [{ text: p.description }];

  return { ...common, object_story_spec: base, asset_feed_spec: spec };
}

// Создаёт креатив и объявление на паузе. Ошибка одной строки не валит остальные.
export async function createRow(p) {
  const act = '/act_' + ACCOUNT();
  const creative = await buildCreative(p);
  const c = await graph('POST', act + '/adcreatives', creative);
  const ad = await graph('POST', act + '/ads', {
    name: p.name,
    adset_id: p.adsetId,
    creative: { creative_id: c.id },
    status: 'PAUSED'
  });

  return { creativeId: c.id, adId: ad.id };
}

export async function runBulk(plans, concurrency = 4) {
  const results = new Array(plans.length);
  let next = 0;

  async function worker() {
    while (next < plans.length) {
      const i = next++;
      const p = plans[i];
      const started = Date.now();
      try {
        const r = await createRow(p);
        results[i] = { line: p.line, name: p.name, ok: true, ...r, ms: Date.now() - started };
      } catch (e) {
        results[i] = { line: p.line, name: p.name, ok: false, error: e.message, ms: Date.now() - started };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, plans.length) }, worker));
  return results;
}

export function ready() {
  if (!TOKEN()) return 'Не задан META_ADS_WRITE_TOKEN в Vercel.';
  if (!ACCOUNT()) return 'Не задан META_AD_ACCOUNT_ID.';
  return null;
}

export const accountId = ACCOUNT;

// Кампания и группы тоже создаются на паузе через API, а не черновиком:
// объявления можно класть только в опубликованную группу.
export async function createStructure(spec) {
  const act = '/act_' + ACCOUNT();
  const camp = await graph('POST', act + '/campaigns', {
    name: spec.campaign,
    objective: spec.objective || 'OUTCOME_LEADS',
    buying_type: 'AUCTION',
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: 'false',
    status: 'PAUSED'
  });
  const adsets = [];

  for (const s of spec.adsets || []) {
    const set = await graph('POST', act + '/adsets', {
      name: s.name,
      campaign_id: camp.id,
      daily_budget: String(Math.round(Number(s.daily_eur) * 100)),
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      destination_type: 'WEBSITE',
      promoted_object: { pixel_id: spec.pixel_id, custom_event_type: spec.event || 'SCHEDULE' },
      targeting: spec.targeting,
      dsa_beneficiary: spec.dsa || 'Say Yes Ger',
      dsa_payor: spec.dsa || 'Say Yes Ger',
      status: 'PAUSED'
    });
    adsets.push({ name: s.name, id: set.id });
  }

  return { campaignId: camp.id, adsets };
}

export const STRUCTURE_SAMPLE = {
  campaign: 'sayyes_eu_2026-10',
  pixel_id: '1332532938846061',
  event: 'SCHEDULE',
  adsets: [
    { name: 'eu_ae_il_schedule_winners', daily_eur: 50 },
    { name: 'eu_ae_il_schedule_new_creatives', daily_eur: 40 }
  ],
  targeting: {
    genders: [2], age_min: 18, age_max: 65,
    geo_locations: {
      countries: ['IE', 'IT', 'NL', 'NO', 'ES', 'SE', 'CH', 'AE', 'GB', 'IL', 'FI', 'DK', 'BE', 'GR', 'AT', 'HR', 'PL', 'RS',
        'PT', 'LU', 'BG', 'CZ', 'SI', 'IS', 'SK', 'LT', 'HU', 'CY', 'RO', 'FR', 'DE', 'MT', 'EE', 'LV'],
      location_types: ['home', 'recent']
    },
    locales: [17],
    publisher_platforms: ['facebook', 'instagram', 'threads'],
    device_platforms: ['mobile', 'desktop'],
    targeting_automation: { advantage_audience: 0 }
  }
};

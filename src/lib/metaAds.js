// Расход и клики из рекламного кабинета. Без них в админке нет ни цены заявки,
// ни цены дошедшего, ни окупаемости — поэтому блок честно говорит, чего не хватает,
// а не притворяется нулями.
import { ARCHIVED_ACCOUNTS, archiveDayRows, archiveCampaignRows, archiveAdRows, archiveAdsMeta } from '@/lib/metaArchive';

const API = 'https://graph.facebook.com/v21.0';

// С 30.09.2026 рекламных кабинетов два: старый SAYYES EU (история до переезда) и новый
// в новом BM. META_AD_ACCOUNT_ID принимает список через запятую, первый - основной.
// Токен общий (META_ADS_TOKEN) или свой у кабинета: META_ADS_TOKEN_<id кабинета>.
// Если один кабинет не ответил, остальные всё равно считаются.
const accounts = () => String(process.env.META_AD_ACCOUNT_ID || '')
  .split(',')
  .map(id => id.trim().replace(/^act_/, ''))
  .filter(Boolean);
const tokenFor = id => process.env['META_ADS_TOKEN_' + id] || process.env.META_ADS_TOKEN || '';
// Архивные кабинеты читаются из JSON, а не из API, даже если их id есть в переменной.
const reachable = () => accounts().filter(id => tokenFor(id) && !ARCHIVED_ACCOUNTS.includes(id));
const account = () => accounts()[0] || '';
const NO_ACCESS = 'Нет доступа к кабинету: не заданы META_ADS_TOKEN и META_AD_ACCOUNT_ID.';

// Опрашивает каждый кабинет. Ошибку одного не превращает в ошибку всех.
async function eachAccount(fn) {
  const ids = reachable();
  const settled = await Promise.allSettled(ids.map(id => fn(id, tokenFor(id))));
  const ok = [];
  const failed = [];

  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') ok.push({ id: ids[i], value: r.value });
    else failed.push(ids[i] + ': ' + (r.reason && r.reason.message ? r.reason.message : 'ошибка'));
  });

  return { ok, failed };
}

// Лиды Мета считает по-разному в зависимости от того, как настроена цель.
// Берём первое, что нашли: пиксельный Lead, лид-форму или полную регистрацию.
const LEAD_ACTIONS = [
  'offsite_conversion.fb_pixel_lead',
  'lead',
  'leadgen_grouped',
  'offsite_conversion.fb_pixel_complete_registration'
];

function leadsFrom(actions) {
  if (!Array.isArray(actions)) return 0;

  for (const type of LEAD_ACTIONS) {
    const hit = actions.find(row => row.action_type === type);

    if (hit) return Number(hit.value || 0);
  }

  return 0;
}

// Клик по ссылке и «клик» — разные вещи. В поле clicks Мета складывает всё:
// лайки, тапы по профилю, раскрытие текста. За неделю 7–13.09 это 944 против
// 650 настоящих переходов. В верх воронки годится только link_click.
function linkClicksFrom(actions) {
  if (!Array.isArray(actions)) return 0;

  const hit = actions.find(row => row.action_type === 'link_click');

  return hit ? Number(hit.value || 0) : 0;
}

async function ask(path, params, tok) {
  const url = new URL(API + path);

  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  url.searchParams.set('access_token', tok);

  const resp = await fetch(url.toString(), { cache: 'no-store' });
  const data = await resp.json();

  if (data.error) throw new Error(data.error.message || 'Meta API error');

  return data.data || [];
}

export async function getAdsInsights({ from, to } = {}) {
  try {
    const timeRange = JSON.stringify({ since: from, until: to });
    const fields = 'spend,clicks,impressions,reach,ctr,cpc,cpm,actions';
    const res = await eachAccount((id, tok) => Promise.all([
      ask('/act_' + id + '/insights', {
        fields,
        time_increment: '1',
        time_range: timeRange,
        limit: '400'
      }, tok),
      ask('/act_' + id + '/insights', {
        fields: 'campaign_name,' + fields,
        level: 'campaign',
        time_range: timeRange,
        limit: '100'
      }, tok)
    ]));

    const byDay = res.ok.flatMap(r => r.value[0]).concat(archiveDayRows(from, to));
    const campaigns = res.ok.flatMap(r => r.value[1]).concat(archiveCampaignRows(from, to));

    if (!reachable().length) res.failed.push(NO_ACCESS);

    const perDay = {};
    let spend = 0;
    let clicks = 0;
    let linkClicks = 0;
    let impressions = 0;
    let reach = 0;
    let leads = 0;

    for (const row of byDay) {
      const dayLeads = leadsFrom(row.actions);
      const dayLinkClicks = linkClicksFrom(row.actions);

      // Один и тот же день может прийти из двух кабинетов: складываем.
      const d = perDay[row.date_start] || (perDay[row.date_start] = { spend: 0, clicks: 0, linkClicks: 0, impressions: 0, leads: 0 });

      d.spend = Math.round((d.spend + Number(row.spend || 0)) * 100) / 100;
      d.clicks += Number(row.clicks || 0);
      d.linkClicks += dayLinkClicks;
      d.impressions += Number(row.impressions || 0);
      d.leads += dayLeads;
      spend += Number(row.spend || 0);
      clicks += Number(row.clicks || 0);
      linkClicks += dayLinkClicks;
      impressions += Number(row.impressions || 0);
      reach += Number(row.reach || 0);
      leads += dayLeads;
    }

    return {
      ok: true,
      partial: res.failed.length ? res.failed : null,
      spend: Math.round(spend * 100) / 100,
      clicks,
      linkClicks,
      impressions,
      reach,
      leads,
      ctr: impressions ? Math.round((clicks / impressions) * 10000) / 100 : null,
      cpc: clicks ? Math.round((spend / clicks) * 100) / 100 : null,
      cpm: impressions ? Math.round((spend / impressions) * 1000 * 100) / 100 : null,
      byDay: perDay,
      campaigns: campaigns
        .map(row => ({
          name: row.campaign_name,
          spend: Math.round(Number(row.spend || 0) * 100) / 100,
          clicks: Number(row.clicks || 0),
          linkClicks: linkClicksFrom(row.actions),
          impressions: Number(row.impressions || 0),
          leads: leadsFrom(row.actions)
        }))
        .sort((a, b) => b.spend - a.spend)
    };
  } catch (e) {
    return { ok: false, reason: 'Кабинет не ответил: ' + e.message };
  }
}

// Расход по каждому объявлению за период, по дням. Нужен growth-агенту, чтобы
// считать цену состоявшегося урока по креативу: расход объявления / пришедшие
// из /api/health/creatives. Суммы расхода наружу отдаются только под ключом.
export async function getAdsByAd({ from, to, daily = true } = {}) {
  try {
    const res = await eachAccount((id, tok) => ask('/act_' + id + '/insights', {
      fields: 'ad_id,ad_name,adset_name,campaign_name,spend,impressions,actions',
      level: 'ad',
      // По дням нужно growth-агенту; экрану креативов хватает одной строки на объявление,
      // и так ответ в разы меньше и быстрее.
      ...(daily ? { time_increment: '1' } : {}),
      time_range: JSON.stringify({ since: from, until: to }),
      limit: '500'
    }, tok));

    const rows = res.ok.flatMap(r => r.value).concat(archiveAdRows(from, to, daily));

    const ads = {};

    for (const row of rows) {
      const id = String(row.ad_id);
      const ad = ads[id] || (ads[id] = {
        ad_id: id,
        ad_name: row.ad_name,
        adset_name: row.adset_name,
        campaign_name: row.campaign_name,
        spend: 0,
        impressions: 0,
        linkClicks: 0,
        leads: 0,
        byDay: {}
      });
      const spend = Number(row.spend || 0);
      const clicks = linkClicksFrom(row.actions);
      const leads = leadsFrom(row.actions);

      ad.spend += spend;
      ad.impressions += Number(row.impressions || 0);
      ad.linkClicks += clicks;
      ad.leads += leads;
      ad.byDay[row.date_start] = { spend: Math.round(spend * 100) / 100, linkClicks: clicks, leads };
    }

    return {
      ok: true,
      ads: Object.values(ads)
        .map(a => ({ ...a, spend: Math.round(a.spend * 100) / 100 }))
        .sort((a, b) => b.spend - a.spend)
    };
  } catch (e) {
    return { ok: false, reason: 'Кабинет не ответил: ' + e.message };
  }
}

// Имя, статус и картинка объявления. Картинку просим у креатива отдельным
// запросом: только там можно задать размер превью, иначе Мета отдаёт 64 пикселя.
// Ссылки на картинки подписанные и живут несколько дней, поэтому не храним их,
// а спрашиваем при каждом открытии.
export async function getAdsMeta(ids) {
  // Без списка отдаём все объявления кабинета: так запрос можно пустить
  // параллельно с остальными, не дожидаясь, пока станут известны id.
  const list = ids ? Array.from(new Set(ids.map(String).filter(id => /^\d+$/.test(id)))) : null;

  if (list && !list.length) return { ok: true, ads: {} };

  try {
    // Объявления берём из кабинета, а не по списку id: среди id из заявок
    // бывают чужие и удалённые, и тогда Мета отклоняет весь пакет целиком.
    const wanted = list ? new Set(list) : null;
    // Постранично и небольшими порциями: большой ответ Мета отклоняет
    // («reduce the amount of data»). Размер превью задаём прямо в раскрытии
    // поля creative, иначе оно 64 пикселя.
    const res = await eachAccount(async (id, tok) => {
      const got = [];
      let next = new URL(API + '/act_' + id + '/ads');

      next.searchParams.set('fields', 'name,effective_status,adset{name},creative.thumbnail_width(480).thumbnail_height(480){thumbnail_url,image_url,video_id}');
      next.searchParams.set('limit', '50');
      next.searchParams.set('access_token', tok);

      for (let page = 0; next && page < 10; page++) {
        const resp = await fetch(next.toString(), { cache: 'no-store' });
        const data = await resp.json();

        if (data.error) throw new Error(data.error.message || 'Meta API error');

        got.push(...(data.data || []).map(ad => ({ ...ad, _account: id })));
        next = data.paging && data.paging.next ? new URL(data.paging.next) : null;
      }

      return got;
    });

    const rows = res.ok.flatMap(r => r.value).concat(archiveAdsMeta());

    const ads = {};

    for (const ad of rows) {
      const id = String(ad.id);

      if (wanted && !wanted.has(id)) continue;

      const c = ad.creative || {};

      adAccount[id] = ad._account;
      ads[id] = {
        name: ad.name || null,
        status: ad.effective_status || null,
        adset: ad.adset ? ad.adset.name : null,
        image: c.image_url || c.thumbnail_url || null,
        kind: c.video_id ? 'video' : (c.image_url || c.thumbnail_url ? 'image' : null)
      };
    }

    return { ok: true, ads };
  } catch (e) {
    return { ok: false, reason: 'Кабинет не ответил: ' + e.message, ads: {} };
  }
}

// Какому кабинету принадлежит объявление: запоминаем при чтении getAdsMeta,
// чтобы ссылка в Ads Manager открывала нужный кабинет, а не основной.
const adAccount = {};

export function adsManagerLink(adId) {
  return 'https://www.facebook.com/adsmanager/manage/ads/edit?act=' + (adAccount[String(adId)] || account()) + '&selected_ad_ids=' + adId;
}

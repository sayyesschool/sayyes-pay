// Замороженная история старого рекламного кабинета SAYYES EU (2374217879647651).
// 30.09.2026 SAY YES переехал в новый BM, кампании старого кабинета выключены,
// расход там больше не растёт. Историю один раз выгрузили из Meta API в JSON рядом,
// чтобы админка и цена урока по креативам не зависели от доступа к старому BM.
// Отдаём строки в том же виде, в каком их возвращает Graph API insights,
// поэтому metaAds.js складывает их с живыми данными без отдельной логики.
import OLD from './metaArchive-2374217879647651.json';

export const ARCHIVED_ACCOUNTS = [OLD.account];

const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to);

function actions(linkClicks, leads) {
  return [
    { action_type: 'link_click', value: String(linkClicks) },
    { action_type: 'lead', value: String(leads) }
  ];
}

// Строки уровня кабинета по дням.
export function archiveDayRows(from, to) {
  const days = {};

  for (const [date, , spend, impressions, clicks, linkClicks, leads, reach] of OLD.rows) {
    if (!inRange(date, from, to)) continue;

    const d = days[date] || (days[date] = { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0, reach: 0 });

    d.spend += spend;
    d.impressions += impressions;
    d.clicks += clicks;
    d.linkClicks += linkClicks;
    d.leads += leads;
    d.reach += reach;
  }

  return Object.entries(days).map(([date, d]) => ({
    date_start: date,
    spend: String(Math.round(d.spend * 100) / 100),
    clicks: String(d.clicks),
    impressions: String(d.impressions),
    // Охват по дню из кабинета, где он был выгружен; иначе сумма по объявлениям (оценка сверху).
    reach: String(OLD.accountReach[date] ?? d.reach),
    actions: actions(d.linkClicks, d.leads)
  }));
}

// Строки уровня кампаний за период.
export function archiveCampaignRows(from, to) {
  const camps = {};

  for (const [date, adId, spend, impressions, clicks, linkClicks, leads] of OLD.rows) {
    if (!inRange(date, from, to)) continue;

    const name = (OLD.ads[adId] || [])[2] || '(старый кабинет)';
    const c = camps[name] || (camps[name] = { spend: 0, impressions: 0, clicks: 0, linkClicks: 0, leads: 0 });

    c.spend += spend;
    c.impressions += impressions;
    c.clicks += clicks;
    c.linkClicks += linkClicks;
    c.leads += leads;
  }

  return Object.entries(camps).map(([name, c]) => ({
    campaign_name: name,
    spend: String(Math.round(c.spend * 100) / 100),
    clicks: String(c.clicks),
    impressions: String(c.impressions),
    actions: actions(c.linkClicks, c.leads)
  }));
}

// Строки уровня объявлений: по дням или одной строкой на объявление.
export function archiveAdRows(from, to, daily = true) {
  const out = {};

  for (const [date, adId, spend, impressions, , linkClicks, leads] of OLD.rows) {
    if (!inRange(date, from, to)) continue;

    const key = daily ? adId + '|' + date : adId;
    const [name, adset, campaign] = OLD.ads[adId] || [];
    const r = out[key] || (out[key] = {
      ad_id: adId, ad_name: name, adset_name: adset, campaign_name: campaign,
      date_start: date, spend: 0, impressions: 0, linkClicks: 0, leads: 0
    });

    r.spend += spend;
    r.impressions += impressions;
    r.linkClicks += linkClicks;
    r.leads += leads;
  }

  return Object.values(out).map(r => ({
    ad_id: r.ad_id,
    ad_name: r.ad_name,
    adset_name: r.adset_name,
    campaign_name: r.campaign_name,
    date_start: r.date_start,
    spend: String(Math.round(r.spend * 100) / 100),
    impressions: String(r.impressions),
    actions: actions(r.linkClicks, r.leads)
  }));
}

// Имена объявлений для экрана креативов. Картинок нет: ссылки Меты подписанные и протухают.
export function archiveAdsMeta() {
  return Object.entries(OLD.ads).map(([id, [name, adset]]) => ({
    id,
    name,
    effective_status: 'ARCHIVED',
    adset: { name: adset },
    creative: {},
    _account: OLD.account
  }));
}

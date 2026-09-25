// Расход и клики из рекламного кабинета. Без них в админке нет ни цены заявки,
// ни цены дошедшего, ни окупаемости — поэтому блок честно говорит, чего не хватает,
// а не притворяется нулями.
const API = 'https://graph.facebook.com/v21.0';

const token = () => process.env.META_ADS_TOKEN || '';
const account = () => String(process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

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

async function ask(path, params) {
  const url = new URL(API + path);

  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  url.searchParams.set('access_token', token());

  const resp = await fetch(url.toString(), { cache: 'no-store' });
  const data = await resp.json();

  if (data.error) throw new Error(data.error.message || 'Meta API error');

  return data.data || [];
}

export async function getAdsInsights({ from, to } = {}) {
  if (!token() || !account()) {
    return { ok: false, reason: 'Нет доступа к кабинету: не заданы META_ADS_TOKEN и META_AD_ACCOUNT_ID.' };
  }

  try {
    const timeRange = JSON.stringify({ since: from, until: to });
    const fields = 'spend,clicks,impressions,reach,ctr,cpc,cpm,actions';
    const [byDay, campaigns] = await Promise.all([
      ask('/act_' + account() + '/insights', {
        fields,
        time_increment: '1',
        time_range: timeRange,
        limit: '400'
      }),
      ask('/act_' + account() + '/insights', {
        fields: 'campaign_name,' + fields,
        level: 'campaign',
        time_range: timeRange,
        limit: '100'
      })
    ]);

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

      perDay[row.date_start] = {
        spend: Number(row.spend || 0),
        clicks: Number(row.clicks || 0),
        linkClicks: dayLinkClicks,
        impressions: Number(row.impressions || 0),
        leads: dayLeads
      };
      spend += Number(row.spend || 0);
      clicks += Number(row.clicks || 0);
      linkClicks += dayLinkClicks;
      impressions += Number(row.impressions || 0);
      reach += Number(row.reach || 0);
      leads += dayLeads;
    }

    return {
      ok: true,
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
export async function getAdsByAd({ from, to } = {}) {
  if (!token() || !account()) {
    return { ok: false, reason: 'Нет доступа к кабинету: не заданы META_ADS_TOKEN и META_AD_ACCOUNT_ID.' };
  }

  try {
    const rows = await ask('/act_' + account() + '/insights', {
      fields: 'ad_id,ad_name,adset_name,campaign_name,spend,impressions,actions',
      level: 'ad',
      time_increment: '1',
      time_range: JSON.stringify({ since: from, until: to }),
      limit: '500'
    });

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
  const list = Array.from(new Set((ids || []).map(String).filter(id => /^\d+$/.test(id))));

  if (!token() || !list.length) return { ok: Boolean(token()), ads: {} };

  try {
    // Объявления берём из кабинета, а не по списку id: среди id из заявок
    // бывают чужие и удалённые, и тогда Мета отклоняет весь пакет целиком.
    const wanted = new Set(list);
    // Постранично и небольшими порциями: большой ответ Мета отклоняет
    // («reduce the amount of data»). Размер превью задаём прямо в раскрытии
    // поля creative, иначе оно 64 пикселя.
    const rows = [];
    let next = new URL(API + '/act_' + account() + '/ads');

    next.searchParams.set('fields', 'name,effective_status,adset{name},creative.thumbnail_width(480).thumbnail_height(480){thumbnail_url,image_url,video_id}');
    next.searchParams.set('limit', '50');
    next.searchParams.set('access_token', token());

    for (let page = 0; next && page < 10; page++) {
      const resp = await fetch(next.toString(), { cache: 'no-store' });
      const data = await resp.json();

      if (data.error) throw new Error(data.error.message || 'Meta API error');

      rows.push(...(data.data || []));
      next = data.paging && data.paging.next ? new URL(data.paging.next) : null;
    }

    const ads = {};

    for (const ad of rows) {
      const id = String(ad.id);

      if (!wanted.has(id)) continue;

      const c = ad.creative || {};

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

export function adsManagerLink(adId) {
  return 'https://www.facebook.com/adsmanager/manage/ads/edit?act=' + account() + '&selected_ad_ids=' + adId;
}

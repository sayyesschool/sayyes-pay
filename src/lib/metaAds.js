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
    let impressions = 0;
    let reach = 0;
    let leads = 0;

    for (const row of byDay) {
      const dayLeads = leadsFrom(row.actions);

      perDay[row.date_start] = {
        spend: Number(row.spend || 0),
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        leads: dayLeads
      };
      spend += Number(row.spend || 0);
      clicks += Number(row.clicks || 0);
      impressions += Number(row.impressions || 0);
      reach += Number(row.reach || 0);
      leads += dayLeads;
    }

    return {
      ok: true,
      spend: Math.round(spend * 100) / 100,
      clicks,
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
          impressions: Number(row.impressions || 0),
          leads: leadsFrom(row.actions)
        }))
        .sort((a, b) => b.spend - a.spend)
    };
  } catch (e) {
    return { ok: false, reason: 'Кабинет не ответил: ' + e.message };
  }
}

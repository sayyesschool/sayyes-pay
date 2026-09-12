// Расход и клики из рекламного кабинета. Без них в админке нет ни цены заявки,
// ни цены дошедшего, ни окупаемости — поэтому блок честно говорит, чего не хватает,
// а не притворяется нулями.
const API = 'https://graph.facebook.com/v21.0';

const token = () => process.env.META_ADS_TOKEN || '';
const account = () => String(process.env.META_AD_ACCOUNT_ID || '').replace(/^act_/, '');

function range(days) {
  const shift = 3 * 60 * 60 * 1000;
  const to = new Date(Date.now() + shift).toISOString().slice(0, 10);
  const from = new Date(Date.now() + shift - (days - 1) * 86400000).toISOString().slice(0, 10);

  return { since: from, until: to };
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

export async function getAdsInsights(days = 30) {
  if (!token() || !account()) {
    return { ok: false, reason: 'Нет доступа к кабинету: не заданы META_ADS_TOKEN и META_AD_ACCOUNT_ID.' };
  }

  try {
    const timeRange = JSON.stringify(range(days));
    const [byDay, campaigns] = await Promise.all([
      ask('/act_' + account() + '/insights', {
        fields: 'spend,clicks,impressions,reach',
        time_increment: '1',
        time_range: timeRange,
        limit: '400'
      }),
      ask('/act_' + account() + '/insights', {
        fields: 'campaign_name,spend,clicks,impressions',
        level: 'campaign',
        time_range: timeRange,
        limit: '100'
      })
    ]);

    const perDay = {};
    let spend = 0;
    let clicks = 0;
    let impressions = 0;

    for (const row of byDay) {
      perDay[row.date_start] = {
        spend: Number(row.spend || 0),
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0)
      };
      spend += Number(row.spend || 0);
      clicks += Number(row.clicks || 0);
      impressions += Number(row.impressions || 0);
    }

    return {
      ok: true,
      spend: Math.round(spend * 100) / 100,
      clicks,
      impressions,
      byDay: perDay,
      campaigns: campaigns
        .map(row => ({
          name: row.campaign_name,
          spend: Math.round(Number(row.spend || 0) * 100) / 100,
          clicks: Number(row.clicks || 0),
          impressions: Number(row.impressions || 0)
        }))
        .sort((a, b) => b.spend - a.spend)
    };
  } catch (e) {
    return { ok: false, reason: 'Кабинет не ответил: ' + e.message };
  }
}

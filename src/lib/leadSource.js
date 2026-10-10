// Источник лида. Один модуль на всё: заявку, бот, аналитику, деньги.
// До 10.10.2026 источник нигде не хранился: аналитика считала «воронкой» любую
// оплату с заявкой, а бот писал «Новая заявка» без указания, откуда человек.
//
// meta      - заход с рекламы Меты (fbclid, ad_id, utm_source facebook/ig/...)
// telegram  - Mini App внутри Telegram (посевы, бот), канал в tgChannel
// direct    - воронка открыта без рекламных меток (сайт, прямая ссылка)
const META_UTM = ['facebook', 'fb', 'ig', 'instagram', 'meta', 'an', 'th', 'msg', 'messenger', 'threads'];

export const SOURCE_LABEL = { meta: 'Мета', telegram: 'Telegram', direct: 'Сайт / прямой заход', organic: 'Органика' };

export function leadSourceOf(booking) {
  if (!booking) return 'direct';
  if (booking.source === 'telegram' || booking.tgUserId) return 'telegram';
  if (booking.source === 'meta') return 'meta';

  const a = booking.attribution || {};
  const utm = String(a.utm_source || '').toLowerCase();

  if (utm === 'telegram' || utm === 'tg') return 'telegram';
  if (a.fbclid || a.ad_id || a.campaign_id || META_UTM.includes(utm)) return 'meta';

  return 'direct';
}

export function tgChannelOf(booking) {
  if (!booking || leadSourceOf(booking) !== 'telegram') return '';

  const a = booking.attribution || {};

  return String(booking.tgChannel || a.utm_campaign || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

// Строка для бота и карточки: «Мета · объявление 1202...», «Telegram · @cyprus_kipr».
export function sourceLine(booking) {
  const source = leadSourceOf(booking);

  if (source === 'telegram') {
    const channel = tgChannelOf(booking);

    return 'Telegram' + (channel ? ' · @' + channel : ' · канал не указан');
  }

  if (source === 'meta') {
    const ad = (booking.attribution || {}).ad_id;

    return 'Мета' + (ad ? ' · объявление ' + ad : '');
  }

  return SOURCE_LABEL.direct;
}

import { stripe } from '@/services/stripe';
import { kvKeys, kvMGet } from '@/lib/redis';

// Интро-оффер: два продукта в Stripe, которых нет в публичном прайсе.
// getProducts() отдаёт только товары с metadata.external_id, у этих её нет —
// поэтому на сайте они не появляются сами по себе, добраться до них можно
// только по ссылке, которую менеджер отправил из бота.
export const INTRO_WINDOW_HOURS = 72;

export const INTRO_PRODUCTS = {
  INTRO_IND: process.env.STRIPE_INTRO_IND_PRODUCT || 'prod_VAm4nbN37lshij',
  INTRO_GRP: process.env.STRIPE_INTRO_GRP_PRODUCT || 'prod_VAm8uI94bMXv5x'
};

export function isIntroPack(packId) {
  return Boolean(packId && INTRO_PRODUCTS[String(packId).toUpperCase()]);
}

// Прайс интро меняется редко, а дёргается на каждое нажатие кнопки в боте.
// Короткий кэш, чтобы не ходить в Stripe по три раза за одно меню.
let cache = null;
let cachedAt = 0;

export async function getIntroProducts() {
  if (cache && Date.now() - cachedAt < 5 * 60 * 1000) return cache;

  const items = [];

  for (const [externalId, productId] of Object.entries(INTRO_PRODUCTS)) {
    try {
      const product = await stripe.products.retrieve(productId, {
        expand: ['default_price']
      });
      const price = product.default_price;

      if (!price || !price.unit_amount) continue;

      items.push({
        external_id: externalId,
        price_id: price.id,
        product_id: product.id,
        group_id: 'INTRO',
        name: product.name,
        description: product.description || '',
        amount: price.unit_amount,
        currency: price.currency,
        price: price.unit_amount,
        intro: true
      });
    } catch (e) {
      console.error('Intro product error:', productId, e);
    }
  }

  cache = items;
  cachedAt = Date.now();

  return items;
}

export async function getIntroProduct(packId) {
  if (!isIntroPack(packId)) return null;

  const items = await getIntroProducts();

  return items.find(item => item.external_id === String(packId).toUpperCase()) || null;
}

export async function isIntroPriceId(priceId) {
  if (!priceId) return false;

  const items = await getIntroProducts();

  return items.some(item => item.price_id === priceId);
}

// Окно считается от отметки «Пришёл». Если менеджер отправит оффер повторно,
// в заявку кладётся новый introExpiresAt: лучше продать позже, чем не продать.
// 05.11.2026 (Дима): продления оффера нет. Если трое суток прошли, менеджер всё равно
// может отправить спецпредложение: такая ссылка живёт без срока (introNoExpiry),
// цепочку напоминаний не запускает, а контроль один - пакет покупается один раз на человека.
export function introExpiry(booking) {
  if (!booking) return null;
  if (booking.introNoExpiry) return null;

  if (booking.introExpiresAt) return new Date(booking.introExpiresAt);

  if (!booking.attended || !booking.attendanceMarkedAt) return null;

  return new Date(new Date(booking.attendanceMarkedAt).getTime() + INTRO_WINDOW_HOURS * 3600 * 1000);
}

export function introActive(booking) {
  if (booking && booking.introNoExpiry) return booking.attended === true && !booking.introPaid;

  const expiry = introExpiry(booking);

  return Boolean(expiry && expiry.getTime() > Date.now());
}

export function nextIntroExpiry() {
  return new Date(Date.now() + INTRO_WINDOW_HOURS * 3600 * 1000).toISOString();
}

// Можно ли менеджеру отправить спецпредложение: урок отмечен «Пришёл» и пакет ещё не куплен.
export function introCanSend(booking) {
  return Boolean(booking && booking.attended === true && !booking.introPaid);
}

// Что записать в заявку при отправке: внутри трёх суток срок не трогаем,
// после них ссылка становится бессрочной. Отсчёт заново не начинается никогда.
export function introSendPatch(booking) {
  if (introActive(booking) && !booking.introNoExpiry) return {};
  if (booking.introNoExpiry) return {};

  return { introNoExpiry: true, introNoExpiryAt: new Date().toISOString() };
}

// Один интро-пакет на человека: ищем оплаченное спецпредложение во всех его заявках
// (одна и та же почта, Telegram, телефон или чат с ботом).
export async function introUsedByPerson(booking) {
  if (!booking) return false;
  if (booking.introPaid) return true;

  const norm = v => String(v || '').trim().toLowerCase().replace(/^@/, '');
  const digits = v => String(v || '').replace(/\D/g, '');
  const mine = {
    email: norm(booking.email), tg: norm(booking.telegram),
    phone: digits(booking.phone), chat: String(booking.chatId || '')
  };
  const keys = await kvKeys('booking:*');
  const all = await kvMGet(keys);

  return all.some(b => b && b.id !== booking.id && b.introPaid && (
    (mine.email && norm(b.email) === mine.email) ||
    (mine.tg && norm(b.telegram) === mine.tg) ||
    (mine.phone && mine.phone.length >= 7 && digits(b.phone) === mine.phone) ||
    (mine.chat && String(b.chatId || '') === mine.chat)
  ));
}

// Срок оффера: 72 часа от КОНЦА урока, а не от нажатия «Пришёл» (06.11.2026,
// итоговая цепочка). Отметку иногда ставят на следующий день, и срок уезжал.
export function introDeadlineFor(booking) {
  if (booking && booking.slot && booking.slot !== 'no_time') {
    const [d, t] = String(booking.slot).split('_');
    const [y, mo, dd] = d.split('-').map(Number);
    const [hh, mm] = String(t).split(':').map(Number);

    if (![y, mo, dd, hh, mm].some(Number.isNaN)) {
      return new Date(Date.UTC(y, mo - 1, dd, hh - 3, mm) + 30 * 60 * 1000 + INTRO_WINDOW_HOURS * 3600 * 1000).toISOString();
    }
  }

  return nextIntroExpiry();
}

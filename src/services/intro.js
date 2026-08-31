import { stripe } from '@/services/stripe';

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
export function introExpiry(booking) {
  if (!booking) return null;

  if (booking.introExpiresAt) return new Date(booking.introExpiresAt);

  if (!booking.attended || !booking.attendanceMarkedAt) return null;

  return new Date(new Date(booking.attendanceMarkedAt).getTime() + INTRO_WINDOW_HOURS * 3600 * 1000);
}

export function introActive(booking) {
  const expiry = introExpiry(booking);

  return Boolean(expiry && expiry.getTime() > Date.now());
}

export function nextIntroExpiry() {
  return new Date(Date.now() + INTRO_WINDOW_HOURS * 3600 * 1000).toISOString();
}

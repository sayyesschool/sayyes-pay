// pages/api/products.js
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
const stripe = key ? new Stripe(key, { timeout: 10_000, maxNetworkRetries: 0 }) : null;

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!key) {
    return res.status(500).json({
      error: "STRIPE_SECRET_KEY missing. Заполни .env.local и перезапусти `npm run dev`.",
    });
  }

  try {
    // 1) Пытаемся быстро получить цены с развёрнутым product
    let resp;
    try {
      resp = await stripe.prices.list({ limit: 50, active: true, expand: ["data.product"] });
    } catch (e) {
      // 2) Если expand тормозит/падает — пробуем без него
      console.warn("prices.list with expand failed, fallback without expand:", e.message);
      resp = await stripe.prices.list({ limit: 50, active: true });
    }

    // Берём только разовые цены (не подписки)
    const raw = resp.data.filter((p) => !p.recurring);

    // Функция нормализации одного элемента
    const mapItem = async (p) => {
      let product = typeof p.product === "string" ? null : p.product;

      // если product не развёрнут — дотянем отдельно
      if (!product && typeof p.product === "string") {
        try {
          product = await stripe.products.retrieve(p.product);
        } catch (e) {
          console.warn("products.retrieve failed:", e.message, p.product);
        }
      }

      const external_id = p.metadata?.external_id || product?.metadata?.external_id || null;

      return {
        external_id,
        price_id: p.id,
        product_id: product?.id || (typeof p.product === "string" ? p.product : null),
        name: (product?.name || "").trim() || "Product",
        description: (product?.description || "").trim() || "",
        amount: p.unit_amount,                    // в центах
        currency: (p.currency || "").toUpperCase(),
        active: p.active,
      };
    };

    // Маппим последовательно (чтобы не зафлудить сетью при products.retrieve)
    const items = [];
    for (const p of raw) items.push(await mapItem(p));

    // ====== ФИЛЬТРЫ / СОРТИРОВКА (вставлено) ======
    const filtered = items
      .filter((it) => !!it.external_id)          // показываем только «наши» (есть external_id)
      // .filter((it) => it.currency === "EUR")   // (необязательно) только EUR
      // .filter((it) => it.active)               // (необязательно) только активные
      .sort(
        (a, b) =>
          (a.external_id || "").localeCompare(b.external_id || "") ||
          a.name.localeCompare(b.name)
      );
    // ==============================================

    return res.status(200).json({ items: filtered });
  } catch (e) {
    console.error("products endpoint error:", e);
    return res.status(500).json({ error: e.message, type: e.type || null });
  }
}

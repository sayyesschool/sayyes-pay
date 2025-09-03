// Импорт продуктов и цен в Stripe из CSV (one-off).
// CSV-колонки: external_id;name;description;price;currency;active
// Запуск (Test mode): export STRIPE_SECRET_KEY=sk_test_... && node scripts/import-products.cjs

const Stripe = require("stripe");
const fs = require("fs");
const csv = require("csv-parser");

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY не задан."); process.exit(1);
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// автоопределение разделителя и снятие BOM
function detectSeparator(sample) {
  const commas = (sample.match(/,/g) || []).length;
  const semis  = (sample.match(/;/g) || []).length;
  return semis > commas ? ";" : ",";
}
function readCsvSmart(path) {
  return new Promise((resolve, reject) => {
    const sample = fs.readFileSync(path, "utf8").slice(0, 2048);
    const separator = detectSeparator(sample);
    const rows = [];
    fs.createReadStream(path)
      .pipe(csv({ separator, mapHeaders: ({ header }) => header.replace(/^\uFEFF/, "").trim() }))
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve({ rows, separator }))
      .on("error", reject);
  });
}

async function findProductByExternalId(externalId) {
  let starting_after = undefined;
  while (true) {
    const res = await stripe.products.list({ limit: 100, starting_after });
    for (const p of res.data) {
      if ((p.metadata && p.metadata.external_id) === externalId) return p;
    }
    if (!res.has_more) break;
    starting_after = res.data[res.data.length - 1].id;
  }
  return null;
}

async function findMatchingPrice(productId, { unit_amount, currency }) {
  let starting_after = undefined;
  while (true) {
    const res = await stripe.prices.list({ product: productId, limit: 100, starting_after });
    for (const pr of res.data) {
      if (pr.recurring) continue; // нам нужны one-off
      if (pr.unit_amount !== unit_amount) continue;
      if ((pr.currency || "").toLowerCase() !== (currency || "").toLowerCase()) continue;
      return pr;
    }
    if (!res.has_more) break;
    starting_after = res.data[res.data.length - 1].id;
  }
  return null;
}

(async () => {
  const path = "scripts/products.csv";
  if (!fs.existsSync(path)) { console.error("❌ Не найден CSV:", path); process.exit(1); }

  const { rows, separator } = await readCsvSmart(path);
  console.log(`ℹ️ CSV прочитан. Разделитель: "${separator}". Строк: ${rows.length}`);
  if (rows.length) console.log("ℹ️ Первая строка:", rows[0]);

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; if (!r) continue;

    try {
      const external_id = String(r.external_id || "").trim();
      const name = String(r.name || "").trim();
      if (!external_id || !name) { console.warn(`⚠️ [row ${i+1}] нужен external_id и name`, r); continue; }

      const description = (r.description || "").trim() || undefined;
      const active = String(r.active ?? "true").toLowerCase() === "true";
      const currency = (r.currency || "eur").toLowerCase();

      const priceFloat = parseFloat(String(r.price).replace(",", "."));
      if (Number.isNaN(priceFloat)) { console.warn(`⚠️ [row ${i+1}] некорректная price: "${r.price}"`, r); continue; }
      const unit_amount = Math.round(priceFloat * 100);

      // 1) Product с metadata.external_id
      let product = await findProductByExternalId(external_id);
      if (!product) {
        product = await stripe.products.create({ name, description, active, metadata: { external_id } });
        console.log(`+ product created: [${external_id}] ${name} → ${product.id}`);
      } else {
        const needUpdate = product.name !== name ||
                           (product.description || "") !== (description || "") ||
                           product.active !== active;
        if (needUpdate) {
          product = await stripe.products.update(product.id, { name, description, active });
          console.log(`~ product updated: [${external_id}] ${name} → ${product.id}`);
        } else {
          console.log(`= product exists: [${external_id}] ${name} → ${product.id}`);
        }
      }

      // 2) Price (one-off) + metadata.external_id
      let price = await findMatchingPrice(product.id, { unit_amount, currency });
      if (!price) {
        price = await stripe.prices.create({
          currency, unit_amount, product: product.id, metadata: { external_id }
        });
        console.log(`+ price created: ${price.id} → ${(unit_amount/100).toFixed(2)} ${currency.toUpperCase()}`);
      } else {
        // если у цены нет metadata.external_id — добавим
        if (!price.metadata?.external_id) {
          await stripe.prices.update(price.id, { metadata: { ...(price.metadata||{}), external_id } });
        }
        console.log(`= price exists: ${price.id}`);
      }

      out.push({ external_id, product_id: product.id, price_id: price.id });
    } catch (e) {
      console.error(`❌ [row ${i+1}] error:`, e.message);
    }
  }

  fs.writeFileSync("scripts/stripe_map.json", JSON.stringify(out, null, 2), "utf-8");
  console.log(`\n✅ Mapping saved to scripts/stripe_map.json (items: ${out.length})`);
})();

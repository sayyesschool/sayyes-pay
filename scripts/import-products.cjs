// Импорт продуктов и цен в Stripe из CSV (one-off).
// CSV-колонки: external_id;name;description;price;currency;active
// Запуск (Test mode): export STRIPE_SECRET_KEY=sk_test_... && node scripts/import-products.cjs

const Stripe = require("stripe");
const fs = require("fs");
const csv = require("csv-parser");

if (!process.env.STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY не задан.");
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const path = "scripts/products.csv";

if (!fs.existsSync(path)) {
  console.error("❌ Не найден CSV:", path);
  process.exit(1);
}

(async () => {
  const { rows, separator } = await readCsvSmart(path);

  console.log(`ℹ️ CSV прочитан. Разделитель: "${separator}". Строк: ${rows.length}`);

  if (rows.length) {
    console.log("ℹ️ Первая строка:", rows[0]);
  }

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    if (!row) continue;

    try {
      const external_id = String(row.external_id || "").trim();
      const name = String(row.name || "").trim();

      if (!external_id || !name) {
        console.warn(`⚠️ [row ${i + 1}] нужен external_id и name`, row);
        continue;
      }

      const description = (row.description || "").trim() || undefined;
      const active = String(row.active ?? "true").toLowerCase() === "true";
      const currency = (row.currency || "eur").toLowerCase();
      const priceFloat = parseFloat(String(row.price).replace(",", "."));

      if (Number.isNaN(priceFloat)) {
        console.warn(`⚠️ [row ${i + 1}] некорректная price: "${row.price}"`, row);
        continue;
      }

      const unit_amount = Math.round(priceFloat * 100);

      // 1) Product с metadata.external_id
      let product = await findProductByExternalId(external_id);
      if (!product) {
        product = await stripe.products.create({
          name,
          description,
          active,
          metadata: { external_id }
        });
        console.log(`+ product created: [${external_id}] ${name} → ${product.id}`);
      } else {
        // если продукт архивный, а в CSV active=true — разархивируем (active:true)
        const shouldUnarchive = product.active === false && active === true;
        const needUpdate =
          product.name !== name ||
          (product.description || "") !== (description || "") ||
          product.active !== active ||
          shouldUnarchive;

        if (needUpdate) {
          product = await stripe.products.update(product.id, {
            name,
            description,
            active
          });
          console.log(`~ product updated: [${external_id}] ${name} → ${product.id} (active=${active})`);
        } else {
          console.log(`= product exists: [${external_id}] ${name} → ${product.id} (active=${product.active})`);
        }
      }

      // 2) Price (one-off) + metadata.external_id
      let price = await findMatchingPrice(product.id, {
        unit_amount,
        currency,
        onlyActive: true
      });
      if (!price) {
        price = await stripe.prices.create({
          currency,
          unit_amount,
          product: product.id,
          active, // цена сразу в нужном статусе
          metadata: { external_id },
        });
        console.log(`+ price created: ${price.id} → ${(unit_amount / 100).toFixed(2)} ${currency.toUpperCase()} (active=${active})`);
      } else {
        let updated = false;
        // добиваем external_id в metadata, если отсутствует
        if (!price.metadata?.external_id) {
          await stripe.prices.update(price.id, {
            metadata: { ...(price.metadata || {}), external_id }
          });
          updated = true;
        }
        // приводим статус цены к CSV (Stripe позволяет менять active у цены)
        if (typeof active === "boolean" && price.active !== active) {
          await stripe.prices.update(price.id, { active });
          updated = true;
        }
        console.log(`${updated ? "~" : "="} price ${updated ? "updated" : "exists"}: ${price.id} (active=${active})`);
      }

      out.push({
        external_id,
        product_id: product.id,
        price_id: price.id
      });
    } catch (e) {
      console.error(`❌ [row ${i + 1}] error:`, e.message);
    }
  }

  fs.writeFileSync("scripts/stripe_map.json", JSON.stringify(out, null, 2), "utf-8");
  console.log(`\n✅ Mapping saved to scripts/stripe_map.json (items: ${out.length})`);
})();

async function readCsvSmart(path) {
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

function detectSeparator(sample) {
  const commas = (sample.match(/,/g) || []).length;
  const semis = (sample.match(/;/g) || []).length;
  return semis > commas ? ";" : ",";
}

async function findProductByExternalId(externalId, { includeArchived = true } = {}) {
  const activeProducts = list(stripe.products, { active: true });
  for await (const p of activeProducts) {
    if (p.metadata?.external_id === externalId) return p;
  }

  if (!includeArchived) return null;

  const archivedProducts = list(stripe.products, { active: false });
  for await (const p of archivedProducts) {
    if (p.metadata?.external_id === externalId) return p;
  }

  return null;
}

async function findMatchingPrice(productId, { unit_amount, currency, onlyActive = true }) {
  const productPrices = list(stripe.prices, {
    product: productId,
    active: onlyActive ? true : undefined
  });

  for await (const p of productPrices) {
    if (p.recurring) continue; // только разовые
    if (onlyActive && !p.active) continue; // по умолчанию — только активные
    if (p.unit_amount !== unit_amount) continue;
    if ((p.currency || "").toLowerCase() !== (currency || "").toLowerCase()) continue;
    return p;
  }

  return null;
}

/** Итератор для постраничного получения всех объектов из Stripe API */
async function* list(items, query) {
  let starting_after = undefined;

  while (true) {
    const res = await items.list({
      limit: 100,
      ...query,
      starting_after
    });

    for (const p of res.data) {
      yield p;
    }

    if (!res.has_more) break;

    starting_after = res.data[res.data.length - 1].id;
  }
}
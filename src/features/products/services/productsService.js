import stripe from '@/lib/stripe';

export async function getProducts({ limit, active } = { limit: 50, active: true }) {
    let res;
    try {
        res = await stripe.prices.list({
            limit,
            active,
            expand: ["data.product"]
        });
    } catch (e) {
        res = await stripe.prices.list({
            limit,
            active
        });
    }

    const raw = res.data.filter((p) => !p.recurring);
    const items = await Promise.all(raw.map(mapItem));

    return items;
}

async function mapItem(p) {
    let product = typeof p.product === "string" ? null : p.product;

    if (!product && typeof p.product === "string") {
        try {
            product = await stripe.products.retrieve(p.product);
        } catch (e) { }
    }

    const external_id = p.metadata?.external_id || product?.metadata?.external_id || null;

    return {
        external_id,
        price_id: p.id,
        product_id: product?.id || (typeof p.product === "string" ? p.product : null),
        name: (product?.name || "").trim() || "Product",
        description: (product?.description || "").trim() || "",
        amount: p.unit_amount,
        currency: p.currency,
        price: p.unit_amount,
    };
};
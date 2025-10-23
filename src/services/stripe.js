import Stripe from "stripe";

const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = process.env;

export const stripe = new Stripe(STRIPE_SECRET_KEY);

export {stripe as default};

export const SESSION_COMPLETED_EVENT = 'checkout.session.completed';

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

    const raw = res.data.filter((p) => !p.recurring && !!p.metadata.external_id);
    const items = await Promise.all(raw.map(mapItem));

    return items.sort((a, b) => a.price - b.price);
}

async function mapItem(p) {
    let product = typeof p.product === "string" ? null : p.product;

    if (!product && typeof p.product === "string") {
        try {
            product = await stripe.products.retrieve(p.product);
        } catch (e) { }
    }

    const external_id = p.metadata?.external_id || product?.metadata?.external_id || null;
    const group_id = external_id.slice(0, -3);

    return {
        external_id,
        price_id: p.id,
        group_id,
        product_id: product?.id || (typeof p.product === "string" ? p.product : null),
        name: (product?.name || "").trim() || "Product",
        description: (product?.description || "").trim() || "",
        amount: p.unit_amount,
        currency: p.currency,
        price: p.unit_amount,
    };
}

export async function createCheckoutSession({
    email,
    price_id,
    baseUrl
} = {}) {
    const session = await stripe.checkout.sessions.create({
        mode: "payment",
        ui_mode: "hosted", // or "embedded"
        success_url: `${baseUrl}/thanks`,
        cancel_url: `${baseUrl}/`,
        // return_url: baseUrl, // for embedded mode
        line_items: [{ price: price_id, quantity: 1 }],
        customer_email: email,
        metadata: { email, price_id }
    });

    return session;
}

export async function getCheckoutSessionDataForPurchase(session) {
    const li = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 1,
        expand: ['data.price.product']
    });
    const first = li.data?.[0];
    const price = first?.price;
    const product = typeof price?.product === 'string'
        ? null
        : price?.product;
    const externalId = price?.metadata?.external_id || product?.metadata?.external_id || null;
    const name = product?.name || 'Product';
    const label = externalId ? `[${externalId}] ${name}` : name;
    const email = session.customer_details?.email || session.metadata?.email || null;

    return {
        externalId,
        amount: session.amount_total,
        currency: session.currency,
        status: 'paid',
        label,
        email,
        sessionId: session.id,
        metadata: {
            ...price?.metadata,
            ...product?.metadata,
            ...session.metadata
        }
    };
}

export async function getWebhookEvent(request) {
    try {
        const buf = await request.arrayBuffer();
        const sig = request.headers.get('stripe-signature');
        const event = stripe.webhooks.constructEvent(Buffer.from(buf), sig, STRIPE_WEBHOOK_SECRET);
        return event;
    } catch (error) {
        throw new Error(`Webhook error: ${error.message}`, {
            cause: { code: 400 }
        });
    }
}
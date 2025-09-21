import stripe from '@/lib/stripe';

export const SESSION_COMPLETED_EVENT = 'checkout.session.completed';

export async function createCheckoutSession({
    email,
    price_id,
    baseUrl
} = {}) {
    const session = await stripe.checkout.sessions.create({
        mode: "payment",
        ui_mode: "embedded",
        // success_url: `${baseUrl}/thanks`,
        // cancel_url: `${baseUrl}/`,
        return_url: baseUrl,
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
    const product = typeof price?.product === 'string' ? null : price?.product;
    const external_id = price?.metadata?.external_id || product?.metadata?.external_id || null;
    const name = product?.name || 'Product';
    const label = external_id ? `[${external_id}] ${name}` : name;
    const email = session.customer_details?.email || session.metadata?.email || null;

    return {
        email,
        amount: session.amount_total,
        currency: session.currency,
        product: label,
        provider: 'stripe',
        provider_invoice_id: session.id,
        status: 'paid',
        external_id,
    };
}
import Stripe from "stripe";

const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = process.env;

export default new Stripe(STRIPE_SECRET_KEY);

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
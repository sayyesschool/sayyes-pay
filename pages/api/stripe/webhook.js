import Stripe from 'stripe';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

export const config = { api: { bodyParser: false } };

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', c => chunks.push(Buffer.from(c)));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).end('Method Not Allowed'); }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Заберём первый line item и развёрнутый продукт
    const li = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 1, expand: ['data.price.product']
    });
    const first = li.data?.[0];
    const price = first?.price;
    const product = typeof price?.product === 'string' ? null : price?.product;

    const external_id = price?.metadata?.external_id || product?.metadata?.external_id || null;
    const name = product?.name || 'Product';
    const label = external_id ? `[${external_id}] ${name}` : name;

    const email = session.customer_details?.email || session.metadata?.email || null;

    await supabaseAdmin.from('purchases').insert({
      email,
      amount: session.amount_total,
      currency: session.currency,
      product: label,
      payment_provider: 'stripe',
      provider_invoice_id: session.payment_intent || session.id,
      status: 'succeeded'
    });
  }

  return res.status(200).json({ received: true });
}

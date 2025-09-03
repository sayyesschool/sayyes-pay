import stripe from '@/lib/stripe';

export const config = { api: { bodyParser: false } };

export async function POST(request) {
  const sig = request.headers.get('stripe-signature');
  let event;

  try {
    const buf = await request.arrayBuffer();
    event = stripe.webhooks.constructEvent(Buffer.from(buf), sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const li = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1, expand: ['data.price.product'] });
    const first = li.data?.[0];
    const price = first?.price;
    const product = typeof price?.product === 'string' ? null : price?.product;
    const external_id = price?.metadata?.external_id || product?.metadata?.external_id || null;
    const name = product?.name || 'Product';
    const label = external_id ? `[${external_id}] ${name}` : name;
    const email = session.customer_details?.email || session.metadata?.email || null;

    await supabase.from('purchases').insert({
      email,
      amount: session.amount_total,
      currency: session.currency,
      product: label,
      provider: 'stripe',
      provider_invoice_id: session.id,
      status: 'paid',
      external_id,
    });
  }

  return new Response('ok', { status: 200 });
}

import stripe from '@/lib/stripe';

export async function POST(request) {
  try {
    const { email, price_id } = await request.json();

    if (!email) return new Response(JSON.stringify({ error: "Нет email. Сначала войдите." }), { status: 400 });
    if (!price_id) return new Response(JSON.stringify({ error: "Не передан price_id." }), { status: 400 });
    
    const origin = request.headers.get('origin') || '';
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${origin}/thanks`,
      cancel_url: `${origin}/`,
      line_items: [{ price: price_id, quantity: 1 }],
      customer_email: email,
      metadata: { email, price_id }
    });
    return new Response(JSON.stringify({ url: session.url }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}

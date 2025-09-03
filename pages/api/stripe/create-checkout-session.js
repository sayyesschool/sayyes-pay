import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { email, price_id } = req.body || {};
    if (!email) return res.status(400).json({ error: "Нет email. Сначала войдите." });
    if (!price_id) return res.status(400).json({ error: "Не передан price_id." });

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${origin}/thanks`,
      cancel_url: `${origin}/`,
      line_items: [{ price: price_id, quantity: 1 }],
      customer_email: email,
      metadata: { email, price_id }
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}

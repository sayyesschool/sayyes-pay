export async function GET(request) {
  return new Response(JSON.stringify({
    STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET,
    PAYPAL_API_URL: !!process.env.PAYPAL_API_URL,
    PAYPAL_CLIENT_ID: !!process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: !!process.env.PAYPAL_CLIENT_SECRET,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

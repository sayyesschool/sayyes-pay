// lib/paypal.js
export async function getAccessToken() {
  const base = process.env.PAYPAL_API_URL; // для sandbox: https://api-m.sandbox.paypal.com
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;

  if (!base || !id || !secret) {
    throw new Error("PayPal env missing: PAYPAL_API_URL / PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET");
  }

  const auth = Buffer.from(`${id}:${secret}`).toString("base64");

  const resp = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await resp.json();

  if (!resp.ok) {
    // Печатаем понятную причину
    console.error("PayPal OAuth failed:", resp.status, data);
    throw new Error(`PayPal OAuth failed: ${resp.status} ${data.error || data.error_description || ""}`);
  }

  if (!data?.access_token) {
    console.error("PayPal OAuth: no access_token in response:", data);
    throw new Error("PayPal OAuth: no access_token");
  }

  return data.access_token;
}

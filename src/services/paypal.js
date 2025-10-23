const base = process.env.PAYPAL_API_URL; // для sandbox: https://api-m.sandbox.paypal.com
const id = process.env.PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_CLIENT_SECRET;

export async function getAccessToken() {
  if (!base || !id || !secret) {
    throw new Error("PayPal env missing: PAYPAL_API_URL / PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET");
  }

  const token = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();

  if (!res.ok) {
    console.error("PayPal OAuth failed:", res.status, data);
    throw new Error(`PayPal OAuth failed: ${res.status} ${data.error || data.error_description || ""}`);
  }

  if (!data?.access_token) {
    console.error("PayPal OAuth: no access_token in response:", data);
    throw new Error("PayPal OAuth: no access_token");
  }

  return data.access_token;
}

export async function createOrder(data) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${base}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: 'EUR',
            value: data.amount,
          },
        },
      ],
    }),
  });

  const resData = await res.json();

  if (!res.ok) {
    throw new Error('Failed to create order', { reason: resData });
  }

  return resData;
}

export async function captureOrder(orderId) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${base}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error('Failed to capture order', { reason: data });
  }

  return res.json();
}
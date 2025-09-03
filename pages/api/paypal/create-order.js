// pages/api/paypal/create-order.js
import { getAccessToken } from "../../../lib/paypal";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    console.log("👉 Incoming body:", req.body);

    // получаем access token у PayPal
    const accessToken = await getAccessToken();
    console.log("✅ Got PayPal access token:", accessToken ? "yes" : "no");

    // создаём заказ
    const orderRes = await fetch(`${process.env.PAYPAL_API_URL}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "EUR", // или USD
              value: req.body.amount,
            },
          },
        ],
      }),
    });

    const orderData = await orderRes.json();
    console.log("👉 PayPal order response:", orderData);

    if (!orderRes.ok) {
      return res
        .status(500)
        .json({ error: "Failed to create order", details: orderData });
    }

    res.status(200).json(orderData);
  } catch (err) {
    console.error("❌ PayPal create order error:", err);
    res.status(500).json({ error: "Unexpected server error", details: err.message });
  }
}

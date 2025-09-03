// pages/api/paypal/capture-order.js
import { getAccessToken } from "../../../lib/paypal";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const { orderID } = req.body;

    const accessToken = await getAccessToken();

    const response = await fetch(`${process.env.PAYPAL_API_URL}/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    console.error("PayPal capture order error:", err);
    res.status(500).json({ error: "Failed to capture PayPal order" });
  }
}

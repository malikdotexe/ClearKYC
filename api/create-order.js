export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const keyId = (process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || "").trim();

  if (!keyId || !keySecret) {
    return res.status(500).json({ error: "Razorpay keys not configured" });
  }

  const { amount = 100, currency = "INR", bankName = "Bank", purpose = "KYC Verification" } = req.body;

  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount: Number(amount),
        currency,
        receipt: `clearkyc_${Date.now()}`,
        notes: { bankName, purpose },
      }),
    });

    const order = await response.json();

    if (order.error) {
      return res.status(400).json({ error: order.error.description });
    }

    return res.status(200).json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to create order", details: err.message });
  }
}

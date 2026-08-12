// Vercel serverless function.
// Confirms whether a ZapUPI order was actually paid, server-side.
// Always trust THIS check, not just the redirect the browser came back on.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  const zapKey = process.env.ZAPUPI_KEY;
  if (!zapKey) {
    return res.status(500).json({ status: 'error', message: 'Server is not configured with ZAPUPI_KEY yet.' });
  }

  const { order_id } = req.body || {};
  if (!order_id) {
    return res.status(400).json({ status: 'error', message: 'order_id is required.' });
  }

  try {
    const zapRes = await fetch('https://pay.zapupi.com/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zap_key: zapKey, order_id: String(order_id) })
    });

    const data = await zapRes.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Could not reach ZapUPI right now.' });
  }
}

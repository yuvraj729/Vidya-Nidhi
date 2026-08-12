// Vercel serverless function.
// Creates a ZapUPI payment order. The zap_key (secret) stays here on the
// server and is read from an environment variable — it is never sent to
// the browser, so it's safe even though this project is a public repo.
//
// Set ZAPUPI_KEY in Vercel: Project Settings -> Environment Variables.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method not allowed' });
  }

  const zapKey = process.env.ZAPUPI_KEY;
  if (!zapKey) {
    return res.status(500).json({ status: 'error', message: 'Server is not configured with ZAPUPI_KEY yet.' });
  }

  const { order_id, amount, customer_mobile, remark } = req.body || {};

  if (!order_id || !amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ status: 'error', message: 'order_id and a valid amount are required.' });
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    const zapRes = await fetch('https://pay.zapupi.com/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zap_key: zapKey,
        order_id: String(order_id),
        amount: String(amount),
        customer_mobile: customer_mobile || '9999999999',
        remark: remark || 'Scholarship application fee',
        success_url: `${origin}/#payment-return`,
        failed_url: `${origin}/#payment-return`,
        timeout_url: `${origin}/#payment-return`
      })
    });

    const data = await zapRes.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ status: 'error', message: 'Could not reach ZapUPI right now.' });
  }
}

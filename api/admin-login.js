// Vercel serverless function.
// Checks the admin password against an environment variable so the real
// password never appears in the frontend bundle or the public repo.
//
// Set ADMIN_PASSWORD in Vercel: Project Settings -> Environment Variables.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const correctPassword = process.env.ADMIN_PASSWORD;
  if (!correctPassword) {
    return res.status(500).json({ success: false, message: 'Server is not configured with ADMIN_PASSWORD yet.' });
  }

  const { password } = req.body || {};
  if (password === correctPassword) {
    return res.status(200).json({ success: true });
  }
  return res.status(200).json({ success: false, message: 'Incorrect password.' });
}

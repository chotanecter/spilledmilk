// /api/identify — captures NFC keychain holder identification
// POST { name, id, returning, ts, ua, lang, tz, ref, path }
//
// MVP behavior: logs to Vercel's runtime logs (visible in the Vercel dashboard
// under the project's Logs tab). To persist for the dashboard, wire one of:
//   - Vercel KV / Postgres / Blob
//   - Airtable (fetch https://api.airtable.com/...)
//   - Notion Database (fetch https://api.notion.com/...)
//   - Supabase (fetch https://<proj>.supabase.co/rest/v1/...)
//
// Use environment variables in Vercel project settings for any API keys.

export default async function handler(req, res) {
  // CORS — allow the keychain page (same origin in prod, useful for staging)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { name, id, returning, ts, ua, lang, tz, ref, path } = body;

    // Basic validation
    if (!name || typeof name !== 'string' || name.length > 100) {
      return res.status(400).json({ error: 'invalid name' });
    }

    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.headers['x-real-ip'] ||
      null;

    const record = {
      name: name.slice(0, 100),
      keychain_id: id || null,
      returning_visitor: !!returning,
      tapped_at: ts ? new Date(ts).toISOString() : new Date().toISOString(),
      ip,
      ua: (ua || '').slice(0, 400),
      lang: lang || null,
      timezone: tz || null,
      referrer: ref || null,
      path: path || '/',
      country: req.headers['x-vercel-ip-country'] || null,
      region: req.headers['x-vercel-ip-country-region'] || null,
      city: req.headers['x-vercel-ip-city'] ? decodeURIComponent(req.headers['x-vercel-ip-city']) : null
    };

    // Visible in Vercel → Project → Logs
    console.log('[SM identify]', JSON.stringify(record));

    // -------- WIRE PERSISTENCE BELOW --------
    // Example (Airtable):
    // if (process.env.AIRTABLE_TOKEN && process.env.AIRTABLE_BASE) {
    //   await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE}/Keychains`, {
    //     method: 'POST',
    //     headers: {
    //       'Authorization': `Bearer ${process.env.AIRTABLE_TOKEN}`,
    //       'Content-Type': 'application/json'
    //     },
    //     body: JSON.stringify({ fields: record })
    //   });
    // }
    // ----------------------------------------

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[SM identify] error', err);
    return res.status(500).json({ error: 'failed' });
  }
}

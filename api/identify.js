// /api/identify — captures NFC keychain holder identification
// POST { name, user_id, keychain_id, returning, ts, ua, lang, tz, ref, path }
//   - user_id     : device-bound random id we generate in the browser
//   - keychain_id : the ?k=NNN value printed on the physical NFC tag
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
    const { name, id, user_id, keychain_id, returning, ts, ua, lang, tz, ref, path, event } = body;

    // Resolve event type. "tap" is the default — fired when the name modal is
    // first completed (or on every return tap). "play_start" is fired when the
    // trailer iframe is loaded. Future: "play_complete", "tab_switch", etc.
    const eventType = (typeof event === 'string' && /^[a-z_]{1,32}$/.test(event)) ? event : 'tap';

    // Name is required for tap events. For non-tap events (play_start) the
    // client may still send the stored name, but we don't reject if it's empty.
    if (eventType === 'tap') {
      if (!name || typeof name !== 'string' || name.length > 100) {
        return res.status(400).json({ error: 'invalid name' });
      }
    }
    const safeName = (typeof name === 'string' && name.length <= 100) ? name : '';

    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.headers['x-real-ip'] ||
      null;

    // Resolve keychain_id: prefer explicit field, else parse ?k= from path,
    // else fall back to legacy `id` field for back-compat with first-deploy clients.
    let keychainId = (keychain_id || '').toString().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || null;
    if (!keychainId && typeof path === 'string' && path.includes('?')) {
      const m = path.match(/[?&]k=([a-zA-Z0-9_-]{1,16})/);
      if (m) keychainId = m[1];
    }
    if (!keychainId && id && typeof id === 'string' && !id.startsWith('sm_')) {
      keychainId = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || null;
    }

    const userId = (
      user_id ||
      (id && typeof id === 'string' && id.startsWith('sm_') ? id : '') ||
      ''
    ).toString().slice(0, 64) || null;

    const record = {
      name: safeName.slice(0, 100) || null,
      event: eventType,
      keychain_id: keychainId,
      user_id: userId,
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

    // -------- Airtable persistence --------
    // Requires three env vars on Vercel:
    //   AIRTABLE_TOKEN  — personal access token with data.records:write scope
    //   AIRTABLE_BASE   — base id, looks like appXXXXXXXXXXXXXX
    //   AIRTABLE_TABLE  — table name, e.g. "Taps" (defaults to "Taps")
    //
    // Field names in the Airtable table must match these exactly (case-sensitive):
    //   Name, Keychain ID, User ID, Returning, Tapped At, IP,
    //   User Agent, Language, Timezone, Referrer, Path,
    //   Country, Region, City
    //
    // We fail silently if Airtable errors out — the tap experience must not break.
    // Defensive: trim whitespace/newlines and chop off anything after a slash
    // in the base id (in case someone pasted "appXXX/tblYYY").
    const AT_TOKEN = (process.env.AIRTABLE_TOKEN || '').trim();
    const AT_BASE  = (process.env.AIRTABLE_BASE  || '').trim().split('/')[0];
    const AT_TABLE = (process.env.AIRTABLE_TABLE || 'Taps').trim();
    if (AT_TOKEN && AT_BASE) {
      const tableName = encodeURIComponent(AT_TABLE);
      const fields = {
        'Name': record.name,
        'Event': record.event,
        'Keychain ID': record.keychain_id,
        'User ID': record.user_id,
        'Returning': record.returning_visitor,
        'Tapped At': record.tapped_at,
        'IP': record.ip,
        'User Agent': record.ua,
        'Language': record.lang,
        'Timezone': record.timezone,
        'Referrer': record.referrer,
        'Path': record.path,
        'Country': record.country,
        'Region': record.region,
        'City': record.city
      };
      try {
        const airResp = await fetch(
          `https://api.airtable.com/v0/${AT_BASE}/${tableName}`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${AT_TOKEN}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields, typecast: true })
          }
        );
        if (!airResp.ok) {
          const errBody = await airResp.text();
          console.warn('[SM identify] airtable', airResp.status, errBody.slice(0, 300));
        }
      } catch (airErr) {
        console.warn('[SM identify] airtable network error', airErr && airErr.message);
      }
    }
    // --------------------------------------

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[SM identify] error', err);
    return res.status(500).json({ error: 'failed' });
  }
}

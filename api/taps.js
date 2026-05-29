// /api/taps — reads tap records from Airtable for the dashboard
//
// GET /api/taps                  → returns up to 1000 most-recent taps
// GET /api/taps?limit=200        → limit (max 1000)
// GET /api/taps?since=ISODATE    → only taps after a given timestamp
//
// Returns: { ok: true, count: N, taps: [...], updated_at: ISO }
//
// Each tap: {
//   id, name, keychain_id, user_id, returning, tapped_at,
//   city, region, country, timezone, lang, path
// }
//
// IMPORTANT: The Airtable token NEVER leaves the server. The client
// only ever sees the deduplicated/anonymised tap records.

const AIRTABLE_API = 'https://api.airtable.com/v0';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'GET only' });

  // Defensive: trim whitespace/newlines that frequently sneak in when env vars
  // are pasted into Vercel's UI, and chop off anything after the first slash in
  // the base id (people sometimes paste "appXXX/tblYYY" by mistake).
  const TOKEN = (process.env.AIRTABLE_TOKEN || '').trim();
  const BASE  = (process.env.AIRTABLE_BASE  || '').trim().split('/')[0];
  const TABLE = (process.env.AIRTABLE_TABLE || 'Taps').trim();

  if (!TOKEN || !BASE) {
    return res.status(200).json({
      ok: true,
      configured: false,
      count: 0,
      taps: [],
      updated_at: new Date().toISOString(),
      hint: 'Set AIRTABLE_TOKEN and AIRTABLE_BASE env vars in Vercel.'
    });
  }

  const url = new URL(req.url, 'http://x');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000', 10) || 1000, 1000);
  const since = url.searchParams.get('since');

  // Build Airtable filter
  let filterByFormula = '';
  if (since) {
    // IS_AFTER({Tapped At}, '2026-05-28T...')
    const safe = since.replace(/'/g, '');
    filterByFormula = `IS_AFTER({Tapped At}, '${safe}')`;
  }

  try {
    const all = [];
    let offset = undefined;
    let pages = 0;

    while (true) {
      const params = new URLSearchParams();
      params.set('pageSize', '100');
      params.set('sort[0][field]', 'Tapped At');
      params.set('sort[0][direction]', 'desc');
      if (filterByFormula) params.set('filterByFormula', filterByFormula);
      if (offset) params.set('offset', offset);

      const r = await fetch(
        `${AIRTABLE_API}/${BASE}/${encodeURIComponent(TABLE)}?${params.toString()}`,
        {
          headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Accept': 'application/json'
          }
        }
      );
      if (!r.ok) {
        const errBody = await r.text();
        return res.status(200).json({
          ok: false,
          configured: true,
          error: `airtable_${r.status}`,
          detail: errBody.slice(0, 400),
          count: 0,
          taps: []
        });
      }
      const json = await r.json();
      for (const rec of (json.records || [])) {
        const f = rec.fields || {};
        all.push({
          id: rec.id,
          name: f['Name'] || null,
          event: (f['Event'] || 'tap').toString().toLowerCase(),
          keychain_id: f['Keychain ID'] || null,
          user_id: f['User ID'] || null,
          returning: !!f['Returning'],
          tapped_at: f['Tapped At'] || rec.createdTime || null,
          city: f['City'] || null,
          region: f['Region'] || null,
          country: f['Country'] || null,
          timezone: f['Timezone'] || null,
          lang: f['Language'] || null,
          path: f['Path'] || null
        });
        if (all.length >= limit) break;
      }
      if (all.length >= limit) break;
      offset = json.offset;
      pages++;
      if (!offset || pages > 20) break; // hard ceiling = 2000 records
    }

    return res.status(200).json({
      ok: true,
      configured: true,
      count: all.length,
      taps: all,
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      configured: true,
      error: 'network',
      detail: err && err.message,
      count: 0,
      taps: []
    });
  }
}

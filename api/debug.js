// /api/debug — diagnostic only. Shows which env vars are set and what URL
// the taps endpoint would hit. Safe to expose: tokens are masked.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const TOKEN = process.env.AIRTABLE_TOKEN || '';
  const BASE  = process.env.AIRTABLE_BASE || '';
  const TABLE = process.env.AIRTABLE_TABLE || 'Taps (default)';

  const masked = (s) => {
    if (!s) return null;
    if (s.length <= 8) return '****';
    return s.slice(0, 4) + '…' + s.slice(-4) + ' (' + s.length + ' chars)';
  };

  const config = {
    AIRTABLE_TOKEN_set: !!TOKEN,
    AIRTABLE_TOKEN_preview: masked(TOKEN),
    AIRTABLE_BASE_set: !!BASE,
    AIRTABLE_BASE_value: BASE || null,  // not a secret
    AIRTABLE_TABLE_set: !!process.env.AIRTABLE_TABLE,
    AIRTABLE_TABLE_value: TABLE,
  };

  const wouldHit = (BASE && TABLE)
    ? `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE.replace(' (default)',''))}?pageSize=1`
    : '(missing base or table)';

  // If allowed, do a live test ping to Airtable and report status
  let liveCheck = { attempted: false };
  if (TOKEN && BASE) {
    liveCheck.attempted = true;
    try {
      const r = await fetch(wouldHit, {
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Accept': 'application/json'
        }
      });
      const bodyText = await r.text();
      liveCheck.status = r.status;
      liveCheck.ok = r.ok;
      liveCheck.body = bodyText.slice(0, 500);
    } catch (err) {
      liveCheck.error = err && err.message;
    }
  }

  return res.status(200).json({
    ok: true,
    note: 'Diagnostic only. Tokens are masked. Safe to share for debugging.',
    config,
    would_hit: wouldHit,
    live_check: liveCheck,
    troubleshooting: {
      '404_NOT_FOUND': 'AIRTABLE_BASE wrong, AIRTABLE_TABLE wrong, OR token has no access to that base. Fix at airtable.com/create/tokens → edit token → Access.',
      '401_unauthorized': 'AIRTABLE_TOKEN expired or wrong.',
      '422_invalid_field': 'A column name in the request (Tapped At, etc.) doesn\'t exist in your Airtable table.',
      '_remember': 'After changing env vars in Vercel you MUST redeploy for them to take effect.'
    }
  });
}

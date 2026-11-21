// GET /api/shop: today's Item Shop in the data/shop.json shape, with "last seen" dates from the
// shop history the record-shop Edge Function keeps in Supabase. Cached on the CDN until the
// next daily reset (00:00 UTC), so fortnite-api.com and Supabase are hit about once a day per region.
import { fetchShop, bestOffers, shopPayload } from '../lib/shop.mjs';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

const DAY = 864e5;
const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
let cache = null; // { payload, until } for warm instances (and the local server)

async function history(best) {
  const ids = [...best.keys()];
  const [seen, since] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/rpc/shop_last_seen`, {
      method: 'POST', headers, body: JSON.stringify({ p_ids: ids, p_before: ids.map((id) => best.get(id).inDate) }),
    }),
    fetch(`${SUPABASE_URL}/rest/v1/shop_days?select=shop_date&order=shop_date.asc&limit=1`, { headers }),
  ]);
  if (!seen.ok || !since.ok) throw new Error(`history: HTTP ${seen.status}/${since.status}`);
  const lastSeen = new Map((await seen.json()).map((r) => [r.item_id, r.last_seen]));
  const trackingSince = (await since.json())[0]?.shop_date ?? null;
  return { lastSeen, trackingSince };
}

// Seconds until shortly after the next reset; only a minute or two if the API still has yesterday's shop.
function cacheSeconds(shopDate) {
  const now = Date.now();
  if (shopDate !== new Date(now).toISOString().slice(0, 10)) return 120;
  const nextReset = Math.ceil((now + 1) / DAY) * DAY + 2 * 60e3;
  return Math.max(60, Math.round((nextReset - now) / 1000));
}

export async function GET() {
  try {
    if (!cache || Date.now() > cache.until) {
      const shop = await fetchShop();
      const best = bestOffers(shop);
      let hist, ok = true;
      try { hist = await history(best); } catch (e) {
        console.error(e); ok = false; // still show the shop, without last-seen dates
        hist = { lastSeen: new Map(), trackingSince: null };
      }
      const payload = shopPayload(shop, best, hist.lastSeen, hist.trackingSince ?? String(shop.date).slice(0, 10));
      const ttl = ok ? cacheSeconds(payload.date) : 120;
      cache = { payload: JSON.stringify(payload), ttl, until: Date.now() + ttl * 1000 };
    }
    const left = Math.max(1, Math.round((cache.until - Date.now()) / 1000));
    return new Response(cache.payload, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=60, s-maxage=${left}, stale-while-revalidate=300`,
      },
    });
  } catch (e) {
    console.error(e);
    return Response.json({ error: 'Shop unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

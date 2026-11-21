// GET /api/cosmetics: the combo builder's catalog (same shape as data/cosmetics.json), built from
// fortnite-api.com so new items show up without a redeploy. Cached on the CDN for 6 hours.
import { fetchCatalog } from '../lib/catalog.mjs';

const TTL = 6 * 3600;
let cache = null; // { body, until } for warm instances (and the local server)

export async function GET() {
  try {
    if (!cache || Date.now() > cache.until) {
      cache = { body: JSON.stringify(await fetchCatalog()), until: Date.now() + TTL * 1000 };
    }
    const left = Math.max(1, Math.round((cache.until - Date.now()) / 1000));
    return new Response(cache.body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=3600, s-maxage=${left}, stale-while-revalidate=86400`,
      },
    });
  } catch (e) {
    console.error(e);
    // The browser falls back to the data/cosmetics.json copy deployed with the site.
    return Response.json({ error: 'Catalog unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

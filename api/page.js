// Every page of the live site (/, /combo-builder, /contact, …): index.html with the page's own title,
// description, canonical link and robots rule, link-preview tags (so combo share links show the combo's
// name and picture in Discord, iMessage, X and so on), and today's shop drawn in as plain HTML for search
// engines. Old ?view= links get a permanent redirect; an unknown ?view= gets a 404.
// vercel.json rewrites each page's path here (keep its list in step with lib/views.js).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { previewTags, renderPage, route, siteOrigin } from '../lib/page.mjs';
import { SUPABASE_URL } from '../config.js';

let html = null;
let names = null; // item id -> name, from the catalog deployed with the site
let shopCache = null; // { shop, until }

async function nameOf(slot, id) {
  names ??= readFile(join(process.cwd(), 'data', 'cosmetics.json'), 'utf8')
    .then((t) => new Map(JSON.parse(t).items.map((x) => [x.id, x.n])))
    .catch(() => new Map());
  const known = (await names).get(id);
  if (known || slot === 'vehicle') return known ?? null;
  // Newer than the deployed catalog: ask fortnite-api.com (IDs only; the name comes from there).
  const res = await fetch(`https://fortnite-api.com/v2/cosmetics/br/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(2000) });
  return res.ok ? (await res.json()).data?.name ?? null : null;
}

// Today's shop from this site's /api/shop (cached on the CDN). The page still works without it.
async function getShop(origin) {
  if (shopCache && Date.now() < shopCache.until) return shopCache.shop;
  try {
    const res = await fetch(`${origin}/api/shop`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    shopCache = { shop: await res.json(), until: Date.now() + 5 * 60e3 };
    return shopCache.shop;
  } catch (e) {
    console.error('page: shop unavailable', e.message);
    return null;
  }
}

export async function GET(request) {
  html ??= await readFile(join(process.cwd(), 'index.html'), 'utf8');
  const url = new URL(request.url);
  const site = siteOrigin(process.env, url.origin);
  // vercel.json rewrites each page's path here as ?__path=<path>; the rest of the query is the visitor's.
  const params = new URLSearchParams(url.search);
  const pathname = params.get('__path') ?? (url.pathname.startsWith('/api/') ? '/' : url.pathname);
  params.delete('__path');
  const { view, redirect } = route(pathname, params);
  if (redirect) {
    return new Response(null, { status: 308, headers: { Location: redirect, 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } });
  }
  const status = view ? 200 : 404;
  const search = params.size ? `?${params}` : '';
  const [tags, shop] = await Promise.all([
    previewTags({ params, view: view ?? 'notfound', site, pageUrl: `${site}${pathname}${search}`, supabaseUrl: SUPABASE_URL, nameOf }),
    view === 'shop' ? getShop(url.origin) : null,
  ]);
  return new Response(renderPage(html, tags, status, { view, shop }), {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Short CDN cache: the page now carries today's shop, which changes at 00:00 UTC.
      'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=600',
    },
  });
}

// Some crawlers and link checkers ask with HEAD first: same status and headers, no body.
export async function HEAD(request) {
  const res = await GET(request);
  return new Response(null, { status: res.status, headers: res.headers });
}

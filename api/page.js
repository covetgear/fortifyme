// The home page (/) on the live site: index.html plus link-preview tags, so combo share links
// show the combo's name and picture in Discord, iMessage, X and so on. vercel.json rewrites / here.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { previewTags, renderPage } from '../lib/page.mjs';
import { SUPABASE_URL } from '../config.js';

let html = null;
let names = null; // item id -> name, from the catalog deployed with the site

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

export async function GET(request) {
  html ??= await readFile(join(process.cwd(), 'index.html'), 'utf8');
  const url = new URL(request.url);
  const site = (process.env.SITE_URL || url.origin).replace(/\/+$/, '');
  const tags = await previewTags({ params: url.searchParams, pageUrl: `${site}/${url.search}`, supabaseUrl: SUPABASE_URL, nameOf });
  return new Response(renderPage(html, tags), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // New deploys clear the CDN cache, so the page can be cached between them.
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

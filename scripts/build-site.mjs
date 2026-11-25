// Vercel build: copies the public files into public/ (Vercel serves that folder) and writes
// public/404.html (the site's "not found" page, served with a 404 status), robots.txt and sitemap.xml.
// index.html itself is left out on purpose: / is served by api/page.js, which adds each page's tags and today's shop.
// Run locally to check: npm run build
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { previewTags, renderPage, siteOrigin } from '../lib/page.mjs';
import { VIEW_META, PATH_ALIASES } from '../lib/views.js';
import { SUPABASE_URL, ADSENSE_CLIENT } from '../config.js';

const root = new URL('../', import.meta.url);
const out = new URL('public/', root);
const FILES = ['favicon.ico', 'app.js', 'config.js', 'styles.css', 'lib/alert-email.js', 'lib/views.js', 'assets', 'data/cosmetics.json', 'data/shop.json'];

// Every page path (lib/views.js) must be rewritten to api/page in vercel.json, or it would be a 404 live.
const vercel = JSON.parse(await readFile(new URL('vercel.json', root), 'utf8'));
const rewritten = new Set(vercel.rewrites.flatMap((r) => (r.source === '/' ? ['/'] : (/^\/:page\((.+)\)$/.exec(r.source)?.[1].split('|') ?? []).map((p) => `/${p}`))));
const missing = [...Object.values(VIEW_META).map((m) => m.path).filter(Boolean), ...Object.keys(PATH_ALIASES)].filter((p) => !rewritten.has(p));
if (missing.length) throw new Error(`vercel.json rewrites are missing: ${missing.join(', ')}`);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const f of FILES) await cp(new URL(f, root), new URL(f, out), { recursive: true });

const site = siteOrigin(process.env, process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
const html = await readFile(new URL('index.html', root), 'utf8');
const tags = await previewTags({ params: new URLSearchParams(), view: 'notfound', site, pageUrl: `${site}/`, supabaseUrl: SUPABASE_URL, nameOf: async () => null });
await writeFile(new URL('404.html', out), renderPage(html, tags, 404));

// Search engines: allow everything (app.js needs /api/ to draw pages) and point at the sitemap, which
// lists only the public pages, by their canonical addresses. Combo links and personal pages stay out.
if (site) {
  const today = new Date().toISOString().slice(0, 10);
  const pages = Object.values(VIEW_META).filter((m) => m.path && !m.noindex);
  const urls = pages.map((m) => `  <url><loc>${site}${m.path}</loc>${m.path === '/' ? `<lastmod>${today}</lastmod><changefreq>daily</changefreq>` : ''}</url>`);
  const sitemap = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''];
  await writeFile(new URL('sitemap.xml', out), sitemap.join('\n'));
  await writeFile(new URL('robots.txt', out), ['User-agent: *', 'Allow: /', '', `Sitemap: ${site}/sitemap.xml`, ''].join('\n'));
}

// AdSense requires /ads.txt naming the site's publisher ID.
if (ADSENSE_CLIENT) {
  const pub = ADSENSE_CLIENT.replace(/^ca-/, '');
  await writeFile(new URL('ads.txt', out), `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
}
console.log(`Built public/ (${FILES.length} entries + 404.html${site ? `, robots.txt, sitemap.xml for ${site}` : ''})`);

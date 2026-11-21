// Vercel build: copies the public files into public/ (Vercel serves that folder) and writes
// public/404.html, the site's "not found" page with the right preview tags and a 404 status.
// index.html itself is left out on purpose: / is served by api/page.js, which adds share-preview tags.
// Run locally to check: npm run build
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { previewTags, renderPage } from '../lib/page.mjs';
import { SUPABASE_URL } from '../config.js';

const root = new URL('../', import.meta.url);
const out = new URL('public/', root);
const FILES = ['app.js', 'config.js', 'styles.css', 'lib/alert-email.js', 'assets', 'data/cosmetics.json', 'data/shop.json'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const f of FILES) await cp(new URL(f, root), new URL(f, out), { recursive: true });

const site = (process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')).replace(/\/+$/, '');
const html = await readFile(new URL('index.html', root), 'utf8');
const tags = await previewTags({ params: new URLSearchParams(), pageUrl: `${site}/`, supabaseUrl: SUPABASE_URL, nameOf: async () => null });
await writeFile(new URL('404.html', out), renderPage(html, tags, 404));
console.log(`Built public/ (${FILES.length} entries + 404.html)`);

// Tiny local server, mirroring the live site on Vercel. Run: node server.mjs
// - / gets the page's title, canonical link, preview tags and today's shop like api/page.js does live.
// - /api/shop and /api/cosmetics run the same code as on Vercel (live data from fortnite-api.com).
// - POST /api/contact saves each message to out/messages/ (live, api/contact.js stores it in Supabase).
// - Missing pages get the site with a 404 status, like public/404.html live.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SUPABASE_URL } from './config.js';
import { previewTags, renderPage, viewFor } from './lib/page.mjs';
import { cleanContact } from './lib/contact.mjs';
import * as shopApi from './api/shop.js';
import * as cosmeticsApi from './api/cosmetics.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MESSAGES = join(ROOT, 'out', 'messages');
const PORT = process.env.PORT || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, ''); // public address, e.g. https://fortifyme.gg

// Item names for preview titles, loaded once from the catalog.
let names = null;
async function nameOf(_slot, id) {
  names ??= readFile(join(ROOT, 'data', 'cosmetics.json'), 'utf8')
    .then((t) => new Map(JSON.parse(t).items.map((x) => [x.id, x.n])))
    .catch(() => new Map());
  return (await names).get(id) ?? null;
}

async function sendPage(res, url, origin, status = 200) {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const view = status === 404 ? null : viewFor(url.searchParams);
  if (!view) status = 404;
  const site = SITE_URL || origin;
  const [tags, shop] = await Promise.all([
    previewTags({ params: url.searchParams, view: view ?? 'notfound', site, pageUrl: `${site}${url.pathname}${url.search}`, supabaseUrl: SUPABASE_URL, nameOf }),
    view === 'shop' ? shopApi.GET().then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
  ]);
  res.writeHead(status, { 'Content-Type': TYPES['.html'] }).end(renderPage(html, tags, status, { view, shop }));
}

const json = (res, status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));

async function readBody(req, limit = 20_000) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new Error('too large');
  }
  return body;
}

async function handleContact(req, res) {
  let msg;
  try { msg = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'Bad request' }); }
  const { spam, error, entry } = cleanContact(msg);
  if (spam) return json(res, 200, { ok: true });
  if (error) return json(res, 400, { error });
  await mkdir(MESSAGES, { recursive: true });
  const file = `${entry.received.replace(/[:.]/g, '-')}_${entry.topic}.json`;
  await writeFile(join(MESSAGES, file), JSON.stringify(entry, null, 2));
  console.log(`Contact message (${entry.topic}) saved to out/messages/${file}`);
  json(res, 200, { ok: true });
}

// Runs a Vercel-style handler (Request in, Response out).
async function runApi(handler, res) {
  const r = await handler(new Request('http://localhost/'));
  res.writeHead(r.status, { 'Content-Type': r.headers.get('Content-Type') || 'application/json' });
  res.end(Buffer.from(await r.arrayBuffer()));
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const origin = `http://${req.headers.host || `localhost:${PORT}`}`;
  const path = decodeURIComponent(url.pathname);
  if (path === '/' || path === '/index.html') return sendPage(res, url, origin).catch(() => res.writeHead(500).end('Server error'));
  if (path === '/api/contact') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
    return handleContact(req, res).catch(() => json(res, 500, { error: 'Server error' }));
  }
  if (path === '/api/shop') return runApi(shopApi.GET, res).catch(() => json(res, 500, { error: 'Server error' }));
  if (path === '/api/cosmetics') return runApi(cosmeticsApi.GET, res).catch(() => json(res, 500, { error: 'Server error' }));
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(normalize(ROOT))) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    // Missing page (no extension, or .html): send the site with a 404 status so it shows its
    // "not found" page. Missing files (images, data) get a plain 404.
    const ext = extname(file);
    if (ext && ext !== '.html') return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    await sendPage(res, url, origin, 404).catch(() => res.writeHead(404).end('Not found'));
  }
}).listen(PORT, () => console.log(`Open http://localhost:${PORT}`));

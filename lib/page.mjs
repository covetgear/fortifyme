// What the server adds to index.html before sending it: the page's title, description, canonical
// address and robots rule (lib/views.js), link-preview tags (Open Graph / Twitter), today's shop as
// plain HTML so search engines see it without running app.js, and the 404 markers.
// Shared by server.mjs (local), api/page.js (the live home page) and scripts/build-site.mjs (404.html).
import { VIEW_META, DEFAULT_DESCRIPTION } from './views.js';

export const SLOTS = [['outfit', 'Outfit'], ['backbling', 'Back bling'], ['pickaxe', 'Pickaxe'], ['glider', 'Glider'], ['sidekick', 'Sidekick'], ['vehicle', 'Vehicle']];
const ITEM_ID = /^[A-Za-z0-9_.\-]{1,100}$/;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Which page a URL asks for: a combo link (?outfit=…) is the builder, no ?view= is the shop,
// and an unknown ?view= is null (the server answers 404).
export function viewFor(params) {
  if (SLOTS.some(([slot]) => params.has(slot)) || params.has('pet')) return 'build';
  const v = params.get('view');
  if (!v) return 'shop';
  return Object.hasOwn(VIEW_META, v) ? v : null;
}

// Head tags for a page. site: the public origin (https://fortifyme.gg), used for the canonical link.
// For a combo link (?outfit=…&pickaxe=…) the title lists the items and the picture is rendered by the
// combo-card function from the same IDs. Only IDs that nameOf(slot, id) recognises are used, so nobody
// can put their own text in a preview. The canonical link still points at the plain builder page,
// so search engines don't treat every combo as its own page.
export async function previewTags({ params, view, site, pageUrl, supabaseUrl, nameOf }) {
  const meta = VIEW_META[view] ?? VIEW_META.notfound;
  let title = meta.title;
  let description = meta.description ?? DEFAULT_DESCRIPTION;
  const card = new URLSearchParams();
  const asked = SLOTS.map(([slot, label]) => [slot, label, params.get(slot) || (slot === 'sidekick' ? params.get('pet') : null)])
    .filter(([, , id]) => id && ITEM_ID.test(id));
  const names = await Promise.all(asked.map(([slot, , id]) => nameOf(slot, id).catch(() => null)));
  const parts = [];
  asked.forEach(([slot, label, id], i) => {
    if (!names[i]) return;
    card.set(slot, id);
    parts.push([label, names[i]]);
  });
  if (parts.length) {
    const hero = parts.find(([l]) => l === 'Outfit') ?? parts[0];
    title = `${hero[1]} combo · FortifyMe`;
    description = parts.map(([l, n]) => `${l}: ${n}`).join(' · ');
  }
  const canonical = !meta.noindex && meta.path && site ? `${site}${meta.path}` : null;
  const image = `${supabaseUrl}/functions/v1/combo-card${card.size ? `?${card}` : ''}`;
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    meta.noindex ? '<meta name="robots" content="noindex">' : null,
    canonical ? `<link rel="canonical" href="${esc(canonical)}">` : null,
    '<meta property="og:site_name" content="FortifyMe">',
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(parts.length ? pageUrl : canonical ?? pageUrl)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
  ].filter(Boolean).map((t) => `  ${t}\n`).join('');
}

// Today's shop (the /api/shop payload) as plain HTML in the same layout app.js draws, so the page has
// real content before any script runs. app.js replaces it with the interactive version.
// Same grouping and order as app.js shopSections() with its default settings (no Jam Tracks,
// "featured" sort, four tiles per section).
export function shopHtml(shop) {
  const isTrack = (e) => e.items.length > 0 && e.items.every((i) => i.t === 'jamtrack');
  const tileWidth = (e) => Number(/Size_(\d)_x/.exec(e.tile || '')?.[1] || 1);
  const bySection = new Map();
  for (const e of shop?.entries ?? []) {
    if (!Array.isArray(e.items) || isTrack(e)) continue;
    if (!bySection.has(e.section)) bySection.set(e.section, []);
    bySection.get(e.section).push(e);
  }
  const weight = (name, list) => (name === 'More items' ? 3 : list.every((e) => e.items.every((i) => i.t === 'car')) ? 2 : 0);
  const sections = [...bySection].map(([name, list]) => ({
    name,
    list: list.sort((a, b) => tileWidth(b) - tileWidth(a) || b.sort - a.sort || b.price - a.price),
    newest: Math.max(...list.map((e) => Date.parse(e.inDate))),
    rank: Math.min(...list.map((e) => e.rank)),
    weight: weight(name, list),
  })).sort((a, b) => a.weight - b.weight || b.newest - a.newest || a.rank - b.rank);

  const num = (n) => Number(n).toLocaleString('en-US');
  const color = (c) => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c : null);
  const card = (e) => {
    const [c1, c2] = [color(e.colors?.[0]), color(e.colors?.[1]) ?? color(e.colors?.[0])];
    const style = c1 ? ` style="--c1:color-mix(in srgb, ${c1} 45%, #151820);--c2:color-mix(in srgb, ${c2} 18%, #151820)"` : '';
    const sub = e.items.length > 1 ? `${e.items.length} items` : e.items[0]?.artist || '';
    const was = e.regularPrice > e.price ? `<s>${num(e.regularPrice)}</s>` : '';
    return `<div class="offer-card"><div class="art"${style}>${e.img ? `<img class="render" src="${esc(e.img)}" alt="${esc(e.name)}" loading="lazy" decoding="async">` : ''}</div>`
      + `<div class="info"><div class="name">${esc(e.name)}</div><div class="sub">${esc(sub)}</div>`
      + `<div class="price-row"><strong>${num(e.price)}</strong><span>V-Bucks</span>${was}</div></div></div>`;
  };
  return sections.map((s, i) => `<section class="shop-section" id="sec-${i}"><div class="section-head"><h2>${esc(s.name)}<span class="count">${s.list.length}</span></h2></div>`
    + `<div class="shop-grid">${s.list.slice(0, 4).map(card).join('')}</div></section>`).join('\n');
}

// index.html with the head tags (they replace its plain <title>). view: the page to show without
// waiting for app.js (only public pages). shop: today's shop payload, drawn into the shop page.
// For a missing page also the 404 markers: <base href="/"> keeps styles.css, app.js and data/ loading
// from nested paths, and app.js shows its "not found" page.
export function renderPage(html, tags, status = 200, { view, shop } = {}) {
  let page = html.replace(/<title>[^<]*<\/title>\s*/, '');
  if (status === 404) page = page.replace('<head>', '<head>\n  <base href="/">\n  <meta name="http-status" content="404">');
  const meta = VIEW_META[view];
  if (status === 200 && meta && !meta.noindex) {
    page = page.replace(`id="view-${view}" class="view hidden"`, `id="view-${view}" class="view"`);
    if (view === 'shop' && shop?.entries?.length) {
      page = page.replace('<div id="shop-sections"></div>', `<div id="shop-sections">${shopHtml(shop)}</div>`);
      const day = new Date(`${shop.date}T12:00:00Z`);
      if (!Number.isNaN(day.getTime())) {
        const date = day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
        page = page.replace('id="shop-date-main"></div>', `id="shop-date-main">${esc(date)}</div>`);
      }
    }
  }
  return page.replace('</head>', `${tags}</head>`);
}

// The site's public origin, without a trailing slash: SITE_URL when set (https://fortifyme.gg at
// launch), else Vercel's production address, else the given fallback (the request's own origin).
export function siteOrigin(env, fallback = '') {
  const prod = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '';
  return (env.SITE_URL || prod || fallback).replace(/\/+$/, '');
}

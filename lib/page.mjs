// Link-preview tags (Open Graph / Twitter) and 404 markers for index.html.
// Shared by server.mjs (local), api/page.js (the live home page) and scripts/build-site.mjs (404.html).

export const SLOTS = [['outfit', 'Outfit'], ['backbling', 'Back bling'], ['pickaxe', 'Pickaxe'], ['glider', 'Glider'], ['sidekick', 'Sidekick'], ['vehicle', 'Vehicle']];
const ITEM_ID = /^[A-Za-z0-9_.\-]{1,100}$/;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Preview tags for a page. For a combo link (?outfit=…&pickaxe=…) the title lists the items and
// the picture is rendered by the combo-card function from the same IDs. Only IDs that
// nameOf(slot, id) recognises are used, so nobody can put their own text in a preview.
export async function previewTags({ params, pageUrl, supabaseUrl, nameOf }) {
  let title = 'FortifyMe';
  let description = 'Browse the daily Fortnite Item Shop, build outfit combos, and get an email when your wishlist items return.';
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
  const image = `${supabaseUrl}/functions/v1/combo-card${card.size ? `?${card}` : ''}`;
  return [
    `<meta name="description" content="${esc(description)}">`,
    '<meta property="og:site_name" content="FortifyMe">',
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(pageUrl)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(image)}">`,
  ].map((t) => `  ${t}\n`).join('');
}

// index.html with preview tags. For a missing page also the 404 markers: <base href="/"> keeps
// styles.css, app.js and data/ loading from nested paths, and app.js shows its "not found" page.
export function renderPage(html, tags, status = 200) {
  let page = html;
  if (status === 404) page = page.replace('<head>', '<head>\n  <base href="/">\n  <meta name="http-status" content="404">\n  <meta name="robots" content="noindex">');
  return page.replace('</head>', `${tags}</head>`);
}

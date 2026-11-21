// Turns fortnite-api.com's full cosmetics lists into the trimmed catalog the combo builder uses.
// Shared by scripts/build-data.mjs (writes data/cosmetics.json) and api/cosmetics.js (the live site).

export const API = 'https://fortnite-api.com/v2/cosmetics';
export const IMG_PREFIX = 'https://fortnite-api.com/images/cosmetics/';

// API type -> our slot
const SLOT_BY_TYPE = {
  outfit: 'outfit',
  backpack: 'backbling',
  pickaxe: 'pickaxe',
  glider: 'glider',
  // Old-style pets ride in a carrier on your back, so they are back blings in game.
  pet: 'backbling',
  petcarrier: 'backbling',
  sidekick: 'sidekick',
};

const strip = (url) => (url && url.startsWith(IMG_PREFIX) ? url.slice(IMG_PREFIX.length) : url);

async function get(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()).data;
}

export async function fetchCatalog() {
  const [br, cars] = await Promise.all([get('/br'), get('/cars')]);
  return buildCatalog(br, cars);
}

export function buildCatalog(br, cars) {
  const items = [];
  for (const c of br) {
    const slot = SLOT_BY_TYPE[c.type?.value];
    if (!slot) continue;
    const img = slot === 'outfit' ? c.images?.featured || c.images?.icon : c.images?.icon;
    if (!img) continue;
    items.push({
      id: c.id,
      n: c.name,
      s: slot,
      r: c.rarity?.value ?? 'common',
      set: c.set?.value || undefined,
      // Series label such as "MARVEL SERIES" (shown as "Marvel series" on account cards)
      sr: c.series?.value || undefined,
      in: c.introduction?.text || undefined,
      a: c.added?.slice(0, 10),
      i: strip(img),
    });
  }

  for (const c of cars) {
    if (c.type?.value !== 'body' || !c.images?.large) continue;
    items.push({
      id: c.id,
      n: c.name,
      s: 'vehicle',
      r: c.rarity?.value ?? 'common',
      set: c.series?.value || undefined,
      a: c.added?.slice(0, 10),
      i: strip(c.images.large),
    });
  }

  // Newest first
  items.sort((x, y) => (y.a || '').localeCompare(x.a || ''));
  return { updated: new Date().toISOString().slice(0, 10), imgPrefix: IMG_PREFIX, items };
}

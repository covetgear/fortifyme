// Turns fortnite-api.com's /v2/shop response into what the site shows.
// Shared by scripts/record-shop.mjs (local files) and api/shop.js (the live site).

export const SHOP_API = 'https://fortnite-api.com/v2/shop';

export async function fetchShop() {
  const res = await fetch(SHOP_API);
  if (!res.ok) throw new Error(`shop: HTTP ${res.status}`);
  return (await res.json()).data;
}

// For each item keep the cheapest way to get it on its own: prefer an entry with
// the fewest items (a single item over a bundle), then the lowest price.
export function bestOffers(shop) {
  const best = new Map();
  for (const entry of shop.entries ?? []) {
    const items = [...(entry.brItems || []), ...(entry.cars || [])];
    for (const item of items) {
      const offer = {
        price: entry.finalPrice,
        regularPrice: entry.regularPrice,
        inDate: entry.inDate,
        outDate: entry.outDate,
        // Bundle name, or true for an unnamed bundle
        bundle: items.length > 1 ? entry.bundle?.name || true : undefined,
        size: items.length,
      };
      const cur = best.get(item.id);
      if (!cur || offer.size < cur.size || (offer.size === cur.size && offer.price < cur.price)) best.set(item.id, offer);
    }
  }
  return best;
}

// The shop as laid out in game: one entry per tile, grouped into sections.
export function shopEntries(shop) {
  return (shop.entries ?? []).map((e) => {
    const br = e.brItems || [];
    const cars = e.cars || [];
    const tracks = e.tracks || [];
    const first = br[0] || cars[0];
    const items = [
      ...br.map((b) => ({ id: b.id, n: b.name, t: b.type?.value, r: b.rarity?.value })),
      ...cars.map((c) => ({ id: c.id, n: c.name, t: 'car', r: c.rarity?.value })),
      ...tracks.map((t) => ({ id: t.id, n: t.title, t: 'jamtrack', artist: t.artist })),
    ];
    return {
      id: e.offerId,
      section: e.layout?.name?.trim() || 'More items',
      rank: e.layout?.rank ?? 9999,
      sort: e.sortPriority ?? 0,
      name: e.bundle?.name || first?.name || tracks[0]?.title || e.devName,
      bundle: Boolean(e.bundle) || items.length > 1,
      price: e.finalPrice,
      regularPrice: e.regularPrice,
      inDate: e.inDate,
      outDate: e.outDate,
      banner: e.banner?.value,
      tile: e.tileSize,
      colors: e.colors ? [e.colors.color1, e.colors.color3 || e.colors.color2].filter(Boolean).map((c) => `#${c.slice(0, 6)}`) : undefined,
      img: e.bundle?.image || e.newDisplayAsset?.renderImages?.[0]?.image || first?.images?.featured || first?.images?.icon
        || first?.images?.large || tracks[0]?.albumArt,
      items,
    };
  });
}

// The data/shop.json shape. lastSeen: Map of item id -> ISO date (or null).
export function shopPayload(shop, best, lastSeen, trackingSince) {
  const items = {};
  for (const [id, o] of best) {
    items[id] = { price: o.price, regularPrice: o.regularPrice, inDate: o.inDate, outDate: o.outDate, bundle: o.bundle, lastSeen: lastSeen.get(id) ?? null };
  }
  return { date: String(shop.date).slice(0, 10), trackingSince, vbuckIcon: shop.vbuckIcon, items, entries: shopEntries(shop) };
}

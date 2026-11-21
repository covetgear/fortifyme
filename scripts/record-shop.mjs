// Records today's Item Shop. Run once a day, just after the shop resets (00:00 UTC):
//   node scripts/record-shop.mjs
// Writes:
//   data/shop.json          today's items with price, leave date and last time seen
//   data/shop-history.json  every appearance we've recorded (our own history; no free API offers it)
// The live site doesn't need this: api/shop.js builds the same data from the Supabase history.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fetchShop, bestOffers, shopPayload } from '../lib/shop.mjs';

const DAY = 864e5;
const dataUrl = (f) => new URL(`../data/${f}`, import.meta.url);

async function readJson(f, fallback) {
  try { return JSON.parse(await readFile(dataUrl(f), 'utf8')); } catch { return fallback; }
}

const shop = await fetchShop();
const shopDate = shop.date.slice(0, 10);
const best = bestOffers(shop);

await mkdir(dataUrl(''), { recursive: true });
const history = await readJson('shop-history.json', { since: shopDate, items: {} });

const lastSeen = new Map();
for (const [id, o] of best) {
  const runs = (history.items[id] ||= []);
  // Last time seen = the end of the most recent earlier appearance (ignoring a
  // re-listing that starts the day after the previous one ended).
  const earlier = runs.filter((r) => Date.parse(r.out) < Date.parse(o.inDate) - DAY);
  lastSeen.set(id, earlier.length ? earlier.at(-1).out : null);

  const run = runs.find((r) => r.in === o.inDate);
  if (run) run.out = o.outDate;
  else runs.push({ in: o.inDate, out: o.outDate, price: o.price });
  runs.sort((a, b) => a.in.localeCompare(b.in));
}

await writeFile(dataUrl('shop-history.json'), JSON.stringify(history));
await writeFile(dataUrl('shop.json'), JSON.stringify(shopPayload(shop, best, lastSeen, history.since)));
console.log(`Shop ${shopDate}: ${best.size} items recorded. History covers ${Object.keys(history.items).length} items since ${history.since}.`);

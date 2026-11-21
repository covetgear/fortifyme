// Downloads the full cosmetics list from fortnite-api.com and writes a trimmed
// copy with only the slots the combo builder uses. Run: node scripts/build-data.mjs
// The live site builds the same thing on demand (api/cosmetics.js); this file is the fallback.
import { writeFile, mkdir } from 'node:fs/promises';
import { fetchCatalog } from '../lib/catalog.mjs';

const out = await fetchCatalog();
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/cosmetics.json', import.meta.url), JSON.stringify(out));

const counts = out.items.reduce((m, x) => ((m[x.s] = (m[x.s] || 0) + 1), m), {});
console.log(`Wrote ${out.items.length} items`, counts);

// Emails each subscriber when an item on their wishlist appears in today's shop.
// Run right after record-shop.mjs:
//   node scripts/send-alerts.mjs
//
// Subscribers come from data/subscribers.json (falls back to data/subscribers.example.json).
// In the real site this list comes from the database (accounts with alerts turned on).
//
// Sending: set RESEND_API_KEY and ALERT_FROM (e.g. "FortifyMe <alerts@yourdomain.com>")
// to send through Resend (resend.com). Without them, emails are written to out/emails/ as
// previews and nothing is sent.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { buildAlertEmail } from '../lib/alert-email.js';

const root = new URL('../', import.meta.url);
const readJson = async (path, fallback) => {
  try { return JSON.parse(await readFile(new URL(path, root), 'utf8')); } catch { return fallback; }
};

const shop = await readJson('data/shop.json');
const catalog = await readJson('data/cosmetics.json');
if (!shop || !catalog) throw new Error('Run scripts/build-data.mjs and scripts/record-shop.mjs first.');

const subscribers = (await readJson('data/subscribers.json')) ?? (await readJson('data/subscribers.example.json', []));
const sent = await readJson('data/alerts-sent.json', {});
const byId = new Map(catalog.items.map((x) => [x.id, x]));
const imageUrl = (item) => (item.i.startsWith('http') ? item.i : catalog.imgPrefix + item.i);

const { RESEND_API_KEY, ALERT_FROM, SITE_URL = '' } = process.env;
const live = Boolean(RESEND_API_KEY && ALERT_FROM);

async function send(to, { subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: ALERT_FROM, to, subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

let emails = 0;
for (const sub of subscribers) {
  // One alert per item per shop appearance, so a 3-day listing sends one email, not three.
  const fresh = sub.wishlist
    .filter((id) => shop.items[id] && byId.has(id))
    .filter((id) => !sent[`${sub.email}|${id}|${shop.items[id].inDate}`]);
  if (!fresh.length) continue;

  const items = fresh.map((id) => {
    const c = byId.get(id);
    return { name: c.n, image: imageUrl(c), released: c.a, ...shop.items[id] };
  });
  const email = buildAlertEmail({ items, timeZone: sub.timeZone || 'UTC', trackingSince: shop.trackingSince, siteUrl: SITE_URL });

  if (live) {
    await send(sub.email, email);
    console.log(`Sent to ${sub.email}: ${email.subject}`);
  } else {
    await mkdir(new URL('out/emails/', root), { recursive: true });
    const name = sub.email.replace(/[^a-z0-9]+/gi, '_');
    await writeFile(new URL(`out/emails/${name}.html`, root), email.html);
    await writeFile(new URL(`out/emails/${name}.txt`, root), email.text);
    console.log(`Preview for ${sub.email}: out/emails/${name}.html  (${email.subject})`);
  }
  for (const id of fresh) sent[`${sub.email}|${id}|${shop.items[id].inDate}`] = new Date().toISOString();
  emails++;
}

if (live) await writeFile(new URL('data/alerts-sent.json', root), JSON.stringify(sent, null, 1));
console.log(`${emails} email(s) ${live ? 'sent' : 'previewed (set RESEND_API_KEY and ALERT_FROM to send)'}.`);

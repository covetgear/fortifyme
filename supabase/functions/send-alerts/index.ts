// Emails each subscriber when items on their wishlist are in today's Item Shop.
// Scheduled daily by pg_cron after record-shop (see migration schedule_send_alerts).
//
// Who: accounts with alerts on and a confirmed email (public.alert_subscribers()).
// Each item alerts once per shop listing (public.alerts_sent), so re-running is safe.
//
// Sending needs two Edge Function secrets: RESEND_API_KEY and ALERT_FROM
// (e.g. "FortifyMe <alerts@yourdomain.com>", on a domain verified in Resend).
// Without them it does a dry run: counts what it would send, sends nothing, logs nothing.
// Optional secrets: SITE_URL (links in the email), ALERT_DAILY_CAP (default 100, Resend's free daily limit).
//
// POST ?preview=1 with {"wishlist": [...ids], "time_zone": "..."} returns the email it would build
// for that wishlist (no subscribers read, nothing sent). Used for testing the template.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { buildAlertEmail } from './alert-email.js';

type Offer = {
  name: string;
  image: string;
  released?: string;
  inDate: string;
  outDate: string;
  price: number;
  regularPrice: number;
  bundle: string | null;
  size: number;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SITE_URL = (Deno.env.get('SITE_URL') || 'http://localhost:5173').replace(/\/+$/, '');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const ALERT_FROM = Deno.env.get('ALERT_FROM');
const LIVE = Boolean(RESEND_API_KEY && ALERT_FROM);
const DAILY_CAP = Number(Deno.env.get('ALERT_DAILY_CAP') || 100);

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Today's shop, with each item's cheapest listing (same rule as record-shop).
  const res = await fetch('https://fortnite-api.com/v2/shop');
  if (!res.ok) return json({ error: `fortnite-api.com returned ${res.status}` }, 502);
  const shop = (await res.json()).data;
  const offers = new Map<string, Offer>();
  for (const entry of shop.entries ?? []) {
    const items = [...(entry.brItems ?? []), ...(entry.cars ?? [])];
    for (const item of items) {
      const offer: Offer = {
        name: item.name,
        image: item.images?.featured || item.images?.icon || item.images?.large || item.images?.small || '',
        released: item.added,
        inDate: entry.inDate,
        outDate: entry.outDate,
        price: entry.finalPrice,
        regularPrice: entry.regularPrice,
        bundle: items.length > 1 ? entry.bundle?.name || true : null,
        size: items.length,
      };
      const cur = offers.get(item.id);
      if (!cur || offer.size < cur.size || (offer.size === cur.size && offer.price < cur.price)) offers.set(item.id, offer);
    }
  }

  const db = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: firstDay } = await db.from('shop_days').select('shop_date').order('shop_date').limit(1).maybeSingle();
  const trackingSince = firstDay?.shop_date;

  const lastSeenCache = new Map<string, string | null>();
  async function withHistory(id: string) {
    const o = offers.get(id)!;
    if (!lastSeenCache.has(id)) {
      const { data } = await db.rpc('item_last_seen', { p_item_id: id, p_before: o.inDate });
      lastSeenCache.set(id, data ?? null);
    }
    const { size: _size, ...rest } = o;
    return { ...rest, lastSeen: lastSeenCache.get(id) };
  }

  // Template preview for a given wishlist: nothing read from accounts, nothing sent.
  if (url.searchParams.get('preview')) {
    const body = await req.json().catch(() => ({}));
    const ids = (Array.isArray(body.wishlist) ? body.wishlist : []).filter((id: unknown) => typeof id === 'string' && offers.has(id)).slice(0, 20);
    if (!ids.length) return json({ error: 'None of those items are in today\'s shop', shopItems: offers.size }, 404);
    const items = await Promise.all(ids.map(withHistory));
    const email = buildAlertEmail({ items, timeZone: validZone(body.time_zone), trackingSince, siteUrl: SITE_URL, unsubscribeUrl: `${SUPABASE_URL}/functions/v1/unsubscribe?token=preview` });
    return json(email);
  }

  const { data: subs, error } = await db.rpc('alert_subscribers');
  if (error) return json({ error: error.message }, 500);

  // What's already been sent for the items currently in the shop.
  const wanted = new Set<string>();
  for (const s of subs) for (const id of s.wishlist) if (offers.has(id)) wanted.add(id);
  const sent = new Set<string>();
  if (wanted.size) {
    const ids = [...wanted];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error: e } = await db.from('alerts_sent').select('user_id,item_id,in_date').in('item_id', ids.slice(i, i + 200));
      if (e) return json({ error: e.message }, 500);
      for (const r of data) sent.add(`${r.user_id}|${r.item_id}|${Date.parse(r.in_date)}`);
    }
  }

  let emails = 0, failed = 0, capped = 0, due = 0;
  for (const s of subs) {
    const fresh = [...new Set<string>(s.wishlist)].filter((id) => offers.has(id) && !sent.has(`${s.user_id}|${id}|${Date.parse(offers.get(id)!.inDate)}`));
    if (!fresh.length) continue;
    due++;
    if (!LIVE) continue;
    if (emails >= DAILY_CAP) { capped++; continue; } // picked up by the retry run / tomorrow

    const unsubscribeUrl = `${SUPABASE_URL}/functions/v1/unsubscribe?token=${s.unsubscribe_token}`;
    const items = await Promise.all(fresh.map(withHistory));
    const email = buildAlertEmail({ items, timeZone: validZone(s.time_zone), trackingSince, siteUrl: SITE_URL, unsubscribeUrl });
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: ALERT_FROM,
          to: s.email,
          subject: email.subject,
          html: email.html,
          text: email.text,
          headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
      const rows = fresh.map((id) => ({ user_id: s.user_id, item_id: id, in_date: offers.get(id)!.inDate }));
      const { error: e } = await db.from('alerts_sent').upsert(rows, { onConflict: 'user_id,item_id,in_date', ignoreDuplicates: true });
      if (e) console.error(`Sent but not logged (${s.user_id}): ${e.message}`);
      emails++;
    } catch (err) {
      failed++;
      console.error(`Alert failed for ${s.user_id}: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 600)); // Resend allows about 2 requests a second
  }

  const summary = { live: LIVE, shopItems: offers.size, subscribers: subs.length, due, emails, failed, capped };
  console.log(JSON.stringify(summary));
  return json(summary);
});

function validZone(tz: unknown) {
  try { if (typeof tz === 'string' && tz) { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } } catch { /* bad zone */ }
  return 'UTC';
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

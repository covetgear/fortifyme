// Records today's Fortnite Item Shop into public.shop_appearances and public.shop_days.
// Scheduled daily by pg_cron (see migration schedule_record_shop). Safe to run repeatedly:
// each item listing is upserted on (item_id, in_date).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

type Offer = {
  item_id: string;
  in_date: string;
  out_date: string;
  price: number;
  regular_price: number;
  bundle: string | null;
  size: number;
};

Deno.serve(async () => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const res = await fetch('https://fortnite-api.com/v2/shop');
  if (!res.ok) return json({ error: `fortnite-api.com returned ${res.status}` }, 502);
  const shop = (await res.json()).data;

  // For each item keep the cheapest way to get it on its own: fewest items in the
  // entry (a single item beats a bundle), then the lowest price.
  const best = new Map<string, Offer>();
  for (const entry of shop.entries ?? []) {
    const items = [...(entry.brItems ?? []), ...(entry.cars ?? [])];
    for (const item of items) {
      const offer: Offer = {
        item_id: item.id,
        in_date: entry.inDate,
        out_date: entry.outDate,
        price: entry.finalPrice,
        regular_price: entry.regularPrice,
        bundle: items.length > 1 ? entry.bundle?.name || 'bundle' : null,
        size: items.length,
      };
      const cur = best.get(item.id);
      if (!cur || offer.size < cur.size || (offer.size === cur.size && offer.price < cur.price)) best.set(item.id, offer);
    }
  }

  const now = new Date().toISOString();
  const rows = [...best.values()].map(({ size: _size, ...r }) => ({ ...r, last_recorded: now }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('shop_appearances').upsert(rows.slice(i, i + 500), { onConflict: 'item_id,in_date' });
    if (error) return json({ error: error.message }, 500);
  }

  const shopDate = String(shop.date).slice(0, 10);
  const { error } = await supabase.from('shop_days').upsert({ shop_date: shopDate, item_count: rows.length, recorded_at: now });
  if (error) return json({ error: error.message }, 500);

  console.log(`Recorded ${rows.length} items for ${shopDate}`);
  return json({ shop_date: shopDate, items: rows.length });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

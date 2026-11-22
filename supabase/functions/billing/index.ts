// Starts Stripe Checkout for the ad-free subscription, or opens the Stripe Customer Portal.
// POST { action: 'checkout', plan: 'monthly' | 'yearly' } or { action: 'portal' }
// with the signed-in visitor's access token (Authorization: Bearer ...). Returns { url }.
// Deployed with verify_jwt off so the browser's CORS preflight gets through; the token is checked here.
// Secrets: STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY (optional), SITE_URL,
// STRIPE_TAX=on (optional, needs Stripe Tax set up).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const AD_FREE = ['active', 'trialing', 'past_due'];

// Where Stripe sends people back: the page they came from, if it's one of ours.
function returnOrigin(req: Request): string {
  const site = (Deno.env.get('SITE_URL') || 'https://fortifyme.vercel.app').replace(/\/+$/, '');
  const allowed = new Set([site, 'https://fortifyme.gg', 'https://www.fortifyme.gg', 'https://fortifyme.vercel.app', 'http://localhost:5173']);
  const origin = req.headers.get('Origin') || '';
  return allowed.has(origin) ? origin : site;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const key = Deno.env.get('STRIPE_SECRET_KEY');
  const prices: Record<string, string | undefined> = {
    monthly: Deno.env.get('STRIPE_PRICE_MONTHLY'),
    yearly: Deno.env.get('STRIPE_PRICE_YEARLY'),
  };
  if (!key || !prices.monthly) return json({ error: 'Subscriptions aren’t available yet.' }, 503);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!user) return json({ error: 'Please log in again.' }, 401);
  if (!user.email || !user.email_confirmed_at) return json({ error: 'Confirm your email address first.' }, 403);

  let body: { action?: string; plan?: string };
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }

  const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
  const site = returnOrigin(req);

  try {
    const { data: row, error } = await admin.from('subscriptions').select('stripe_customer_id,status').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    let customer = row?.stripe_customer_id as string | undefined;
    if (!customer) {
      const c = await stripe.customers.create(
        { email: user.email, metadata: { supabase_user_id: user.id } },
        { idempotencyKey: `customer-${user.id}` },
      );
      customer = c.id;
      const { error: e2 } = await admin.from('subscriptions').upsert({ user_id: user.id, stripe_customer_id: customer, updated_at: new Date().toISOString() });
      if (e2) throw e2;
    }

    if (body.action === 'portal') {
      const s = await stripe.billingPortal.sessions.create({ customer, return_url: `${site}/?view=account` });
      return json({ url: s.url });
    }

    if (body.action === 'checkout') {
      if (row && AD_FREE.includes(row.status)) return json({ error: 'You’re already ad-free.' }, 409);
      const price = prices[body.plan === 'yearly' ? 'yearly' : 'monthly'];
      if (!price) return json({ error: 'That plan isn’t available.' }, 400);
      const s = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer,
        client_reference_id: user.id,
        line_items: [{ price, quantity: 1 }],
        subscription_data: { metadata: { supabase_user_id: user.id } },
        allow_promotion_codes: true,
        ...(Deno.env.get('STRIPE_TAX') === 'on' ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' as const } } : {}),
        success_url: `${site}/?view=account&billing=success`,
        cancel_url: `${site}/?view=account&billing=cancel`,
      });
      return json({ url: s.url });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'Billing is unavailable right now. Try again later.' }, 502);
  }
});

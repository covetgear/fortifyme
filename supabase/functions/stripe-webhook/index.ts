// Keeps public.subscriptions in step with Stripe. Stripe calls this for subscription and checkout
// events; the signature is checked with STRIPE_WEBHOOK_SECRET. Deployed with verify_jwt off.
// Each event re-reads the subscription from Stripe, so late or out-of-order events can't leave old data.
// Events to send (Stripe > Developers > Webhooks): checkout.session.completed,
// customer.subscription.created, customer.subscription.updated, customer.subscription.deleted.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const AD_FREE = ['active', 'trialing', 'past_due'];
const crypto = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!key || !secret) return new Response('Not configured', { status: 503 });

  const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), req.headers.get('stripe-signature') || '', secret, undefined, crypto);
  } catch {
    return new Response('Bad signature', { status: 400 });
  }

  let subId: string | null = null;
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as Stripe.Checkout.Session;
    subId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id ?? null;
  } else if (event.type.startsWith('customer.subscription.')) {
    subId = (event.data.object as Stripe.Subscription).id;
  }
  if (!subId) return new Response('Ignored');

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  try {
    const sub = await stripe.subscriptions.retrieve(subId);
    const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

    // Which account: the row that already has this customer, else the user ID saved on the subscription.
    const { data: row } = await admin.from('subscriptions').select('user_id,stripe_subscription_id,status').eq('stripe_customer_id', customer).maybeSingle();
    const userId = row?.user_id ?? sub.metadata?.supabase_user_id;
    if (!userId) {
      console.error(`No account for customer ${customer}`);
      return new Response('Unknown customer'); // 200 so Stripe doesn't retry forever
    }

    // Don't let an old, ended subscription overwrite a newer active one.
    if (row?.stripe_subscription_id && row.stripe_subscription_id !== sub.id && AD_FREE.includes(row.status) && !AD_FREE.includes(sub.status)) {
      return new Response('Older subscription ignored');
    }

    // current_period_end moved onto subscription items in newer Stripe API versions.
    // deno-lint-ignore no-explicit-any
    const item = sub.items?.data?.[0] as any;
    const periodEnd = (sub as any).current_period_end ?? item?.current_period_end ?? null;
    const { error } = await admin.from('subscriptions').upsert({
      user_id: userId,
      stripe_customer_id: customer,
      stripe_subscription_id: sub.id,
      status: sub.status,
      price_id: item?.price?.id ?? null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: !!sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return new Response('OK');
  } catch (e) {
    console.error(e);
    return new Response('Error', { status: 500 }); // Stripe retries
  }
});

-- Ad-free subscriptions (Stripe). One row per account; written only by the billing and
-- stripe-webhook Edge Functions (service role). People can read their own row to hide ads.
create table public.subscriptions (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id     text not null unique,
  stripe_subscription_id text,
  status                 text not null default 'none', -- Stripe status: active, trialing, past_due, canceled, ...
  price_id               text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);
comment on table public.subscriptions is 'Ad-free subscription per account, synced from Stripe by the stripe-webhook Edge Function.';

alter table public.subscriptions enable row level security;
create policy "Read own subscription" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

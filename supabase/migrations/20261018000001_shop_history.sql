-- One row per item per shop listing (an item that stays in the shop several days is one row).
create table public.shop_appearances (
  item_id        text        not null,
  in_date        timestamptz not null,
  out_date       timestamptz not null,
  price          integer     not null,
  regular_price  integer     not null,
  bundle         text,
  first_recorded timestamptz not null default now(),
  last_recorded  timestamptz not null default now(),
  primary key (item_id, in_date)
);
create index shop_appearances_item_out_idx on public.shop_appearances (item_id, out_date desc);

-- One row per day the recorder ran, so gaps in history are easy to spot.
create table public.shop_days (
  shop_date   date        primary key,
  item_count  integer     not null,
  recorded_at timestamptz not null default now()
);

comment on table public.shop_appearances is 'Item Shop history recorded daily by the record-shop Edge Function. Source: fortnite-api.com /v2/shop.';
comment on table public.shop_days is 'Days the record-shop job ran successfully.';

-- Shop data is public; only the Edge Function (service role) writes.
alter table public.shop_appearances enable row level security;
alter table public.shop_days enable row level security;
create policy "Shop history is public" on public.shop_appearances for select to anon, authenticated using (true);
create policy "Shop days are public" on public.shop_days for select to anon, authenticated using (true);

-- Last time an item was in the shop before a given listing (ignores a re-listing that starts the day after the previous one ended).
create or replace function public.item_last_seen(p_item_id text, p_before timestamptz)
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select max(out_date)
  from public.shop_appearances
  where item_id = p_item_id
    and out_date < p_before - interval '1 day';
$$;

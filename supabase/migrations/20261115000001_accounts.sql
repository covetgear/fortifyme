-- Accounts: one locker per signed-in user (favorites, wishlist, saved combos, alert settings).
-- Sign-in itself is Supabase Auth (auth.users); this table only holds what the site saves.
create table public.lockers (
  user_id           uuid        primary key references auth.users (id) on delete cascade,
  likes             text[]      not null default '{}',
  wishlist          text[]      not null default '{}',
  combos            jsonb       not null default '[]'::jsonb,
  alerts_on         boolean     not null default false,
  time_zone         text        not null default 'UTC',
  unsubscribe_token uuid        not null default gen_random_uuid() unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint lockers_likes_max    check (cardinality(likes) <= 5000),
  constraint lockers_wishlist_max check (cardinality(wishlist) <= 1000),
  constraint lockers_combos_shape check (jsonb_typeof(combos) = 'array' and jsonb_array_length(combos) <= 200 and pg_column_size(combos) <= 200000),
  constraint lockers_tz_len       check (char_length(time_zone) <= 64)
);
comment on table public.lockers is 'Each account''s favorites, wishlist, saved combos and wishlist-alert settings.';

alter table public.lockers enable row level security;
create policy "Read own locker"   on public.lockers for select to authenticated using ((select auth.uid()) = user_id);
create policy "Create own locker" on public.lockers for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Update own locker" on public.lockers for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- Deleting happens through deleting the account (cascade), not from the site.

-- Users may only write their own data columns, never the unsubscribe token or timestamps.
revoke insert, update on public.lockers from anon, authenticated;
grant insert (user_id, likes, wishlist, combos, alerts_on, time_zone) on public.lockers to authenticated;
grant update (likes, wishlist, combos, alerts_on, time_zone) on public.lockers to authenticated;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger lockers_touch before update on public.lockers for each row execute function public.touch_updated_at();

-- New account: create its locker. The sign-up form passes the alert choice and time zone as user metadata,
-- because with email confirmation on there is no session yet to write the row from the browser.
create or replace function public.create_locker_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.lockers (user_id, alerts_on, time_zone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'alerts', '') = 'true',  -- never fails sign-up on odd input
    left(coalesce(nullif(new.raw_user_meta_data ->> 'time_zone', ''), 'UTC'), 64)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.create_locker_for_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_locker_for_new_user();

-- Wishlist alerts already sent: one per account, item and shop listing (a 3-day listing = one email).
create table public.alerts_sent (
  user_id  uuid        not null references auth.users (id) on delete cascade,
  item_id  text        not null,
  in_date  timestamptz not null,
  sent_at  timestamptz not null default now(),
  primary key (user_id, item_id, in_date)
);
comment on table public.alerts_sent is 'Log of wishlist alert emails, written by the send-alerts Edge Function only.';
alter table public.alerts_sent enable row level security;  -- no policies: service role only

-- Who gets alerts: alerts on, a confirmed account email, and something on the wishlist. Service role only.
-- Alerts only ever go to the account's own confirmed email, so nobody can point them at someone else.
create or replace function public.alert_subscribers()
returns table (user_id uuid, email text, time_zone text, wishlist text[], unsubscribe_token uuid)
language sql stable security definer set search_path = '' as $$
  select l.user_id, u.email::text, l.time_zone, l.wishlist, l.unsubscribe_token
  from public.lockers l
  join auth.users u on u.id = l.user_id
  where l.alerts_on
    and u.email_confirmed_at is not null
    and cardinality(l.wishlist) > 0;
$$;
revoke execute on function public.alert_subscribers() from public, anon, authenticated;
grant execute on function public.alert_subscribers() to service_role;

-- One-click unsubscribe from an alert email link. Service role only (called by the unsubscribe function).
create or replace function public.unsubscribe_alerts(p_token uuid)
returns boolean language sql security definer set search_path = '' as $$
  with u as (update public.lockers set alerts_on = false where unsubscribe_token = p_token returning 1)
  select exists (select 1 from u);
$$;
revoke execute on function public.unsubscribe_alerts(uuid) from public, anon, authenticated;
grant execute on function public.unsubscribe_alerts(uuid) to service_role;

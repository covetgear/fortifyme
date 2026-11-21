-- Supports the hosted site (Vercel): /api/shop reads last-seen dates, /api/contact stores messages.

-- Last time each item was in the shop before its current listing, for many items at once.
-- Same rule as item_last_seen: ignores a re-listing that starts the day after the previous one ended.
create or replace function public.shop_last_seen(p_ids text[], p_before timestamptz[])
returns table (item_id text, last_seen timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id,
         (select max(a.out_date)
            from public.shop_appearances a
           where a.item_id = i.id
             and a.out_date < i.before_ts - interval '1 day')
  from unnest(p_ids, p_before) as i(id, before_ts);
$$;
grant execute on function public.shop_last_seen(text[], timestamptz[]) to anon, authenticated;

-- Contact form messages. No read policies: only the dashboard / service role can read them.
create table public.contact_messages (
  id          bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  topic       text not null check (topic in ('general', 'bug', 'data', 'idea', 'sponsor', 'privacy', 'legal')),
  name        text not null default '' check (char_length(name) <= 80),
  email       text not null check (char_length(email) between 3 and 200),
  message     text not null check (char_length(message) between 10 and 5000),
  page        text not null default '' check (char_length(page) <= 500)
);
comment on table public.contact_messages is 'Messages from the site''s Contact form (via /api/contact).';
alter table public.contact_messages enable row level security;

-- The only way in for visitors: validates, and stops at 100 messages an hour site-wide to limit spam floods.
create or replace function public.submit_contact(p_topic text, p_name text, p_email text, p_message text, p_page text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.contact_messages where received_at > now() - interval '1 hour') >= 100 then
    raise exception 'Too many messages right now' using errcode = 'P0001';
  end if;
  if coalesce(p_email, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Invalid email' using errcode = '22023';
  end if;
  insert into public.contact_messages (topic, name, email, message, page)
  values (
    case when p_topic in ('general', 'bug', 'data', 'idea', 'sponsor', 'privacy', 'legal') then p_topic else 'general' end,
    left(coalesce(trim(p_name), ''), 80),
    left(trim(p_email), 200),
    left(trim(p_message), 5000),
    left(coalesce(trim(p_page), ''), 500)
  );
end;
$$;
revoke execute on function public.submit_contact(text, text, text, text, text) from public;
grant execute on function public.submit_contact(text, text, text, text, text) to anon, authenticated;

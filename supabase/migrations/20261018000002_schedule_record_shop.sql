-- Requires two Vault secrets, created once per project (not stored in this file):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<legacy anon key>', 'anon_key');
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Calls the record-shop Edge Function. URL and key are read from Vault (secrets project_url, anon_key).
create or replace function public.invoke_record_shop()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/record-shop',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$;
revoke execute on function public.invoke_record_shop() from public, anon, authenticated;

-- The shop resets at 00:00 UTC. Run 10 minutes after, plus a 06:10 retry in case the API was late.
select cron.schedule('record-shop-daily', '10 0 * * *', $$ select public.invoke_record_shop(); $$);
select cron.schedule('record-shop-retry', '10 6 * * *', $$ select public.invoke_record_shop(); $$);

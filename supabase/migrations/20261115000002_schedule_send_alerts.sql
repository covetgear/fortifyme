-- Calls the send-alerts Edge Function. Uses the same Vault secrets as record-shop (project_url, anon_key).
create or replace function public.invoke_send_alerts()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$;
revoke execute on function public.invoke_send_alerts() from public, anon, authenticated;

-- 20 minutes after record-shop (00:10). The 06:30 run catches anyone missed (API late, daily cap);
-- alerts_sent stops anyone getting the same alert twice.
select cron.schedule('send-alerts-daily', '30 0 * * *', $$ select public.invoke_send_alerts(); $$);
select cron.schedule('send-alerts-retry', '30 6 * * *', $$ select public.invoke_send_alerts(); $$);

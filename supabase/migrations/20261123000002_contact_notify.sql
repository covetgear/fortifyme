-- Email the site owner each new Contact form message (Edge Function notify-contact).
-- notified_at is set by the function after a successful send, so each message is emailed once.
alter table public.contact_messages add column notified_at timestamptz;

create or replace function public.contact_messages_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notify-contact',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key')
    ),
    body := jsonb_build_object('id', new.id),
    timeout_milliseconds := 10000
  );
  return new;
end;
$$;
revoke execute on function public.contact_messages_notify() from public, anon, authenticated;

create trigger contact_messages_notify
after insert on public.contact_messages
for each row execute function public.contact_messages_notify();

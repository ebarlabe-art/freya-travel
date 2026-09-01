create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create extension if not exists supabase_vault with schema vault;

do $$
declare
  cron_url_count integer;
  cron_token_count integer;
  cron_url text;
  cron_token_valid boolean;
begin
  select count(*), min(decrypted_secret)
  into cron_url_count, cron_url
  from vault.decrypted_secrets
  where name = 'freya_itinerary_notifications_url';

  select
    count(*),
    bool_and(decrypted_secret is not null and char_length(decrypted_secret) >= 32)
  into cron_token_count, cron_token_valid
  from vault.decrypted_secrets
  where name = 'freya_itinerary_cron_token';

  if cron_url_count <> 1 then
    raise exception 'Vault secret freya_itinerary_notifications_url must exist exactly once';
  end if;

  if cron_url <> 'https://otueskpksylzvkhldoft.supabase.co/functions/v1/send-itinerary-notifications' then
    raise exception 'Vault secret freya_itinerary_notifications_url has an unexpected value';
  end if;

  if cron_token_count <> 1 or not coalesce(cron_token_valid, false) then
    raise exception 'Vault secret freya_itinerary_cron_token must exist exactly once and be valid';
  end if;
end
$$;

select cron.schedule(
  'freya-itinerary-notifications',
  '*/5 * * * *',
  $cron$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'freya_itinerary_notifications_url'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-itinerary-cron-token', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'freya_itinerary_cron_token'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    ) as request_id;
  $cron$
);

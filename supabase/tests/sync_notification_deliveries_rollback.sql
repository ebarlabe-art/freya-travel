begin;

do $$
declare
  test_user_id uuid := gen_random_uuid();
  test_trip_id uuid := gen_random_uuid();
  test_activity_id uuid := gen_random_uuid();
  first_subscription_id uuid := gen_random_uuid();
  second_subscription_id uuid := gen_random_uuid();
  first_endpoint text := 'https://push.invalid/' || gen_random_uuid()::text;
  second_endpoint text := 'https://push.invalid/' || gen_random_uuid()::text;
  initial_start timestamptz := date_trunc('second', statement_timestamp() + interval '2 hours');
  expected_schedule timestamptz;
  sent_schedule timestamptz;
  inserted_count integer;
  delivery_count integer;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    test_user_id,
    'authenticated',
    'authenticated',
    'sync-deliveries-' || test_user_id::text || '@example.invalid',
    '',
    statement_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    statement_timestamp(),
    statement_timestamp()
  );

  insert into public.trips (id, name, owner_id, time_zone)
  values (test_trip_id, 'Notification sync rollback test', test_user_id, 'Europe/London');

  insert into public.itinerary_activities (
    id, trip_id, stable_activity_id, title, starts_at, time_zone,
    notifications_enabled, notify_before_minutes
  ) values (
    test_activity_id,
    test_trip_id,
    'sync-notification-test',
    'Notification sync test',
    initial_start,
    'Europe/London',
    true,
    60
  );

  insert into public.push_subscriptions (
    id, user_id, trip_id, endpoint, p256dh, auth, active
  ) values (
    first_subscription_id,
    test_user_id,
    test_trip_id,
    first_endpoint,
    'test-p256dh',
    'test-auth',
    true
  );

  inserted_count := public.sync_notification_deliveries();
  if inserted_count <> 1 then
    raise exception 'first sync inserted %, expected 1', inserted_count;
  end if;

  inserted_count := public.sync_notification_deliveries();
  if inserted_count <> 0 then
    raise exception 'second sync inserted %, expected 0', inserted_count;
  end if;

  select count(*) into delivery_count
  from public.notification_deliveries
  where activity_id = test_activity_id;
  if delivery_count <> 1 then
    raise exception 'idempotency count was %, expected 1', delivery_count;
  end if;

  update public.notification_deliveries
  set status = 'retry',
      attempt_count = 2,
      next_attempt_at = statement_timestamp() + interval '5 minutes',
      last_error_code = 'push-network-error'
  where activity_id = test_activity_id
    and subscription_id = first_subscription_id;

  update public.itinerary_activities
  set starts_at = initial_start + interval '30 minutes',
      notify_before_minutes = 30
  where id = test_activity_id;
  expected_schedule := initial_start;
  perform public.sync_notification_deliveries();

  if not exists (
    select 1 from public.notification_deliveries
    where activity_id = test_activity_id
      and subscription_id = first_subscription_id
      and scheduled_for = expected_schedule
      and status = 'pending'
      and attempt_count = 0
      and next_attempt_at is null
      and last_error_code is null
  ) then
    raise exception 'rescheduling did not reset the eligible delivery safely';
  end if;

  update public.itinerary_activities
  set notifications_enabled = false
  where id = test_activity_id;
  perform public.sync_notification_deliveries();

  if not exists (
    select 1 from public.notification_deliveries
    where activity_id = test_activity_id
      and subscription_id = first_subscription_id
      and status = 'missed'
      and last_error_code = 'notifications-disabled'
  ) then
    raise exception 'disabling notifications did not stop the pending delivery';
  end if;

  update public.itinerary_activities
  set notifications_enabled = true
  where id = test_activity_id;
  perform public.sync_notification_deliveries();

  if not exists (
    select 1 from public.notification_deliveries
    where activity_id = test_activity_id
      and subscription_id = first_subscription_id
      and status = 'pending'
      and last_error_code is null
  ) then
    raise exception 're-enabling notifications did not restore the eligible delivery';
  end if;

  insert into public.push_subscriptions (
    id, user_id, trip_id, endpoint, p256dh, auth, active
  ) values (
    second_subscription_id,
    test_user_id,
    test_trip_id,
    second_endpoint,
    'test-p256dh',
    'test-auth',
    true
  );

  inserted_count := public.sync_notification_deliveries();
  if inserted_count <> 1 then
    raise exception 'new subscription sync inserted %, expected 1', inserted_count;
  end if;

  update public.push_subscriptions set active = false
  where id = second_subscription_id;
  perform public.sync_notification_deliveries();

  if not exists (
    select 1 from public.notification_deliveries
    where activity_id = test_activity_id
      and subscription_id = second_subscription_id
      and status = 'gone'
      and last_error_code = 'subscription-inactive'
  ) then
    raise exception 'inactive subscription did not stop its pending delivery';
  end if;

  update public.push_subscriptions set active = true
  where id = second_subscription_id;
  perform public.sync_notification_deliveries();

  if not exists (
    select 1 from public.notification_deliveries
    where activity_id = test_activity_id
      and subscription_id = second_subscription_id
      and status = 'pending'
      and last_error_code is null
  ) then
    raise exception 'reactivating the subscription did not restore its eligible delivery';
  end if;

  update public.notification_deliveries
  set status = 'sent',
      sent_at = statement_timestamp(),
      last_error_code = null
  where activity_id = test_activity_id
    and subscription_id = first_subscription_id
  returning scheduled_for into sent_schedule;

  update public.itinerary_activities
  set starts_at = starts_at + interval '1 hour'
  where id = test_activity_id;
  expected_schedule := expected_schedule + interval '1 hour';
  perform public.sync_notification_deliveries();

  if not exists (
    select 1 from public.notification_deliveries
    where activity_id = test_activity_id
      and subscription_id = first_subscription_id
      and status = 'sent'
      and scheduled_for = sent_schedule
  ) then
    raise exception 'a sent delivery was modified';
  end if;

  if not exists (
    select 1 from public.notification_deliveries
    where activity_id = test_activity_id
      and subscription_id = second_subscription_id
      and status = 'pending'
      and scheduled_for = expected_schedule
  ) then
    raise exception 'the unsent delivery was not rescheduled';
  end if;

  delete from public.itinerary_activities where id = test_activity_id;

  select count(*) into delivery_count
  from public.notification_deliveries
  where activity_id = test_activity_id;
  if delivery_count <> 0 then
    raise exception 'activity deletion did not cascade to deliveries';
  end if;

  raise notice 'sync_notification_deliveries rollback test passed';
end;
$$;

rollback;

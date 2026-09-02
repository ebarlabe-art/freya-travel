create or replace function public.sync_notification_deliveries()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  update public.notification_deliveries as delivery
  set
    status = 'missed',
    next_attempt_at = null,
    lease_until = null,
    sent_at = null,
    last_error_code = 'notifications-disabled',
    updated_at = statement_timestamp()
  from public.itinerary_activities as activity
  where delivery.activity_id = activity.id
    and delivery.notification_kind = 'activity-1h'
    and delivery.status in ('pending', 'retry')
    and not activity.notifications_enabled;

  update public.notification_deliveries as delivery
  set
    status = 'gone',
    next_attempt_at = null,
    lease_until = null,
    sent_at = null,
    last_error_code = 'subscription-inactive',
    updated_at = statement_timestamp()
  from public.itinerary_activities as activity,
       public.push_subscriptions as subscription
  where delivery.activity_id = activity.id
    and delivery.subscription_id = subscription.id
    and delivery.notification_kind = 'activity-1h'
    and delivery.status in ('pending', 'retry')
    and activity.notifications_enabled
    and not subscription.active;

  update public.notification_deliveries as delivery
  set
    scheduled_for = activity.starts_at
      - pg_catalog.make_interval(mins => activity.notify_before_minutes),
    status = 'pending',
    attempt_count = 0,
    next_attempt_at = null,
    lease_until = null,
    sent_at = null,
    last_error_code = null,
    updated_at = statement_timestamp()
  from public.itinerary_activities as activity,
       public.push_subscriptions as subscription
  where delivery.activity_id = activity.id
    and delivery.subscription_id = subscription.id
    and delivery.notification_kind = 'activity-1h'
    and activity.notifications_enabled
    and activity.starts_at > statement_timestamp()
    and subscription.active
    and (
      (
        delivery.status in ('pending', 'retry')
        and delivery.scheduled_for is distinct from (
          activity.starts_at
            - pg_catalog.make_interval(mins => activity.notify_before_minutes)
        )
      )
      or (
        delivery.status = 'missed'
        and (
          delivery.last_error_code = 'notifications-disabled'
          or (
            delivery.last_error_code in ('delivery-expired', 'retry-window-expired')
            and delivery.scheduled_for is distinct from (
              activity.starts_at
                - pg_catalog.make_interval(mins => activity.notify_before_minutes)
            )
          )
        )
      )
      or (
        delivery.status = 'gone'
        and delivery.last_error_code = 'subscription-inactive'
      )
    );

  insert into public.notification_deliveries (
    activity_id,
    subscription_id,
    notification_kind,
    scheduled_for,
    status
  )
  select
    activity.id,
    subscription.id,
    'activity-1h',
    activity.starts_at
      - pg_catalog.make_interval(mins => activity.notify_before_minutes),
    'pending'
  from public.itinerary_activities as activity
  join public.push_subscriptions as subscription
    on subscription.trip_id = activity.trip_id
   and subscription.active
  where activity.notifications_enabled
    and activity.starts_at > statement_timestamp()
  on conflict (activity_id, subscription_id, notification_kind) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.sync_notification_deliveries()
  from public, anon, authenticated;

grant execute on function public.sync_notification_deliveries()
  to service_role;

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.itinerary_activities(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  notification_kind text not null default 'activity-1h',
  scheduled_for timestamptz not null,
  status text not null,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  lease_until timestamptz,
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_deliveries_activity_subscription_kind_key
    unique (activity_id, subscription_id, notification_kind),
  constraint notification_deliveries_notification_kind_not_blank
    check (
      notification_kind = btrim(notification_kind)
      and char_length(notification_kind) between 1 and 100
    ),
  constraint notification_deliveries_status_valid
    check (status in ('pending', 'processing', 'retry', 'sent', 'gone', 'failed', 'missed')),
  constraint notification_deliveries_attempt_count_nonnegative
    check (attempt_count >= 0),
  constraint notification_deliveries_last_error_code_length
    check (
      last_error_code is null
      or (
        last_error_code = btrim(last_error_code)
        and char_length(last_error_code) between 1 and 100
      )
    )
);

create index notification_deliveries_pending_claim_idx
  on public.notification_deliveries (scheduled_for)
  where status = 'pending';

create index notification_deliveries_retry_claim_idx
  on public.notification_deliveries (next_attempt_at, scheduled_for)
  where status = 'retry';

create index notification_deliveries_expired_lease_claim_idx
  on public.notification_deliveries (lease_until, scheduled_for)
  where status = 'processing';

alter table public.notification_deliveries enable row level security;

revoke all on table public.notification_deliveries from anon, authenticated;
grant select, insert, update, delete on table public.notification_deliveries to service_role;

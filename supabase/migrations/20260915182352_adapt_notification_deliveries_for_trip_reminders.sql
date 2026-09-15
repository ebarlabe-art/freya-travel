-- Prepare notification_deliveries for the universal reminder engine
-- while preserving the legacy London notification path.

alter table public.notification_deliveries
  add column reminder_id uuid
  references public.trip_reminders(id)
  on delete cascade;

-- Legacy London deliveries keep using activity_id.
-- Universal deliveries will instead use reminder_id.
alter table public.notification_deliveries
  alter column activity_id drop not null;

-- Every delivery must belong to exactly one source:
-- either the legacy itinerary activity OR the universal reminder.
alter table public.notification_deliveries
  add constraint notification_deliveries_exactly_one_source
  check (
    (
      activity_id is not null
      and reminder_id is null
    )
    or
    (
      activity_id is null
      and reminder_id is not null
    )
  );

-- Preserve the existing legacy uniqueness constraint on activity_id.
-- Add the equivalent uniqueness rule for universal reminders.
create unique index notification_deliveries_reminder_subscription_kind_key
  on public.notification_deliveries (
    reminder_id,
    subscription_id,
    notification_kind
  )
  where reminder_id is not null;

comment on column public.notification_deliveries.reminder_id is
  'Universal reminder source. Legacy London deliveries continue to use activity_id.';

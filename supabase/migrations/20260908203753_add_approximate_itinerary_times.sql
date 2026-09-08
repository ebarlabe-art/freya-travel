alter table public.trip_itinerary_items
  add column approximate_start_time time without time zone,
  add column approximate_end_time time without time zone;

alter table public.trip_itinerary_items
  drop constraint trip_itinerary_items_timing_kind_check,
  drop constraint trip_itinerary_items_timing_fields_check,
  add constraint trip_itinerary_items_timing_kind_check
    check (
      timing_kind in (
        'exact', 'approximate', 'date', 'all_day', 'daypart', 'unscheduled'
      )
    ) not valid,
  add constraint trip_itinerary_items_timing_fields_check
    check (
      (
        timing_kind = 'exact'
        and starts_at is not null
        and time_zone is not null
        and local_date is null
        and daypart is null
        and approximate_start_time is null
        and approximate_end_time is null
      )
      or (
        timing_kind = 'approximate'
        and local_date is not null
        and approximate_start_time is not null
        and time_zone is not null
        and starts_at is null
        and ends_at is null
        and daypart is null
      )
      or (
        timing_kind in ('date', 'all_day')
        and local_date is not null
        and starts_at is null
        and ends_at is null
        and daypart is null
        and approximate_start_time is null
        and approximate_end_time is null
      )
      or (
        timing_kind = 'daypart'
        and local_date is not null
        and starts_at is null
        and ends_at is null
        and daypart is not null
        and approximate_start_time is null
        and approximate_end_time is null
      )
      or (
        timing_kind = 'unscheduled'
        and local_date is null
        and starts_at is null
        and ends_at is null
        and daypart is null
        and approximate_start_time is null
        and approximate_end_time is null
      )
    ) not valid,
  add constraint trip_itinerary_items_approximate_time_order_check
    check (
      approximate_end_time is null
      or approximate_end_time > approximate_start_time
    ) not valid;

alter table public.trip_itinerary_items
  validate constraint trip_itinerary_items_timing_kind_check,
  validate constraint trip_itinerary_items_timing_fields_check,
  validate constraint trip_itinerary_items_approximate_time_order_check;

comment on column public.trip_itinerary_items.approximate_start_time is
  'Trip-local planning time. It is deliberately not an exact timestamptz commitment.';

comment on column public.trip_itinerary_items.approximate_end_time is
  'Optional trip-local end of an approximate planning range.';

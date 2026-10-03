alter table public.trip_accommodations
  add column if not exists check_in_date date,
  add column if not exists check_out_date date;

update public.trip_accommodations
set
  check_in_date=coalesce(check_in_date,(check_in_at at time zone coalesce(time_zone,'UTC'))::date),
  check_out_date=coalesce(check_out_date,(check_out_at at time zone coalesce(time_zone,'UTC'))::date)
where check_in_date is null or check_out_date is null;

alter table public.trip_accommodations
  add constraint trip_accommodations_date_order_check
  check (check_in_date is null or check_out_date is null or check_out_date >= check_in_date);

comment on column public.trip_accommodations.check_in_date is 'Calendar date of accommodation arrival when known, independent of an exact check-in time.';
comment on column public.trip_accommodations.check_out_date is 'Calendar date of accommodation departure when known, independent of an exact check-out time.';

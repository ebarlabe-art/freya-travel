-- Only invoked by the disposable LOCAL runner after the new migration.
do $$ begin
  if exists (
    (select source,row from public.progress_before_snapshot except
     (select 'activity',to_jsonb(a)-'completed_at' from public.trip_activities a
      union all select 'flight',to_jsonb(f)-'completed_at' from public.trip_flights f
      union all select 'accommodation',to_jsonb(a)-'check_in_completed_at'-'check_out_completed_at' from public.trip_accommodations a
      union all select 'manual',to_jsonb(i) from public.trip_itinerary_items i))
  ) then raise exception 'Migration changed existing data';end if;
  if exists(select 1 from public.trip_activities where completed_at is not null)
     or exists(select 1 from public.trip_flights where completed_at is not null)
     or exists(select 1 from public.trip_accommodations where check_in_completed_at is not null or check_out_completed_at is not null)
  then raise exception 'Migration backfilled new progress';end if;
end; $$;
drop table public.progress_before_snapshot;

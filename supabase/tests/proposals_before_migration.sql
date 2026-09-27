-- Disposable DB only: exact snapshots of existing authoritative rows.
create table public.tb04_before as select jsonb_build_object(
 'briefs',(select jsonb_agg(to_jsonb(b) order by id) from public.trip_briefs b),
 'receipts',(select jsonb_agg(to_jsonb(r) order by owner_id,operation_id) from public.trip_brief_operations r),
 'trips',(select jsonb_agg(to_jsonb(t) order by id) from public.trips t),
 'reminders',(select jsonb_agg(to_jsonb(r) order by id) from public.trip_reminders r)
) as state;

-- Supabase production applied RIG-03B under version 20261029172805.
-- Earlier version 20261029141108 contains the additive, re-applicable definitions.
-- This later migration validates that both migration histories have the functions.
do $reconciliation_gate$
begin
 if to_regprocedure('public.read_itinerary_reconciliation(uuid)') is null or
    to_regprocedure('public.commit_itinerary_reconciliation(uuid,uuid,uuid,jsonb,jsonb)') is null or
    to_regprocedure('itinerary_private.commit_reconciliation(uuid,uuid,uuid,jsonb,jsonb)') is null then
   raise exception 'RIG-03B migration contract missing';
 end if;
end
$reconciliation_gate$;

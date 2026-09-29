-- TB-06 budget summary: derived totals, no FX conversion.
create or replace function public.get_trip_budget_v1(p_trip_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare settings jsonb; currencies jsonb; unknown_components integer; total_components integer; unknown_required integer;
begin
  if auth.uid() is null or not public.is_trip_member(p_trip_id) then raise exception 'Trip unavailable' using errcode='42501'; end if;
  select case when b.trip_id is null then null else jsonb_build_object('target_amount',b.target_amount,'maximum_amount',b.maximum_amount,'currency',b.currency,'revision',b.revision,'updated_at',b.updated_at) end
  into settings from (select p_trip_id as trip_id) x left join public.trip_budget_settings b on b.trip_id=x.trip_id;

  with priced as (
    select l.component_id,c.currency,c.expected_amount,c.confirmed_amount,c.unknown_required_costs,coalesce(c.confirmed_amount,c.expected_amount) effective_amount
    from public.trip_proposal_component_links l left join public.trip_component_costs c on c.trip_id=l.trip_id and c.component_id=l.component_id
    where l.trip_id=p_trip_id
  )
  select count(*)::int,count(*) filter(where effective_amount is null)::int,
         coalesce(sum(case when unknown_required_costs is null then 0 else jsonb_array_length(unknown_required_costs) end),0)::int
  into total_components,unknown_components,unknown_required from priced;

  with priced as (
    select c.currency,c.expected_amount,c.confirmed_amount,coalesce(c.confirmed_amount,c.expected_amount) effective_amount,(c.confirmed_amount is not null) is_confirmed
    from public.trip_proposal_component_links l join public.trip_component_costs c on c.trip_id=l.trip_id and c.component_id=l.component_id
    where l.trip_id=p_trip_id and coalesce(c.confirmed_amount,c.expected_amount) is not null
  ), grouped as (
    select currency,round(sum(effective_amount),2) total,
           round(coalesce(sum(effective_amount) filter(where is_confirmed),0),2) confirmed_total,
           round(coalesce(sum(effective_amount) filter(where not is_confirmed),0),2) expected_total,
           count(*)::int priced_components,
           count(*) filter(where confirmed_amount is not null)::int confirmed_components,
           count(*) filter(where confirmed_amount is null and expected_amount is not null)::int expected_components
    from priced group by currency
  )
  select coalesce(jsonb_agg(to_jsonb(grouped) order by currency),'[]'::jsonb) into currencies from grouped;

  return jsonb_build_object('trip_id',p_trip_id,'settings',settings,'currencies',coalesce(currencies,'[]'::jsonb),'total_components',coalesce(total_components,0),'unknown_components',coalesce(unknown_components,0),'unknown_required_costs',coalesce(unknown_required,0),'provisional',coalesce(unknown_components,0)>0 or coalesce(unknown_required,0)>0);
end; $$;
revoke all on function public.get_trip_budget_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_trip_budget_v1(uuid) to authenticated;

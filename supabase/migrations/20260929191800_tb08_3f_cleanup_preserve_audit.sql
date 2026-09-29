-- TB-08.3f · preserve immutable cost audit when a standalone source is deleted
create or replace function proposal_private.cleanup_standalone_component_link()
returns trigger language plpgsql security definer set search_path='' as $$
declare cid text;
begin
  select component_id into cid
  from public.trip_standalone_component_links
  where trip_id=old.trip_id and source_kind=tg_argv[0] and source_id=old.id;

  if cid is not null then
    delete from public.trip_standalone_component_links
    where trip_id=old.trip_id and component_id=cid;
  end if;
  return old;
end $$;

revoke all on function proposal_private.cleanup_standalone_component_link()
from public, anon, authenticated, service_role;

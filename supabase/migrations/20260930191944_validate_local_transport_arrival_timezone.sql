create or replace function public.enforce_trip_activity_integrity()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Cal iniciar sessio'
      using errcode = '42501';
  end if;

  if new.time_zone is not null
     and not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_record
       where timezone_record.name = new.time_zone
     ) then
    raise exception 'La zona horaria de l activitat no es valida'
      using errcode = '22023';
  end if;

  if new.transport_arrival_time_zone is not null
     and not exists (
       select 1
       from pg_catalog.pg_timezone_names as timezone_record
       where timezone_record.name = new.transport_arrival_time_zone
     ) then
    raise exception 'La zona horaria d arribada del transport no es valida'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    new.updated_by := null;
    new.created_at := statement_timestamp();
    new.updated_at := new.created_at;
  else
    if new.id is distinct from old.id
       or new.trip_id is distinct from old.trip_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'No es poden modificar els camps immutables de l activitat'
        using errcode = '42501';
    end if;

    new.updated_by := auth.uid();
    new.updated_at := statement_timestamp();
  end if;

  return new;
end;
$function$;
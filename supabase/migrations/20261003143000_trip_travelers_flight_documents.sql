create table public.trip_travelers (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  display_name text not null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint trip_travelers_trip_id_id_key unique (trip_id,id),
  constraint trip_travelers_name_check check (display_name=btrim(display_name) and char_length(display_name) between 1 and 200)
);
create unique index trip_travelers_name_idx on public.trip_travelers(trip_id,lower(display_name));

create table public.trip_flight_travelers (
  trip_id uuid not null,
  flight_id uuid not null,
  traveler_id uuid not null,
  seat text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(trip_id,flight_id,traveler_id),
  foreign key(trip_id,flight_id) references public.trip_flights(trip_id,id) on delete cascade,
  foreign key(trip_id,traveler_id) references public.trip_travelers(trip_id,id) on delete cascade,
  constraint trip_flight_travelers_seat_check check(seat is null or (seat=btrim(seat) and char_length(seat) between 1 and 100))
);

create table public.trip_flight_traveler_documents (
  trip_id uuid not null,
  flight_id uuid not null,
  traveler_id uuid not null,
  document_id uuid not null,
  document_role text not null default 'boarding_pass',
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(trip_id,flight_id,traveler_id,document_role,document_id),
  foreign key(trip_id,flight_id,traveler_id) references public.trip_flight_travelers(trip_id,flight_id,traveler_id) on delete cascade,
  foreign key(trip_id,document_id) references public.travel_documents(trip_id,id) on delete cascade,
  constraint trip_flight_traveler_documents_role_check check(document_role='boarding_pass')
);

alter table public.trip_travelers enable row level security;
alter table public.trip_flight_travelers enable row level security;
alter table public.trip_flight_traveler_documents enable row level security;
grant select,insert,update,delete on public.trip_travelers,public.trip_flight_travelers,public.trip_flight_traveler_documents to authenticated;

create policy "members manage travelers" on public.trip_travelers for all to authenticated using(public.is_trip_member(trip_id)) with check(public.is_trip_member(trip_id) and created_by=(select auth.uid()));
create policy "members manage flight travelers" on public.trip_flight_travelers for all to authenticated using(public.is_trip_member(trip_id)) with check(public.is_trip_member(trip_id) and created_by=(select auth.uid()));
create policy "members manage traveler flight documents" on public.trip_flight_traveler_documents for all to authenticated using(public.is_trip_member(trip_id)) with check(public.is_trip_member(trip_id) and created_by=(select auth.uid()));

create function public.ensure_trip_flight_travelers(p_trip_id uuid,p_flight_ids uuid[],p_names text[])
returns table(traveler_id uuid,display_name text)
language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_name text; v_traveler uuid; v_flight uuid;
begin
 if v_user is null or not public.is_trip_member(p_trip_id) then raise exception 'No autoritzat' using errcode='42501'; end if;
 foreach v_name in array coalesce(p_names,array[]::text[]) loop
   v_name:=btrim(v_name); if v_name='' then continue; end if;
   select id into v_traveler from public.trip_travelers where trip_id=p_trip_id and lower(display_name)=lower(v_name);
   if v_traveler is null then
     insert into public.trip_travelers(trip_id,display_name,created_by) values(p_trip_id,v_name,v_user) returning id into v_traveler;
   end if;
   foreach v_flight in array coalesce(p_flight_ids,array[]::uuid[]) loop
     if not exists(select 1 from public.trip_flights where trip_id=p_trip_id and id=v_flight) then raise exception 'Vol fora del viatge' using errcode='23503'; end if;
     insert into public.trip_flight_travelers(trip_id,flight_id,traveler_id,created_by) values(p_trip_id,v_flight,v_traveler,v_user) on conflict do nothing;
   end loop;
   traveler_id:=v_traveler;display_name:=v_name;return next;
 end loop;
end $$;
revoke all on function public.ensure_trip_flight_travelers(uuid,uuid[],text[]) from public,anon;
grant execute on function public.ensure_trip_flight_travelers(uuid,uuid[],text[]) to authenticated;

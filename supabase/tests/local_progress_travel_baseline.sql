-- TEST FIXTURE ONLY. Pre-migration contracts absent from migration history.
-- travel_documents matches docs/database/travel-data-production-baseline.md.
create table public.travel_documents (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null, category text not null default 'Altres',
  file_name text not null, file_path text not null unique, mime_type text,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
alter table public.travel_documents enable row level security;
grant select,insert,update,delete on public.travel_documents to authenticated;
create policy documents_read on public.travel_documents for select to authenticated using (public.is_trip_member(trip_id));
create policy documents_insert on public.travel_documents for insert to authenticated with check (public.is_trip_member(trip_id) and created_by=auth.uid());
create policy documents_update on public.travel_documents for update to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
create policy documents_delete on public.travel_documents for delete to authenticated using (public.is_trip_member(trip_id));
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  endpoint text not null unique, p256dh text not null, auth text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

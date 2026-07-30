create table if not exists public.travel_expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  concept text not null check (char_length(trim(concept)) between 1 and 200),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'GBP' check (currency in ('GBP','EUR')),
  paid_by text not null default 'Compte comú',
  category text not null default 'Altres',
  expense_date date not null default current_date,
  place text,
  receipt_path text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.travel_expenses enable row level security;
grant select, insert, update, delete on public.travel_expenses to authenticated;
drop policy if exists "members can view expenses" on public.travel_expenses;
create policy "members can view expenses" on public.travel_expenses for select to authenticated using (public.is_trip_member(trip_id));
drop policy if exists "members can add expenses" on public.travel_expenses;
create policy "members can add expenses" on public.travel_expenses for insert to authenticated with check (public.is_trip_member(trip_id) and created_by = auth.uid());
drop policy if exists "members can update expenses" on public.travel_expenses;
create policy "members can update expenses" on public.travel_expenses for update to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
drop policy if exists "members can delete expenses" on public.travel_expenses;
create policy "members can delete expenses" on public.travel_expenses for delete to authenticated using (public.is_trip_member(trip_id));
do $$ begin
  alter publication supabase_realtime add table public.travel_expenses;
exception when duplicate_object then null;
end $$;

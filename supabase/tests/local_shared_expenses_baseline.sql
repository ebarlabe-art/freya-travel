-- Disposable CI baseline only. Represents the confirmed historical travel_expenses
-- contract from docs/database/travel-data-production-baseline.md.
-- Never apply this fixture to a real Supabase project.
create table public.travel_expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check(amount > 0),
  currency text not null default 'GBP',
  paid_by text not null default 'Compte comú',
  category text not null default 'Altres',
  expense_date date,
  place text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  receipt_path text,
  constraint travel_expenses_currency_check check(currency in ('GBP','EUR')),
  constraint travel_expenses_paid_by_check check(paid_by in ('Eva','Xesc','Compte comú'))
);
alter table public.travel_expenses enable row level security;
grant select, insert, delete on public.travel_expenses to authenticated;
create policy "local members read travel expenses" on public.travel_expenses
for select to authenticated using(public.is_trip_member(trip_id));
create policy "local members add travel expenses" on public.travel_expenses
for insert to authenticated with check(public.is_trip_member(trip_id) and created_by=auth.uid());
create policy "local members remove travel expenses" on public.travel_expenses
for delete to authenticated using(public.is_trip_member(trip_id));

-- Shared trip expenses v1. Extension of the existing travel_expenses ledger.
-- NOT APPLIED: deploy this migration only after explicit authorization.
-- Preserve legacy London rows (payer_user_id and split_shares remain NULL).

alter table public.travel_expenses
  add column payer_user_id uuid,
  add column split_shares jsonb;

-- Confirmed read-only against the canonical production schema on 2026-11-24:
-- these are the two exact historical CHECK constraints. Drop nothing else.
-- Abort rather than removing unrelated constraints if production has drifted.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conrelid='public.travel_expenses'::regclass
    and conname='travel_expenses_currency_check' and contype='c'
    and pg_get_constraintdef(oid) ilike '%GBP%' and pg_get_constraintdef(oid) ilike '%EUR%'
  ) or not exists (
    select 1 from pg_constraint where conrelid='public.travel_expenses'::regclass
    and conname='travel_expenses_paid_by_check' and contype='c'
    and pg_get_constraintdef(oid) ilike '%Compte comú%'
  ) then
    raise exception 'Unexpected legacy travel_expenses constraints; review before changing schema';
  end if;
end $$;

alter table public.travel_expenses
  drop constraint travel_expenses_currency_check,
  drop constraint travel_expenses_paid_by_check;

alter table public.travel_expenses
  add constraint travel_expenses_currency_iso_v1
    check (currency ~ '^[A-Z]{3}$'),
  add constraint travel_expenses_payer_nonempty_v1
    check (char_length(btrim(paid_by)) between 1 and 120),
  add constraint travel_expenses_split_pair_v1
    check ((payer_user_id is null) = (split_shares is null));

create or replace function public.validate_shared_travel_expense_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  item jsonb;
  actor_text text;
  cents_text text;
  participant uuid;
  total_cents numeric := 0;
  seen uuid[] := '{}'::uuid[];
begin
  if new.payer_user_id is null and new.split_shares is null then
    if tg_op = 'INSERT' and exists(select 1 from public.trips where id=new.trip_id and experience_key is distinct from 'london-2026') then
      raise exception 'Shared split required for generic trips' using errcode='23514';
    end if;
    return new;
  end if;
  if new.payer_user_id is null or new.split_shares is null
     or jsonb_typeof(new.split_shares) is distinct from 'array'
     or jsonb_array_length(new.split_shares) not between 1 and 100 then
    raise exception 'Invalid shared expense split' using errcode='22023';
  end if;
  if new.amount is null or new.amount <= 0 or new.amount * 100 <> trunc(new.amount * 100) then
    raise exception 'Amount needs positive whole cents' using errcode='22023';
  end if;
  if not exists (select 1 from public.trip_members
     where trip_id = new.trip_id and user_id = new.payer_user_id) then
    raise exception 'Payer must belong to this trip' using errcode='23514';
  end if;
  for item in select value from jsonb_array_elements(new.split_shares) value loop
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception 'Invalid split row' using errcode='22023';
    end if;
    actor_text := item->>'user_id';
    cents_text := item->>'amount_cents';
    if actor_text is null or actor_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or cents_text is null or cents_text !~ '^[1-9][0-9]{0,14}$' then
      raise exception 'Invalid split participant or cents' using errcode='22023';
    end if;
    participant := actor_text::uuid;
    if participant = any(seen) or not exists(select 1 from public.trip_members
       where trip_id=new.trip_id and user_id=participant) then
      raise exception 'Split members must be distinct trip members' using errcode='23514';
    end if;
    seen := array_append(seen,participant);
    total_cents := total_cents + cents_text::numeric;
  end loop;
  if total_cents <> new.amount * 100 then
    raise exception 'Split total must match expense amount' using errcode='23514';
  end if;
  return new;
end $$;

create trigger validate_shared_travel_expense_v1
before insert or update of trip_id, amount, payer_user_id, split_shares
on public.travel_expenses
for each row execute function public.validate_shared_travel_expense_v1();

create index travel_expenses_shared_trip_v1_idx
  on public.travel_expenses(trip_id, created_at desc)
  where payer_user_id is not null;

-- Payments already made. No automatic bank transfer or FX conversion.
create table public.trip_expense_settlements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  payer_user_id uuid not null,
  receiver_user_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (payer_user_id <> receiver_user_id),
  check (amount * 100 = trunc(amount * 100)),
  check (created_by in (payer_user_id, receiver_user_id))
);
create index trip_expense_settlements_trip_idx
  on public.trip_expense_settlements(trip_id, created_at desc);

create or replace function public.validate_trip_expense_settlement_v1()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists(select 1 from public.trip_members
       where trip_id=new.trip_id and user_id=new.payer_user_id)
     or not exists(select 1 from public.trip_members
       where trip_id=new.trip_id and user_id=new.receiver_user_id) then
    raise exception 'Settlement must involve trip members' using errcode='23514';
  end if;
  return new;
end $$;
create trigger validate_trip_expense_settlement_v1
before insert or update on public.trip_expense_settlements
for each row execute function public.validate_trip_expense_settlement_v1();

alter table public.trip_expense_settlements enable row level security;
revoke all on public.trip_expense_settlements from public, anon;
grant select, insert, delete on public.trip_expense_settlements to authenticated;
create policy "members view shared settlements"
on public.trip_expense_settlements for select to authenticated
using ((select auth.uid()) is not null and public.is_trip_member(trip_id));
create policy "involved member records shared settlement"
on public.trip_expense_settlements for insert to authenticated
with check ((select auth.uid())=created_by and public.is_trip_member(trip_id));
create policy "creator cancels shared settlement"
on public.trip_expense_settlements for delete to authenticated
using ((select auth.uid())=created_by and public.is_trip_member(trip_id));

-- Stable, voluntary display names. Every member can name only themselves.
create table public.trip_expense_member_labels (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 60),
  primary key(trip_id,user_id)
);
alter table public.trip_expense_member_labels enable row level security;
revoke all on public.trip_expense_member_labels from public, anon;
grant select, insert, update on public.trip_expense_member_labels to authenticated;
create policy "members see shared expense labels"
on public.trip_expense_member_labels for select to authenticated
using (public.is_trip_member(trip_id));
create policy "members name themselves"
on public.trip_expense_member_labels for insert to authenticated
with check (user_id=(select auth.uid()) and public.is_trip_member(trip_id));
create policy "members rename themselves"
on public.trip_expense_member_labels for update to authenticated
using (user_id=(select auth.uid()) and public.is_trip_member(trip_id))
with check (user_id=(select auth.uid()) and public.is_trip_member(trip_id));

-- Restrict shared-expense deletes to the original recorder while retaining
-- the historical London DELETE policy for rows without a split.
-- A restrictive RLS policy does not block FK ON DELETE CASCADE when a trip
-- itself is removed (unlike a BEFORE DELETE trigger on child rows).
create policy "shared expense author can delete"
on public.travel_expenses as restrictive for delete to authenticated
using (payer_user_id is null or created_by=(select auth.uid()));

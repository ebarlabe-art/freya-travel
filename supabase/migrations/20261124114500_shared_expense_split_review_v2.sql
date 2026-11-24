-- Safe editing of existing shared splits after a new member joins a trip.
-- Do not reassign any existing expense automatically.
-- Do not change the historical London expense ledger.
alter table public.travel_expenses
  add column split_revision integer not null default 0
  check (split_revision >= 0);

-- The original expense creator may revise only its allocation and only while
-- they remain a member of that same trip. Other members can still see balances.
create policy "shared expense creator revises split"
on public.travel_expenses
for update to authenticated
using (
  payer_user_id is not null
  and created_by=(select auth.uid())
  and public.is_trip_member(trip_id)
)
with check (
  payer_user_id is not null
  and created_by=(select auth.uid())
  and public.is_trip_member(trip_id)
);
grant update on public.travel_expenses to authenticated;

-- Reject attempts to change amount, payer, currency, trip, author, receipt,
-- metadata or any other field through this split-only edit. Increment a
-- revision to prevent simultaneous editors from overwriting a newer split.
create or replace function public.guard_shared_expense_split_edit_v2()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.payer_user_id is null
     or old.created_by is distinct from auth.uid()
     or (to_jsonb(new) - 'split_shares' - 'split_revision')
        is distinct from (to_jsonb(old) - 'split_shares' - 'split_revision') then
    raise exception 'Only the original creator can revise a shared allocation'
      using errcode='42501';
  end if;
  new.split_revision := old.split_revision + 1;
  return new;
end $$;

create trigger guard_shared_expense_split_edit_v2
before update on public.travel_expenses
for each row execute function public.guard_shared_expense_split_edit_v2();

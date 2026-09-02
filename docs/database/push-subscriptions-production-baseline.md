# `public.push_subscriptions` production baseline

This file records the production contract that predates the migrations in this
repository. It is documentation, not an executable migration. Do not add a
retrospective `create table` migration after migrations that already depend on
this table, and do not mark an unapplied migration as applied in production.

## Verified table contract

| Column | Definition |
| --- | --- |
| `id` | `uuid primary key default gen_random_uuid()` |
| `user_id` | `uuid not null references auth.users(id) on delete cascade` |
| `trip_id` | `uuid not null references public.trips(id) on delete cascade` |
| `endpoint` | `text not null unique` |
| `p256dh` | `text not null` |
| `auth` | `text not null` |
| `active` | `boolean not null default true` |
| `created_at` | `timestamptz not null default now()` |
| `updated_at` | `timestamptz not null default now()` |

The table has Row Level Security enabled. The intended production access
contract is:

- `anon` has no table privileges.
- `authenticated` can select, insert, update, and delete only rows whose
  `user_id` equals `auth.uid()`.
- Insert and update checks additionally require
  `public.is_trip_member(trip_id)`.
- Backend secret/service-role clients retain administrative access and bypass
  RLS; those credentials never belong in the frontend or this repository.

Policy names are not part of the application contract. Before turning this
baseline into executable bootstrap SQL for a new environment, capture and
review the exact live grants and policy expressions with these read-only
queries:

```sql
select
  c.relrowsecurity,
  c.relforcerowsecurity
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'push_subscriptions';

select
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'push_subscriptions'
order by grantee, privilege_type;

select
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'push_subscriptions'
order by policyname;
```

The safe follow-up for reproducible fresh databases is a separately reviewed
bootstrap/baseline strategy based on the catalog output above. It must be
tested from an empty database and reconciled with production migration history;
it must not be introduced as a late migration that blindly recreates or alters
the live table.

## Existing local database compatibility

The older local development database used a reduced `push_subscriptions`
table. Normalize that local table with the explicitly local, non-migration
bootstrap:

```bash
npx --yes supabase db query \
  --local \
  --file supabase/local/bootstrap_push_subscriptions.sql
```

The bootstrap preserves endpoint and key material, backfills the missing local
relationships, and applies the verified column, constraint, grant, and RLS
contract. Never run this bootstrap with `--linked` or a production database
URL.

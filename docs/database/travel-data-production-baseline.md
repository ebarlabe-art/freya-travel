# Travel data production baseline

This document records the production contracts confirmed by a read-only
inspection for Sprint 3B.0B. It is the canonical repository reference for the
current state of the objects listed below.

This file is documentation, not executable SQL. These objects predate the
repository's current migration history. Do not add a retrospective migration
that blindly recreates or replaces them, and do not mark an unapplied migration
as applied in production.

## Artifact status

- **Confirmed production baseline:** this document.
- **Applied migrations:** files under `supabase/migrations/`; none of the table
  or Storage contracts below is created there.
- **Historical/bootstrap SQL:** `supabase-expenses-v2.sql`. It is retained for
  history but is not the current production contract and must not be applied to
  production.
- **Future generic schema:** intentionally not specified here. Constraints and
  policies that are London-specific remain part of the current baseline until
  a separately reviewed migration changes them.

## `public.travel_documents`

### Columns

| Column | Production definition |
| --- | --- |
| `id` | `uuid not null default gen_random_uuid()` |
| `trip_id` | `uuid not null` |
| `title` | `text not null` |
| `category` | `text not null default 'Altres'` |
| `file_name` | `text not null` |
| `file_path` | `text not null` |
| `mime_type` | `text null` |
| `created_by` | `uuid not null` |
| `created_at` | `timestamptz not null default now()` |

### Constraints

- Primary key: `id`.
- Unique: `file_path`.
- `trip_id` references `public.trips(id)` with `on delete cascade`.
- `created_by` references `auth.users(id)`.

### RLS baseline

Row Level Security is enabled. The observed policies target `authenticated`:

- `SELECT`: `public.is_trip_member(trip_id)`.
- `INSERT`: `public.is_trip_member(trip_id) and created_by = auth.uid()`.
- `UPDATE`: `public.is_trip_member(trip_id)`.
- `DELETE`: `public.is_trip_member(trip_id)`.

Policy names are not part of this application contract.

## `public.travel_parking`

### Columns

| Column | Production definition |
| --- | --- |
| `trip_id` | `uuid not null` |
| `parking_name` | `text null` |
| `reservation_code` | `text null` |
| `entry_at` | `timestamptz null` |
| `exit_at` | `timestamptz null` |
| `address` | `text null` |
| `floor` | `text null` |
| `zone` | `text null` |
| `spot` | `text null` |
| `notes` | `text null` |
| `latitude` | `double precision null` |
| `longitude` | `double precision null` |
| `photo_path` | `text null` |
| `updated_by` | `uuid null` |
| `updated_at` | `timestamptz not null default now()` |

### Constraints

- Primary key: `trip_id`. The current model intentionally permits one parking
  record per trip.
- `trip_id` references `public.trips(id)` with `on delete cascade`.
- `updated_by` references `auth.users(id)` with `on delete set null`.

### RLS baseline

Row Level Security is enabled. The observed policies target `authenticated`:

- `SELECT`: `public.is_trip_member(trip_id)`.
- `INSERT`: `public.is_trip_member(trip_id) and updated_by = auth.uid()`.
- `UPDATE`: `public.is_trip_member(trip_id)`.
- `DELETE`: `public.is_trip_member(trip_id)`.

Policy names are not part of this application contract.

## `public.travel_expenses`

Production uses **`description`**, not `concept`.

### Columns

| Column | Production definition |
| --- | --- |
| `id` | `uuid not null default gen_random_uuid()` |
| `trip_id` | `uuid not null` |
| `description` | `text not null` |
| `amount` | `numeric(12,2) not null` |
| `currency` | `text not null default 'GBP'` |
| `paid_by` | `text not null default 'Compte comú'` |
| `category` | `text not null default 'Altres'` |
| `expense_date` | `date null` |
| `place` | `text null` |
| `created_by` | `uuid not null` |
| `created_at` | `timestamptz not null default now()` |
| `receipt_path` | `text null` |

### Constraints

- Primary key: `id`.
- `trip_id` references `public.trips(id)` with `on delete cascade`.
- `created_by` references `auth.users(id)`.
- `amount > 0`.
- Legacy London constraint: `currency in ('GBP', 'EUR')`.
- Legacy London constraint:
  `paid_by in ('Eva', 'Xesc', 'Compte comú')`.

### RLS baseline

Row Level Security is enabled. The observed policies have role `public`, unlike
the newer document and parking policies:

- `SELECT`: user is a member of `trip_id`.
- `INSERT`: user is a member of `trip_id` and `created_by = auth.uid()`.
- `DELETE`: user is a member of `trip_id`.
- No `UPDATE` policy was observed.

The role difference and absent UPDATE policy are recorded facts, not omissions
to normalize in this documentation sprint.

## Storage bucket `trip-documents`

The current canonical policies target `authenticated` and authorize objects by
interpreting the first path segment as the trip UUID:

```sql
bucket_id = 'trip-documents'
and public.is_trip_member((storage.foldername(name))[1]::uuid)
```

- `SELECT`: expression above in `USING`.
- `INSERT`: expression above in `WITH CHECK`.
- `UPDATE`: expression above in both `USING` and `WITH CHECK`.
- `DELETE`: expression above in `USING`.

Production also contains older duplicate policies for this bucket. They use an
explicit `exists` query against `public.trip_members` and have role `public`.
They remain in production; this sprint does not remove or normalize them.

## Storage bucket `expense-receipts`

The observed policies authorize objects by interpreting the first path segment
as `trip_id` and checking membership through `public.trip_members`.

- `SELECT`, `INSERT`, and `DELETE` policies exist.
- The observed policies target role `public`.
- No UPDATE policy was reported in the production inspection.

This sprint does not change or normalize these policies.

## Repository discrepancies recorded by this baseline

The historical `supabase-expenses-v2.sql` differs from production in material
ways:

- it declares `concept`; production uses `description`;
- it allows `amount >= 0`; production requires `amount > 0`;
- it makes `expense_date` non-null with a default; production permits null;
- it does not record the production `paid_by` check constraint;
- it creates an UPDATE policy; no production UPDATE policy was observed;
- its policies target `authenticated`; the observed production expense
  policies target `public`.

No migration under `supabase/migrations/` creates `travel_documents`,
`travel_parking`, `travel_expenses`, `trip-documents`, or `expense-receipts`.
The frontend contract already uses `travel_expenses.description`, matching
production.

## Technical debt for future sprints

### Expenses universalization

- Generalize the current GBP/EUR restriction only through an explicit,
  separately reviewed migration.
- Replace or generalize the Eva/Xesc/shared-account payer constraint.
- Decide and test the intended UPDATE authorization.
- Review table privileges and normalize RLS/Storage policy roles deliberately;
  do not silently change `public` to `authenticated`.
- Reconcile the historical bootstrap with a safe fresh-environment strategy.

Expenses must remain London-only until this work is complete.

### Documents and photos

- Review and deliberately consolidate duplicate old/new `trip-documents`
  Storage policies.
- Replace textual/literal categories with a stable semantic model before other
  modules depend on them.
- Design compensation or cleanup for non-atomic Storage plus database writes.
- Add the separate frontend Realtime refresh required for photos.

### Parking

- The current primary key intentionally limits a trip to one parking record.
- Decide in a future generic-trip sprint whether multiple parking records are
  required before changing that key.
- Parking Realtime is not currently implemented.

## Safe next step

The next sprint should be **Sprint 3B.1 — Generic trip foundation and universal
checklist**. It should add idempotent, destination-neutral checklist defaults,
correct photo Realtime refresh, and strengthen trip-switch async guards. It
must preserve the `london-2026` experience and should not expose Expenses to
generic trips until the Expenses-specific contract migration has been designed
and tested.

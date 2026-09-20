# Shared trip progress P0

## Contract

Only generic trips expose these controls. Commercial reservation/flight status
is never changed by progress. Nullable timestamps on activities/flights and
independent accommodation check-in/check-out start NULL, without backfill.
Manual itinerary items retain `planned <-> completed`; optional/fixed flags do
not change. A cancelled item must first be reactivated before marking it done.

`set_trip_event_completed(trip, source, id, event, completed, expected_updated_at)`
is SECURITY INVOKER with empty search path. Existing membership RLS is preserved.
The only accepted source/event pairs are activity/start, flight/departure,
accommodation/check_in, accommodation/check_out and manual/manual. A row lock
serializes participants. An already-satisfied explicit command is idempotent;
an opposing stale command fails with SQLSTATE 40001. The result contains the
authoritative row, progress, and `updated_at`. Server time owns new timestamps.
Direct timestamp writes are also normalized by the integrity trigger.

The shared projection provides `reservationStatus`, `isCancelled`, `isCompleted`
and `completedAt`. Home and Itinerary do not infer completion from elapsed time.
Manual items have **no completion timestamp**: completedAt remains NULL. In the
Home summary they are grouped by planning day, with an explicit explanation;
other completed items remain accessible with Undo. This does not invent an audit
timestamp from updated_at (which can also mean a notes/document edit).

The frontend keeps exact timestamp strings for CAS, invalidates pre-change source
loads, and reconciles using existing Realtime subscriptions. It never replaces
a changed local source version with a late RPC row. Pending controls and callbacks
are scoped to user, trip and load generation and cleared on context reset.

## Reminders

The new migration replaces only the universal `sync_trip_reminders()` function,
adding completion predicates to eligibility and disabled-reminder reconciliation.
The existing `sync_notification_deliveries()` already invokes it and retires
pending/retry deliveries with `reminder-disabled`. Undo re-arms eligible future
deliveries but never repeats a sent delivery. This occurs on the next normal
sync, not in a privileged client request. An already-dispatched Push cannot be
recalled. London legacy reminders, Cron, Edge Functions and Push architecture
are unchanged. The frontend does not read trip_reminders.

## Local validation

```sh
npm run entries:sync
npm test
npm run test:db
git diff --check
```

The database runner is fixed to the local `supabase_db_freya-travel` Docker
container. It creates a separate `freya_progress_test_<pid>` database, replays
the actual migrations, runs every `*_rollback.sql` suite plus independent
concurrent PostgreSQL sessions, then drops only its disposable database.
It does not migrate the normal local database or connect to a Supabase project.

Local-only baseline fixtures model Auth and the documented pre-migration
travel_documents/push_subscriptions contracts; they are not production migrations.
The data-specific London history migration receives an isolated fixture.
Cron scheduling is deliberately skipped; no jobs or Edge Functions are invoked.
Before/after snapshots verify that this new migration preserves existing data
and leaves all four new timestamp columns NULL. These tests do not substitute
for real GoTrue/PostgREST/Realtime and physical iPhone end-to-end validation.

## Production rollout — not executed

1. Review the diff and rerun both suites. Confirm backup/PITR availability and
   the intended Supabase project. Exercise two real members in staging first.
2. With separate approval for production, inspect history using the validated
   CLI. Do not repair migration history or use `--include-all` to bypass drift.

   ```sh
   npx supabase@2.117.0 migration list --linked
   npx supabase@2.117.0 db push --linked --dry-run --skip-vault
   ```

   The **only** pending migration must be
   `20260918174037_shared_trip_progress.sql`. Stop if anything else is pending.
   The CLI help was checked locally; these linked commands were not run.
3. Apply backend before publishing HTML, in a low-traffic window:

   ```sh
   npx supabase@2.117.0 db push --linked --skip-vault
   npx supabase@2.117.0 migration list --linked
   ```

   Four nullable columns require short DDL locks, not a data backfill. Check for
   lock contention and migration errors. Verify columns, RPC signature, grants,
   membership RLS and the universal reminder function before releasing frontend.
4. Publish the reviewed frontend through the normal approved Git/Pages workflow
   only after migration success. Generating 404.html is mandatory. Deploying
   HTML first would break the explicit accommodation SELECT of new columns and
   the progress RPC, so do not reverse this order.
5. On iPhone and a second participant: mark/undo each source, independent
   check-in/out, optional/cancelled/past cases, Home NOW/NEXT + done summary,
   Itinerary badges, stale form and simultaneous opposing actions. Switch user
   and trip while a request is pending. Confirm cold start, London, linked
   documents and drafts retain current behavior. Verify reminder reconciliation
   in an authorized test trip without generating unintended real notifications.
6. Monitor errors and sync results. If frontend rollback is needed, retain the
   additive columns and saved progress. Do not drop fields, reset statuses or
   rerun historical migrations; any backend correction needs a new reviewed
   migration. Older frontend does not understand the new progress markers.

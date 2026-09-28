# TB-04.4 — explicit operational handoff

One immutable Proposal can create one new operational trip per Brief. This does
not confirm a booking. No provider, model, Storage or notification call is made
inside the handoff. The RPC is a single PostgreSQL transaction.

## Contract

`formalize_trip_proposal_v1(p_brief_id, p_expected_brief_revision, p_proposal_id,
p_expected_generation_id, p_expected_snapshot_hash, p_operation_id, p_details)`
uses `auth.uid()` exclusively. `p_details` has exactly:

- `name` (1–100 chars), explicit IANA `time_zone`;
- `start_date`, `end_date` (both null or a valid ordered date pair);
- `acknowledge_unresolved` (required true when a hard evaluation is unresolved);
- `components`: exact map of proposal component IDs to `{target,time_zone}`.

Allowed target mapping: accommodation → accommodation; experience → activity;
transport → human-selected flight or transport. Accommodation timezone must be
explicit IANA. Other component timezones are null because no schedule is created.
Unknown names use neutral placeholders; full original description is kept as
notes. Reservation fields, prices and all operational timestamps stay null.
All new pieces start `planning`. Travelers do not create memberships.

`get_trip_handoff_v1(p_brief_id)` returns null or owner-only identifiers:
`handoff_id`, `trip_id`, resulting `brief_revision`, `component_links`,
`already_formalized`, `replayed`. It rejects incomplete handoffs.

## Persistence and concurrency

`trip_proposal_handoffs` uniquely identifies Brief/Proposal/trip, preserving the
original revision/hash and canonical request. `trip_proposal_component_links`
uses real typed, same-trip foreign keys and exactly one target per component.
`trip_handoff_operations` retains owner-scoped immutable request receipts.

Operation advisory lock precedes Brief row lock. Exact receipt replay precedes
CAS. Identical requests with different operation IDs converge; competing proposals
or different payloads conflict. Deferred constraints require complete mappings and
consistent Brief/owner/trip/snapshot. All failures roll back every insert.

The Brief revision increases once; later patches fail, while old patch receipts
still replay. Handoff/mappings cannot be reassigned or deleted. Linked pieces
cannot be physically deleted; cancellation remains available. No undo is supplied.
RLS is owner-only; trip members do not inherit private Builder access.

## Reminders and compatibility

The latest Shared Progress `sync_trip_reminders` implementation is retained with
one extra predicate on flights/accommodations/activities in both upsert and
ineligibility paths: unmapped source OR existing confirmation status = confirmed.
Service-role synchronization has SELECT access to mappings, not DML. Legacy
sources and London itinerary notifications are unchanged. Confirmation is only
simulated in tests; TB-05 is not implemented.

## Client

Review is explicit and requires human transport classification and timezone.
Pending immutable requests use owner-scoped local storage and replay the same ID;
uncertain results are reconciled before another mutation. Completed Briefs resume
the existing trip instead of failing the old `trip_id IS NULL` client guard.
No proposal or operational data cache is introduced.

## Release ordering

Apply the new DB migration before exposing the new frontend action. No Edge or
Candidate Generator change is required. Remote application is a separate release
step; local tests only create/drop disposable databases.

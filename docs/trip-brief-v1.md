# TB-01 · Trip Brief persistence (schema v1)

Local implementation only. No UI integration, AI, proposals, search, offers,
booking, budget engine, trip creation, handoff or Realtime. The current app does
not import `domain/trip-brief.mjs`. London and generic trips use unchanged code.

## Focused audit / Red Team decisions

- A brief precedes a trip. Trip membership is not authorization for a brief.
- One validated JSONB aggregate avoids a table per preference. A second table
  holds mutation receipts: it is needed for retries after later edits, not a
  second brief or general event store.
- JSON is not free-form. Draft-07 JSON Schema closes every object, bounds sizes,
  restricts keys/types, and dispatches known decision fields to typed values.
  `custom.<key>` permits bounded text only; it cannot smuggle arbitrary JSON.
- `pg_jsonschema` is the sole SQL extension dependency. Available version 0.3.3
  was verified locally; the migration enables it in `extensions`. No npm package
  or provider is added. Deployment must verify extension availability/schema.
- No saved status is needed before handoff. `trip_id` is nullable with a CHECK
  requiring NULL in v1: even the mutation RPC cannot formalize a trip.
- No Realtime: reads on resume plus explicit CAS conflicts cover a private brief
  used on multiple devices. A later UI must reload on resume, never auto-rebase.
- No silent merge, inferred defaults, exact dates, traveler names or passports.

## Row and document

`trip_briefs`: stable client-generated UUID `id`, server-derived `owner_id`,
`schema_version=1`, integer `revision` (starts at 1), nullable `trip_id`,
`document`, server timestamps. Revision is bounded to JS safe integers.

An empty document is valid:

```json
{"decisions":{},"scopes":{},"travelers":{}}
```

Missing decision means not provided; an explicit `knowledge: "unknown"` records
that the question was considered and remains unknown. Neither means flexible
or indifferent. JSON null is invalid anywhere in the document. SQL NULL is
reserved for the future `trip_id` only. Empty maps mean no entries, never delete
all entries in a patch.

A decision map key is an immutable client ID. Its `field` and `scope` cannot be
changed in place. There can be only one decision per `(field,scope)`.

```json
{
  "field":"flight.departure_window",
  "scope":"outbound",
  "origin":"explicit_user",
  "knowledge":"known",
  "strength":"hard",
  "value":{"weekdays":[5],"min":"18:00"}
}
```

This means Friday departure no earlier than 18:00 in the leg's local clock, not
an invented departure instant. Weekdays are ISO 1=Monday … 7=Sunday. An IANA zone
can be recorded as text but is not used to construct instants or query providers
in TB-01. A future search must resolve/validate the departure location's zone.
Time windows cannot wrap midnight: express a different requirement explicitly.

Decision discriminators:

| Axis | Contract |
| --- | --- |
| Knowledge | `unknown` has no value/strength; `known` requires a typed value; `indifferent` forbids value but has a strength. |
| Strength | `hard`, `preference`, `flexible`. Flexible means permission to vary, not ignorance or indifference. |
| Origin | `explicit_user`, `interpreted_from_user`, `system_default`. Only explicit user decisions may be hard. |

Interpreted/default values remain unconfirmed. The domain resolver returns
`requiresConfirmation=true` for them and never lets one shadow an explicit
ancestor. Promoting an interpretation to `explicit_user` is an explicit owner
edit. No AI service or automatic mutation authority is implemented.

### Typed fields

The complete machine-readable catalog is `valueSchemas` in
`domain/trip-brief.mjs`, frozen into the migration and checked by a parity test.

- `dates`: exact start/end OR earliest/latest window; strict real dates and order.
  `dates.flexibility_days` is separately recorded, never applied automatically.
- `origin`: places; `destination`: open, partial or known plus places as applicable.
- `duration`: days/nights with min/max; `pace`: relaxed/balanced/active.
- `budget`: price_discovery, target, maximum or target_stretch. Amount/currency,
  optional inclusion tags; stretch is an additional allowance, not a new total.
  Unknown budget uses unknown knowledge. No totals or FX conversions are computed.
- `interests`: open vocabulary of bounded strings, not a seasonal enum.
- Flight departure/arrival windows, max_stops (0=direct), max duration in minutes,
  alternative airports, low-cost acceptance. Indifferent uses the discriminator.
- `baggage`: shared items and/or items by traveler ID. Items contain kind, quantity,
  optional weight and note. References must exist in the traveler map.
- Hotel comfort/location, room configuration, breakfast, cancellation, amenities
  (open vocabulary), stars and rating with source/scale.
- Experience styles: independent, audio guide, guided visit, organized/independent
  excursion, combination. Indifference stays explicit in the decision contract.
- `notes` and bounded `custom.*` text preserve exceptions without NLP or execution.

`travelers` contains stable local IDs with adult/child and optional child age.
Adult ages and additional personal fields are rejected. An empty map means group
composition is not known. These IDs are not auth users or `trip_members`.

### Scopes and overrides

`global` is implicit and cannot be defined or deleted. Named scope objects hold
`kind`, `parent`, `label`; kinds are destination, stay, component, leg. These are
brief-local addresses for preferences, NOT operational destinations/components.

Parents form an acyclic tree, depth <=4. Destination is rooted at global; stay
may be under destination; component under destination/stay; leg under component.
Each kind may also be directly under global for partially known trips.

Resolve a field along its scope ancestors. The nearest explicit decision wins;
otherwise the nearest unconfirmed decision is returned with its warning flag.
An explicit unknown override remains unknown. Adding a second decision in the
same semantic cell is invalid. A narrower decision conflicting with an inherited
hard is rejected, including an unknown or weaker override. To change such a
constraint, explicitly revise the hard first; do not hide it with an override.

No cross-field feasibility solver is implemented: dates vs duration, airport
geography, hotel availability etc. are not inferred or optimized. Persisted
preferences are not a claim that an itinerary satisfying them exists.

## Mutation boundary and retries

The only write RPC is `apply_trip_brief_patch_v1`:

- `p_brief_id`: create once, reuse on every retry.
- `p_operation_id`: create once per logical edit; persist with the command if a
  caller wants to survive a restart after a lost reply.
- `p_expected_revision`: 0=create, otherwise exact loaded revision.
- `p_set`: optional decisions/scopes/travelers maps. Each supplied ID is replaced
  atomically; absent IDs/collections stay unchanged. A decision is the minimum
  edit unit; pass the complete edited decision, never a fragment of its value.
- `p_remove`: optional arrays of IDs per collection. Explicit removal only;
  duplicate IDs, missing IDs, or IDs both set and removed are rejected.
- `p_confirm_hard`: IDs of existing hard decisions intentionally being changed or
  removed. Changing a scope used by a hard (or one of its ancestors) also requires
  confirmation; adding unrelated scopes does not. Confirmation is bound to the exact expected revision and operation request.

Direct table writes are denied. The SECURITY DEFINER RPC has an empty search_path,
checks auth.uid and ownership explicitly, locks the operation identity and the
brief row, validates the complete resulting document, then atomically records
both the update and receipt. It never trusts a caller-supplied owner.

`40001` = revision conflict: preserve the user's unsaved input, reload, let them
resolve. `22023` = invalid command/document or reused operation ID with different
payload. `42501` = unavailable/unauthorized. No automatic retry with a new revision.

Successful output:

```json
{"brief":{"id":"…","revision":6,"document":{}},"applied_revision":6,"replayed":false}
```

A repeated identical command returns `replayed=true`, its original
`applied_revision`, and the CURRENT brief. Thus retrying a revision-1 create after
a revision-3 edit cannot return/apply a stale snapshot. Different commands using
the same operation ID are rejected. Failed operations leave no receipt or partial
brief. Receipt retention is unbounded in v1 to preserve this guarantee; a future
quota/retention policy must explicitly preserve replay identities or reject old
commands, never silently forget them.

Every new successful command advances revision, even a no-op. Schema version and
revision have different purposes. Schema v1 is frozen; future schemas need an
explicit migration/upgrade, not a change that reinterprets stored decisions.

## Security and consent limits

Owner-only SELECT RLS on briefs. Receipts have RLS and no client policy/grant.
No anonymous or service-role grant, no direct client insert/update/delete/truncate.
Only authenticated users may execute the mutation RPC. Internal schema/validation
functions are not client-callable. There are no new triggers or publications.

The RPC represents an authenticated owner command. Provenance and confirmation
are structured assertions, not cryptographic proof of a physical user gesture.
A future AI must not be given this owner-command capability or the owner's JWT;
it needs a separate restricted suggestion path. Today no such AI path exists.
Deletion, sharing, listing UI, durable local outbox and handoff are out of scope.
Owner deletion cascades briefs and receipts via auth FK.

## Verification

- `npm test`: existing entry/photo/Home/progress regressions plus domain tests.
- `npm run test:db`: disposable database ONLY in `supabase_db_freya-travel`;
  migrations, all rollback SQL suites and independent-session concurrency tests.
  Cron scheduling is deliberately skipped by the existing runner.
- SQL verifies exact partial roundtrip, budget-only edit, unknown/flexible/
  indifferent, scoped overrides/hard protection, provenance, invalid input,
  every budget mode, retries after newer writes, isolation, least privilege and
  unchanged operational rows. Concurrent sessions cover duplicate create/update
  and A revision 5 rejected after B commits revision 6.

No remote migration, commit, push or deploy is part of TB-01.

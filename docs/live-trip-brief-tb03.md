# TB-03 — Live Trip Brief UX (local review)

## Contract and scope
Uses published TB-01.1 (6522bf1; schema_version=1) unchanged. No migration,
RPC, RLS, receipts or remote data changes. All three doors create the same kind
of Brief; only microcopy/initial block differs. No operational trip, AI/NLP,
Search/provider, proposal, itinerary, pricing or TB-04 work.

The UI is mounted in the existing builderView. Home navigation, manual creation,
join, trip views, Smart Home and photo navigation retain their existing handlers.
The live module contains projection, partial command builders and a scoped editor;
travel-builder continues to own tab storage and transport. index is the source
for generated 404. The service-worker version and precache gain the new module;
fetch strategy, navigation fallbacks, London/legacy routes and notifications stay
unchanged. Cache replacement is required because module requests are cache-first.

## Progressive UX and authoritative projection
One block at a time, selected by a labelled control or by touching the card.
Inspire prioritizes interests, destination prioritizes destination, idea prioritizes
notes. Resume selects a still-unanswered block, including when reopening the same
Brief; a successful edit keeps its current block. Unknown is an answered state,
not an instruction to ask again. All saved fields remain reachable for editing.

The card reads the authoritative returned/read Brief; it has no second stored
summary. Explicit known decisions, explicit indifference, and known travelers are
shown; unknown and unconfirmed interpretation do not become facts. Six entries
are initially visible; the rest expand. Each label is capped visually at two
lines (full text is available when editing). Interests have individual collapsed
strength/removal controls; flight and hotel subgroups also collapse. Scoped
preferences are labelled and preserved, with a clear notice that this V1 editor
changes only global decisions. No scope conversion or global override is guessed.

## Representation conventions
- Dates: exact start/end OR a earliest/latest window. Unknown has no dates and is
  not flexible. Existing dates.flexibility_days remains intact; this UI uses the
  window rather than deriving dates from a ± margin.
- Destination/origin: explicit place text, one per line; no airport resolution.
  Existing partial destination semantics are preserved. No inference of
  multidestination from number of places.
- Travelers: existing IDs retained, adults/children independent of trip_members.
  Each infant can have a real age or an explicitly pending age. 1–30 people total;
  no default people are persisted. Removing anyone referenced by baggage is
  blocked until their baggage is resolved.
- Budget: discovery has no invented price; target/maximum/target_stretch use the
  existing amount/currency fields. `stretch` is ADDITIONAL allowance, never a
  total ceiling. Existing includes preserved; strength applies to the aggregate.
- Interests: explicit interest catalog; selection defaults to preference; hard,
  preference and flexible edited per interest. Free IDs use createFreeInterest's
  random compact UUID, never labels. Raw labels retained, NFKC/whitespace/case
  equality detects duplicates, no synonyms or silent merge; max 30 per scope.
- Multidestination: known true/false; indifferent without value; unknown without
  value or strength. Uses destination.multidestination exclusively.
- Experience styles: existing aggregate list/strength, no per-style extensions.
- Flight presets: local departure/arrival wall-time ranges displayed explicitly:
  06:00–11:59, 12:00–14:59, 15:00–19:59, 20:00–23:59. Existing date, weekdays and
  time_zone are retained when selecting a range; no timezone is invented.
  Direct=0/max one=1 on one field; replacing hard requires confirmation.
- Baggage: quantity per specified traveler plus a shared checked quantity.
  Sharing requires at least two people; per-person checked plus shared checked
  is rejected for explicit resolution. Aggregate strength retained. A collapsed per-traveler editor allows different quantities without flattening
  existing weights/notes/other kinds. Repeated detailed pieces of the same kind
  are preserved and require a dedicated future editor, never silently merged.
- Hotel: independent comfort/location/room/breakfast/cancellation decisions.
  Existing room counts/occupancy preserved when changing type. Breakfast yes
  with preference means preferred; hard makes it required. Free cancellation
  likewise uses the existing force selector. Spa/pool/parking/gym each have their
  own amenity decision. Indifferent comfort and hard spa are compatible.
- Legacy interests/hotel.amenities: editable as the existing aggregate list, same
  IDs/strength; no automatic conversion. New family blocked alongside legacy in
  the inheritance chain, authoritative SQL remains final validation.
- Other hotel wishes/conversational text: notes, maximum 2,000, explicit save.
  No sentence is interpreted as structured facts.

## Persistence and errors
Tags immediately prepare an immutable TB-01 partial patch against the current
revision. Text/numbers save by an explicit block action, never on each keystroke.
All existing unrelated decisions/scopes/travelers survive. UI asks before changing
or removing an existing hard and passes exactly those confirmations to the RPC.
Cancelling a chip/strength confirmation restores authoritative controls.

BuilderSession stores the immutable command in owner-scoped sessionStorage before
sending. Busy/pending disables writes and local navigation; retry and refresh reuse
the same operation ID. Uncertain requests cannot be discarded and replaced.
Owner/epoch guards ignore responses after account changes. Storage errors fail
closed. This is not an offline outbox: connectivity is required for confirmed save.

CAS displays “Aquest viatge s’ha actualitzat en un altre lloc.” Review displays the
attempted command read-only (or the typed notes); reload explicitly discards local
edits and loads the authoritative row. No auto-merge, rebase or overwrite. Other
server rejection remains visible and requires review/reload. Notes and structured
form drafts cannot overwrite each other; unsaved inputs block competing writes.
Back uses existing home-scoped history and protects unsaved text/forms. No router.

## Verification and limits
`npm test`, `npm run test:db`, `npm run build`, `npm run entries:check`,
`git diff --check`. Browser regression fixture uses actual HTML/CSS/handlers/domain
modules and a simulated owner-scoped TB-01 transport; no live user writes:

```
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/check-live-brief-browser.mjs
```

It runs Chrome at 390×844, including mixed strengths, single removal, duplicate
custom, exact/window dates, multiple children, budget, knowledge states, hard
stops, shared baggage, hotel+spa, 2,000 notes, refresh, CAS review, lost-response
retry, Back/resume, new-door double tap, all three entry priorities and 30 interests.
Screenshots are written to the OS temporary directory. SQL rollback, before/after
migration and independent-session concurrency run in the existing disposable DB.

Physical mobile keyboard/safe-area behaviour, installed-device service-worker
upgrade, actual authenticated two-device E2E and full scope editing
remain outside this local fixture. All such existing metadata is preserved rather
than silently simplified. Tab destruction is not covered by sessionStorage; only
confirmed saves are guaranteed remotely. Build output is generated verification
output, not part of this static Pages source change.

Final local result: 200/200 JS; 14 SQL rollback suites; TB-01.1 before/after
checks; 9 independent-session race scenarios; 26/26 browser checks; build,
entry parity and diff whitespace checks PASS. No commit, push or deploy.

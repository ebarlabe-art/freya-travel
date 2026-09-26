# TB-02 — Home and progressive Builder entry (local implementation)

## Audit and scope
The former authenticated Home combined the get_my_trips list, inline manual
creation and a competing “Buscar amb Freya” form requiring destination/dates.
Cold start already opens tripsHomeView without selecting a trip. Operational
opening remains selectTrip → existing dashboard/Smart Home and its loaders.
create_trip_v2 continues creating an operational trip with the original form
and validation; the invite/join flow stays on Home with its own status message.

The old Search form and its UI handler are removed. The travel-search Edge
Function, providers and backend infrastructure are unchanged. London itinerary,
operational dashboards/modules, NAV-01, trip data contracts and auth/deep-link
handling are not rewritten.

## UX
Home has two actual SPA views: Els meus viatges and Dissenya un viatge.
The trip list reuses existing cards/selection, grouped En curs, Propers, Passats
using the existing device-calendar convention; unknown dates remain future/setup.
Active trips come first. No new trip model or internal card redesign.

Dissenya first lists all available owner-only open schema-v1 Briefs, paginating
reads and ordering by updated_at descending. Known explicit destination/date/
origin facts identify each draft; unconfirmed interpretations/unknowns are not
presented as facts. Empty drafts say “Viatge en preparació”; their real update
timestamp helps distinguish them. No fabricated name. No delete/archive/copy UI.

“Comença un viatge nou” has three independent touch targets:
- Inspira’m: no destination required.
- Ja sé on vull anar: natural destination prompt, unless already known on resume.
- Tinc una idea: free-form idea prompt.

Each door intentionally creates a NEW Brief, as approved by the Product Owner.
Selecting a continuation reads that exact Brief and never creates another.
Manual creation is a secondary link opening manualTripView, with the original
form rather than a second implementation.

Builder is a separate builderView, with mode-specific copy, known facts and one
large notes field. It explicitly says that there is no interpretation/proposal
generation. Entry mode is UI/navigation context, not an invented schema field.
A resumed draft does not require users to re-enter known information.

## TB-01 integration
domain/travel-builder.mjs imports the existing TB-01 helpers. It creates an empty
schema-v1 brief through apply_trip_brief_patch_v1 only; ownership is derived by
the server. UI additionally checks owner/schema/trip_id on every loaded response.
No operational trip/member/reservation/checklist/reminder RPC is invoked.

Conversational input uses the existing global notes decision (max 2000 chars),
knowledge=known, origin=explicit_user, and preference strength for a new note.
An existing notes ID/strength is retained. Protected hard notes require explicit
confirmation. Clearing existing notes uses the supported remove patch. All
other decisions/scopes/travelers remain untouched.

Before sending, an immutable prepared command is saved to owner-scoped
sessionStorage. Duplicate taps are locked. Lost responses/timeouts offer retry
of the SAME brief/operation IDs. Refresh restores pending verification without
automatically writing. Until an uncertain command is reconciled, another new
start is disabled; this is an operation-safety guard, not a one-Brief restriction.

CAS failures keep the typed text and disable saving until an explicit reload.
No auto-rebase, merge or false success. Missing/deleted briefs are reported and
never replaced by newly-created drafts. The schema has no Realtime publication;
resume/reload reads authoritative state, with revision CAS for concurrent edits.

## Navigation, auth and PWA
The existing setAppView accepts three additional top-level views without a trip.
No global router is added. A scoped History API marker handles these four Home
views only; it ignores photos and operational views to preserve NAV-01.
Dirty notes require confirmation before local navigation. Busy operations block
local Back until response/timeout. A restored Builder entry uses a safe parent
fallback rather than navigating out of the app. Forward to an expired Builder
history entry returns to Design and never creates a brief.

The owner-scoped tab route restores a confirmed Brief on browser refresh.
Session changes clear visible drafts and invalidate late UI responses. Pending
commands remain scoped to their original owner for safe retry after login in
the same tab. Existing explicit deep links take precedence over Builder restore.
No general logout/close-tab dirty-state system or cross-tab outbox is introduced.

The service worker cache version is bumped and the two domain modules are
precached; existing navigation fallbacks, legacy bridge, itinerary and push/
notification handlers are unchanged. Data still needs connectivity; no fake
offline persistence success is shown.

## Verification and Red Team
- 157/157 JavaScript tests PASS (18 new TB-02 tests).
- 13 SQL rollback suites and 4 concurrency checks PASS in the disposable local
  database; Cron scheduling intentionally skipped by the existing runner.
- Build, entry byte parity, syntax/unique IDs and final diff whitespace checks.
- Browser fixture at 390px using actual UI/domain code with simulated backend:
  Home, all draft labels, new inspire entry without destination, notes save,
  native Back, explicit resume with known destination and dedicated manual view.
- Double tap, pending refresh/retry, storage failure, slow request/logout, CAS,
  deletion, owner isolation, unknown/partial data, list pagination and module
  cache contracts covered. Manual create still calls create_trip_v2 and opens
  the returned trip.
- Review caught and fixed potential Home history interception of photo return;
  a regression test now ignores photos, documents, itinerary and trip dashboard.

Limits for real E2E: physical iPhone/PWA keyboard and cache upgrade, actual login/
logout and real two-device CAS. sessionStorage survives refresh but not arbitrary
tab destruction; unsaved textarea edits are not advertised as persisted. A
pending action cannot be discarded here before reconciliation. No draft
management, mode persistence in the schema, AI, Search, formalization or TB-03.
No migration, commit, push or deploy is part of this package.

# Contextual photos / Upload V2 — local V1

`index.html` is the editable entry; regenerate `404.html` with `npm run entries:sync`.
London keeps its previous uploader and gallery. All new controls/RPCs are generic-only.

## Contract

- A photo remains `travel_documents.category='Foto'`, in the existing `trip-documents` bucket.
- Optional `trip_photo_metadata` is 1:1 by document ID. Existing photos get no rows/backfill.
- Explicit day + activity OR manual planning; no automatic time/GPS inference. Source deletion sets just its FK to NULL, preserving photo/day.
- Upload batch UUID + index 0–19 preserve selection order. Old photos fall back to upload date, which is **not** claimed as capture time.
- Authenticated members can read metadata via RLS. Writes are only through two narrowly scoped SECURITY DEFINER RPCs with empty search_path and explicit auth/member/generic checks. Composite FKs reject cross-trip references. The context RPC serializes on document identity and compares the original `updated_at`; a remote change never rebases an open form silently.
- `finalize_trip_photo` atomically creates the document + metadata, or returns the existing authoritative pair for the same upload identity. A retry never replaces another member's context correction.
- Object path: `<trip>/photos/<user>/<document UUID>.<jpg|png|webp>`. No upsert. A retry uses the same file, UUID and path. Storage success followed by an RPC error is retained for retry; no destructive cleanup on an ambiguous response.
- Metadata INSERT/UPDATE uses the existing document subscription's lifecycle. DELETE of a photo still refreshes through travel_documents events. No REPLICA IDENTITY FULL change is needed.

## UX and deliberate limits

- At most 20 selected files per in-memory batch; sequential network requests, independent errors, individual retry, editable context per photo before confirming, editable metadata afterwards.
- JPEG/PNG/WebP only, 15 MB per file. Browser decode failure is isolated. No conversion/compression, EXIF/GPS extraction, videos, or Live Photo handling.
- Home/Itinerary actions on activities/manual items propose explicit editable context. Flights/accommodation are not offered.
- A request timeout (120 seconds) releases the queue for retry without assuming server failure. The original request may still complete; the stable identity prevents a second photo while that batch is retained.
- The queue/files live in memory, not localStorage/IndexedDB. Navigating inside the same trip keeps it. Trip/user reset discards it and prevents further scheduled work/UI updates from the old scope. A cold restart cannot resume files. No background guarantee.
- Closing an incomplete batch warns that an ambiguous success may already be in the gallery. Retry idempotency is scoped to the retained batch, not to reselection after restart. Visual/content dedup is deliberately absent.
- Storage and SQL cannot share a transaction: a session exit after object upload, failed finalization, or failed delete cleanup can leave an orphan object. No automatic cleanup job is added in this V1. Inspect before any later cleanup; never delete on timeout alone.

## Verification / release gate

- `npm test`: static syntax/IDs/parity, queue/retry/timeout/scope/load ordering/context CAS tests plus the existing navigation/Home/progress suites.
- `npm run test:db`: disposable database in `supabase_db_freya-travel` only; applies migrations locally, asserts pre-existing document JSON unchanged and zero inferred metadata, runs rollback suites, and exercises two independent SQL sessions for idempotent finalization and stale CAS rejection.
- Storage policies are unchanged (existing first-folder trip membership convention). SQL tests do not validate hosted Storage or actual WebSocket delivery.
- Before release: review/apply migration **before** publishing HTML; run physical iPhone/PWA E2E on a non-production test trip: 20 large images, unsupported HEIC, network interruption/retry, two members editing context, source deletion, switching trips/users mid-upload, existing photos and London.
- No migration has been applied remotely by this work. No commit/push/deploy is part of this implementation.

Deferred: durable resumable queue, orphan reconciliation/tombstones across deletion/retry and session restart, image derivatives/memory tuning, capture-time metadata, album/story editing. These require separate scope approval.

## Gallery visibility micro-sprint (frontend only)

Audit: the generic gallery already read canonical metadata, but displayed upload
date ahead of context and did not constrain its context/title text. The completed
queue displayed context but omitted the saved title. The only caption authority
is `travel_documents.title` (also used as the initial filename-based title).
There is no independent caption or manual photo-location field.

The compact summary shared by generic gallery and completed queue now shows:
- Short calendar date from `trip_photo_metadata.local_date`, followed by the
  linked activity/planning title, and its existing `location_name` when distinct.
- The saved document title on an optional second line.
- “Sense context” when metadata is absent/empty; “Context no disponible” when
  its read fails, which must not be mistaken for an empty context.

Both lines have CSS ellipsis and explicit readable colors. Full text remains in
the DOM/title attribute; no persisted text is truncated. Upload dates are no
longer presented as the photo's day. No date/location is inferred.

Title correction uses the existing document UPDATE permission/RLS (confirmed
read-only on remote) with trip/id/category and original-title equality filters.
It has its own save action, separate from the unchanged metadata CAS RPC. A
zero-row update leaves the draft intact with a conflict message. Context saving
requires saving or restoring any modified title first, avoiding draft loss. The table has
no title revision field: this equality guard cannot detect an A→B→A history.
No new RPC, schema field, migration or Storage change is required.

Red team:
- Summaries always read `photoRows` + `photoMetadata`, never `job.metadata`.
- Confirmed save responses refresh visible text before waiting for signed URLs;
  failed writes never optimistically display the draft as saved.
- Existing Realtime reloads refresh queue/gallery and keep open title/context
  drafts and their original baselines. Agenda source reloads refresh summaries
  too, including renamed sources. Removed context is rendered as empty.
- Text-only refresh does not replace images. Full photo reconciliation retains
  the existing signed-URL/load sequence protections and full gallery rendering;
  actual network/image flicker still requires device E2E.
- Legacy photos without metadata remain visible. No backfill.
- Ordering remains newest upload batches first, selection order within each
  batch, legacy fallback by upload timestamp. It is intentionally not a day sort.
- London renderer/uploader, lightbox, deletion and batch/retry semantics remain
  unchanged. All summary styles are scoped to the new generic summary class.

Verification: 125 JavaScript tests pass, including summary variants, removal,
remote title/context refresh, guarded title success/failure, immediate confirmed
context updates, original upload/batch/retry/CAS tests, syntax/unique IDs and
byte-identical entries. Full disposable SQL suite passes (13 rollback suites,
existing concurrency checks; Cron scheduling intentionally skipped by runner).
Chrome layout fixture uses real summary functions/CSS at a 296px gallery width
(320px screen content) for long source/caption, empty caption and legacy cases.
Physical iPhone/PWA and two authenticated members over real Realtime remain E2E.

Deferred only: day sorting/grouping, independent caption field, and versioned or
atomic title/context editing would be separate work. None implemented here.

Build and entry parity pass. The local node_modules needed the matching macOS
Rollup/esbuild optional binaries; package manifests and lockfile are unchanged.

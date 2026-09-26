# HOME-01 — simple Home and trip-local classification

## Authoritative London repair (2026-09-26)
Read-only audit of linked project `otueskpksylzvkhldoft` found exactly one
`london-2026` trip: `9035e47f-f16c-4fa3-83fd-873bd98dc221`, named
“Viatge Freya - Londres 2026”. Both dates were NULL; time_zone was Europe/London.
The static legacy itinerary contains six consecutive dates, August 6–11, 2026.
The deployed update_trip_v1 and owner UPDATE policy explicitly exclude London.
Neither RPC nor permissions were changed. With the Product Owner's explicit
authorization, a guarded administrative data correction updated start_date to
2026-08-06 and end_date to 2026-08-11 only. It required matching UUID, name,
experience key, existing timezone, NULL dates, a unique London identity, and
exactly one affected row, otherwise rollback. Subsequent read verified the result
and unchanged Eivissa dates (2026-09-09 through 2026-09-13, Europe/Madrid).
No schema migration was needed.

## Cause and rule
TB-02 defaulted missing dates to upcoming and used the device's calendar day.
Home now derives YYYY-MM-DD with Intl.DateTimeFormat/formatToParts in each trip's
IANA time_zone. Before start is upcoming; start through end inclusive is active;
after end is past. NULL, invalid or reversed dates, or missing/invalid timezone,
are undated, never assumed upcoming. No trip name, ID or experience exception
participates in classification. London and Eivissa are both past on September 26.
The Home/category clock recomputes from loaded metadata at the next minute
boundary and on visibility/pageshow, without database writes or new reads.

## Entry architecture
Home retains “Els meus viatges” and its approved microcopy. It has five doors:
- Propers: exclusively future trips, existing cards and operational opening.
- Dissenya: the three deliberate new-Brief doors and secondary manual creation.
- En construcció: Continua dissenyant, owner-scoped open Briefs ordered by
  updated_at DESC using existing TB-02 pagination and truthful labels.
- Uneix-te: dedicated view containing the unchanged join_trip_v2 flow.
- Passats: exclusively ended trips, with normal operational functionality.
Active trips appear above the doors only when present. Undated trips appear in a
discreet “Dates pendents” section below. No sixth door and no Home forms.
Existing Builder empty, pending, retry, conflict and owner protections remain.

## Navigation and verification
The existing SPA/history markers now include categories. Category → trip records
its parent and selected ID, supports Back/forward and refresh for the same owner.
Builder return distinguishes new design from resumed drafts; a restored entry
has a safe parent fallback. Explicit deep links retain precedence. Photo history
and operational source-return navigation are not intercepted by the Home handler.
Manual/create and join mutation handlers, Photos and Smart Home code are preserved.

Tests cover temporal boundaries, trip/device timezone differences, DST, undated
and malformed metadata, London/Eivissa without identity rules, five doors,
conditional/empty blocks, Brief lists, Back/forward/refresh/owner isolation,
manual and join contracts, clock scheduling, and existing regressions.
Browser verification uses actual Home/Builder markup and logic at 390px with a
simulated backend. It does not replace authenticated real-device E2E, including
physical iPhone/PWA and real membership/Brief mutations.
No commit, push, deploy, service-worker change, TB-03 or new backend contract.

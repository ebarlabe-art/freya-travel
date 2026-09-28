# TB-04.4.2 local implementation — not released

The new provider is server-only Geoapify. Configure `GEOAPIFY_API_KEY` as an
Edge Function secret, never in frontend files. No real provider call has been
made. No remote migration or deployment has been performed.

## Configuration

`PLACE_TIMEOUT_MS=8000`, `PLACE_CACHE_SECONDS=86400`,
`PLACE_EMPTY_SECONDS=300`, `PLACE_TOKEN_SECONDS=900`,
`PLACE_USER_DAILY=100`, `PLACE_GLOBAL_DAILY=2500`, `PLACE_GLOBAL_RPS=4`.
The database setting `place_private.settings.fresh_days=90` governs new handoffs.
Provider query leases cover the provider deadline plus 16 seconds of RPC margin.
No invisible provider retry. Query tokens are HMAC signed with the server-only
Supabase service credential and expire independently from cached results.

## Persistence and compatibility

`places` separates Freya identity from provider identity. `place_versions` and
`place_bindings` are immutable. Bindings reference real Brief/Proposal rows;
subject keys are checked against their authoritative JSON. Only RPCs can write.
A material Brief place confirmation advances its revision. Generations capture
matching geography in `place_snapshot`; legacy generations retain null.

`formalize_trip_proposal_v2` requires selected factual bindings and a principal
base. It derives timezone server-side, reuses the atomic legacy implementation,
and stores an immutable handoff snapshot. No provider calls occur in SQL.
The v1 public RPC permits reconciliation/replay of existing handoffs only.
Deploy compatible DB/Edge before releasing the new frontend.

Unknown hotel coordinates stay null when only timezone is inherited. Legacy
trips and Weather are not rewritten. An unresolved geographic location never
falls back to the device or LLM. Broad regions require a specific location.

## Validation still required before release

The dedicated place-selector browser passed 6/6 checks at 390px, covering
selection, hidden IANA, refresh reuse, ambiguity, offline input preservation
and layout/no JavaScript errors. The offline transport error now retains its
normalized error code, covered by a unit regression. Existing TB04 mobile
regression uses synthetic preselected factual bindings. These are not
authenticated production E2E and do not verify Geoapify credentials.

Provider attribution is displayed alongside selected/candidate places. Review
applicable Geoapify/data-source terms on activation; no service was contracted.

# TB-04 · Destination Fit and Proposal foundation

Local implementation. No remote migration, commit, push or deploy performed.

## Contracts and boundaries

The authoritative input remains an unchanged schema-v1 Trip Brief. The server captures
its document and revision under lock. Model/provider/model name are generation
configuration, never Proposal semantics. Candidate Generator uses strict Responses
Structured Outputs with server-side `OPENAI_API_KEY` and `TB04_CANDIDATE_MODEL`.
There is no default model, automatic retry, commercial search or tool access.

Candidate validation and development-only safe diagnostics remain in
`domain/trip-proposal.mjs`. No actual received values appear in diagnostics.
The independent persistent Proposal document wraps the validated Candidate, decision
evaluations and factual verification. Candidate-local stable IDs are namespaced by
the immutable database Proposal UUID.

Production Factual Verifier has no sources: every claim remains pending. The engine
accepts evidence only from an injected trusted verifier, never Candidate output.
The document schema reserves all four certainty states; the current engine and DB policy reject `provider_available` because no inventory adapter exists. Confirmed factual decisions require
an explicit verifier verdict bound to the decision/scope and a current confirmed claim.
Expiry makes the displayed factual satisfaction unresolved, without rewriting history.
Tests inject synthetic evidence; no production import or switch enables fixtures.
Pages excludes `supabase` and `scripts`; Vite doesn't bundle test fixtures.

## Evaluation and deduplication

Every source decision is retained in evaluations, including legacy and unbound scopes.
The existing resolver prevents unconfirmed interpretations from satisfying decisions.
Multidestination and fully known total nights can be checked structurally; known
out-of-bounds dates without positive flexibility contradict the design constraint.
Other factual/ambiguous constraints remain unresolved. No semantic interpretation of
free-text labels, synonym matching or automatic weakening is attempted.
A hard violation removes a candidate. Preference/flexible violations remain explicit
in the stored evaluation. An unresolved hard remains explorable with a clear label.

Fingerprint is SHA-256 over the normalized ordered destination/date/night/transport
route. Generated IDs and prose do not affect identity. Alternatives differing only
in experience wording on the same route are conservatively deduplicated in V1.
No ranking, score or winner; the model provides at most three candidates and the engine
never retries to fill rejected slots. Zero returned candidates means insufficient
information, not proof that no suitable destinations exist globally.

## Persistence and concurrency

Migration `20260927102120_proposal_foundation_v1.sql` creates three RLS tables:
`proposal_generations`, `trip_proposals`, `proposal_operations`. Existing rows are not
rewritten. No `trip_id` or operational materialization exists in this subsystem.
Client reads are owner-scoped; all mutations use internal RPCs granted only to the
server service role. Edge validates the user using Auth, ignores client ownership and
never exposes the service key. Service role itself is not a globally restricted role.

Request receipts are checked before Brief CAS. Requests with distinct operation IDs
converge on the same Brief revision + configuration generation. A single 90-second
lease fences execution. Explicit retry recovers failures/expired leases; GET never
starts work. Exactly-once persistence does not imply exactly-once provider billing.
A failed/expired external request may have consumed provider tokens.
Finalization checks the token and Brief revision, validates the complete batch and
writes 0–3 proposals atomically. A changed Brief makes the in-flight generation obsolete.
A repeated identical finalization converges; another payload cannot replace it.
Tables have no direct client writes, receipts are private and persisted proposals
cannot be updated. Original Briefs, their receipts and operational rows stay untouched.

## UX and navigation

Alternatives and detail are nested Builder screens. They use existing SPA/history,
owner-scoped pending-operation storage, explicit generation, refresh restoration and
late-response guards. No personal Proposal result is cached by the service worker.
Only the new presentation module is precached; fetch/navigation strategies are unchanged.
Poll only running work while visible; refetch on focus. No new Realtime publication.
Back restores detail → alternatives → Brief. No new Home category or operational view.
All model text is escaped and presented as a suggestion pending factual verification.

## Local validation

- `npm test`: domain, adapter, engine, presentation and existing JS regression tests.
- `npm run test:db`: creates/drops its own disposable Docker DB; migrations, rollback,
  before/after data equality, RLS, receipts, CAS and independent-session concurrency.
- SQL Golden Flow runs the actual fixture generator → engine → persistence RPCs →
  owner read → renderer, writing synthetic output only to `/tmp/freya-tb04-golden.json`.
- `scripts/check-proposals-browser.mjs`: actual markup/handlers/modules at 390 px,
  using the persisted synthetic Golden result and simulated browser transport.
- Existing `scripts/check-live-brief-browser.mjs`: TB-03 regression.
- Deno check, build, entry parity and whitespace checks.

Full deployed Auth → Edge → real model → production DB E2E is deliberately not run:
remote migration and deployment are not authorized. The previously approved single
Responses call already passed strict Candidate validation; implementation adds no
real model calls. Future rollout: compatible DB first, configured Edge second,
client/PWA last, with explicit authorization at that time.

## TB-04.1 local follow-up

- A lost/uncertain response retains the exact operation. Read reconciliation precedes replay. A failed retry is acknowledged only after its generation attempt advanced or its exact receipt was returned; reading the previous failed attempt is insufficient.
- Confirmed terminal failure closes local pending state. Only another explicit user click allocates a new retry operation. No automatic model retry.
- Brief CTA is `✨ Proposa’m viatges`: with no current generation it goes directly through processing to alternatives. Refresh/Back/read never manufacture a generation. Timeout has specific copy. Brief reload appears only for conflict/reconciliation.
- Existing DB lease remains 90s. Provider budget is 70s = 90s lease minus 10s lease reserve minus two 5s RPC budgets. The attempt cancellation deadline is at most 80s and shrinks to lease expiry minus 10s on delayed claims. Auth/RPC calls are bounded to 5s; finishing/failure persistence remains inside the lease reserve. This fits the documented 150s Supabase HTTP idle/free wall-clock limit. No schema change required.
- One structured server log per claimed attempt: generation ID, attempt number, total duration, stage, sanitized error code and nullable validated provider request ID. No notes, snapshot, model output, tokens or credentials. Timeouts before response headers have no request ID.
- No claim of real-world latency coverage: a response beyond 70s still times out explicitly. Virtual-clock tests cover a 55s successful response and the 70s abort. No new paid/model call required for this local correction.
- PWA cache version bumped for the modified cached frontend module; fetch strategies and precache list unchanged.

# TB-07 — Search preferences + first live provider adapter

## Scope
TB-07 is backend/domain plumbing only. TB-08 will expose search in the product UI.
No booking is created, no Trip Brief decision is mutated, and provider output never
becomes a confirmed reservation automatically.

## Brief → search contract
`compileFlightSearchFromBrief` builds a live-flight query only from explicit,
confirmed Trip Brief data. It fails closed when origin/destination are ambiguous,
dates are flexible rather than exact, there is no adult traveler, a child age is
unknown, or required search context (market/locale/currency/cabin) is absent.
It never picks the first of multiple user places and never turns an interpreted
decision into a search fact.

Flight decisions are carried as typed preferences with their decision ID and
strength. The first Skyscanner adapter deliberately does not claim support for
those preference filters yet. If an unsupported preference is hard, the adapter
returns no results. Preference/flexible items may accompany results but are
listed in `unapplied_preferences` so TB-08 can disclose them.

## Skyscanner Flights Live Prices
The server-only adapter uses the official Skyscanner partner APIs:
1. Flights Autosuggest resolves free-text origin and destination.
2. Flights Live Prices `/create` starts an exact-date round trip search.
3. `/poll` is called a bounded number of times and stops on COMPLETE.
4. Results are normalized to Freya's provider contract.

The API key is read only from `SKYSCANNER_API_KEY` in the Edge Function
environment. It is never returned to the client or added to the PWA bundle.

Prices respect Skyscanner's PriceUnit enum (whole/centi/milli/micro). Only HTTPS
booking links are exposed. If an itinerary has multiple booking links, Freya does
not pretend there is a single booking URL: all links are retained in sanitized
provider metadata and the top-level `deeplink` is omitted.

Provider place resolution is retained in each result so the future TB-08 UI can
show what Skyscanner actually resolved instead of silently treating provider
ranking as user intent.

## Non-goals
No hotel/car live adapter, no flexible-date indicative search, no ranking/winner,
no automatic price-to-budget write, no confirmation, no booking action, and no
frontend/PWA integration in TB-07.

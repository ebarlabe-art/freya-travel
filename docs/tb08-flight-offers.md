# TB-08.2 — Flight offers inside Build

TB-08.2 adds live flight search to a concrete Build flight component.

## Product contract
- The search is opened from a specific flight component.
- Existing operational origin/destination/date are used only as editable seeds.
- Missing route/date/traveler data is never inferred from free text.
- The original Trip Brief supplies traveler and flight preference context.
- The user confirms the visible search form before any provider request.
- Search results are transient in TB-08.2: no offer is selected or persisted yet.
- Offer selection is reserved for TB-08.3.
- A live search never mutates the operational flight or confirms a booking.

## Search semantics
Build flight searches are one-way legs. The travel-search contract now supports:
- trip_type = one_way with end_date = null
- trip_type = round_trip with an explicit end_date

The Skyscanner adapter sends one queryLeg for a one-way Build search and two for a round trip.

Hard preferences remain fail-closed: if a provider cannot apply an indispensable preference, Freya returns no offers instead of silently relaxing it.

## UI
Each non-cancelled flight component exposes “Buscar opcions de vol”.
The form contains origin, destination, date, cabin, travelers and currency.
Results can show carrier, local departure/arrival times, duration, stops, price, agent and a verified HTTPS booking link when exactly one exists.

If no partner credentials are configured, the UI states that the search path is ready but no live provider is connected.

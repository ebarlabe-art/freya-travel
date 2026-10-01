-- Unify the operational reservation lifecycle across all travel pieces.
-- "reserved" means the piece already belongs to the trip, while "confirmed"
-- remains the gate for confirmation-specific automation such as reminders.

alter table public.trip_flights
  drop constraint if exists trip_flights_status_check;

alter table public.trip_flights
  add constraint trip_flights_status_check
  check (flight_status in ('planning','reserved','confirmed','cancelled'));

alter table public.trip_accommodations
  drop constraint if exists trip_accommodations_reservation_status_check;

alter table public.trip_accommodations
  add constraint trip_accommodations_reservation_status_check
  check (reservation_status in ('planning','reserved','confirmed','cancelled'));

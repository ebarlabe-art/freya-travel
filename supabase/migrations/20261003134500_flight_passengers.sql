alter table public.trip_flights
  add column passengers text;

alter table public.trip_flights
  add constraint trip_flights_passengers_check
  check (
    passengers is null
    or (
      passengers = btrim(passengers)
      and char_length(passengers) between 1 and 1000
    )
  );

comment on column public.trip_flights.passengers is
  'Passenger names explicitly associated with this flight segment; structured participant linkage can replace this transitional field later.';

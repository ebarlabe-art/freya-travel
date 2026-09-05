alter table public.trip_accommodations
  add column city text,
  add column postal_code text,
  add column region text,
  add column country text;

alter table public.trip_accommodations
  add constraint trip_accommodations_city_check
    check (city is null or (city = btrim(city) and city ~ '[^[:space:]]' and char_length(city) between 1 and 200)) not valid,
  add constraint trip_accommodations_postal_code_check
    check (postal_code is null or (postal_code = btrim(postal_code) and postal_code ~ '[^[:space:]]' and char_length(postal_code) between 1 and 40)) not valid,
  add constraint trip_accommodations_region_check
    check (region is null or (region = btrim(region) and region ~ '[^[:space:]]' and char_length(region) between 1 and 200)) not valid,
  add constraint trip_accommodations_country_check
    check (country is null or (country = btrim(country) and country ~ '[^[:space:]]' and char_length(country) between 1 and 200)) not valid;

alter table public.trip_accommodations
  validate constraint trip_accommodations_city_check,
  validate constraint trip_accommodations_postal_code_check,
  validate constraint trip_accommodations_region_check,
  validate constraint trip_accommodations_country_check;

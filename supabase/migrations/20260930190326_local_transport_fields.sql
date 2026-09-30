alter table public.trip_activities
  add column transport_mode text,
  add column transport_origin_name text,
  add column transport_origin_address text,
  add column transport_origin_city text,
  add column transport_destination_name text,
  add column transport_destination_address text,
  add column transport_destination_city text,
  add column transport_arrival_time_zone text,
  add column transport_service_number text,
  add column transport_seat text,
  add column transport_platform text;

alter table public.trip_activities
  add constraint trip_activities_transport_mode_check
    check (transport_mode is null or transport_mode in ('train','bus','ferry','transfer','taxi','vtc','metro','tram','public_transport','other')),
  add constraint trip_activities_transport_origin_name_check
    check (transport_origin_name is null or (transport_origin_name=btrim(transport_origin_name) and char_length(transport_origin_name) between 1 and 200)),
  add constraint trip_activities_transport_origin_address_check
    check (transport_origin_address is null or (transport_origin_address=btrim(transport_origin_address) and char_length(transport_origin_address) between 1 and 500)),
  add constraint trip_activities_transport_origin_city_check
    check (transport_origin_city is null or (transport_origin_city=btrim(transport_origin_city) and char_length(transport_origin_city) between 1 and 200)),
  add constraint trip_activities_transport_destination_name_check
    check (transport_destination_name is null or (transport_destination_name=btrim(transport_destination_name) and char_length(transport_destination_name) between 1 and 200)),
  add constraint trip_activities_transport_destination_address_check
    check (transport_destination_address is null or (transport_destination_address=btrim(transport_destination_address) and char_length(transport_destination_address) between 1 and 500)),
  add constraint trip_activities_transport_destination_city_check
    check (transport_destination_city is null or (transport_destination_city=btrim(transport_destination_city) and char_length(transport_destination_city) between 1 and 200)),
  add constraint trip_activities_transport_arrival_time_zone_check
    check (transport_arrival_time_zone is null or (transport_arrival_time_zone=btrim(transport_arrival_time_zone) and char_length(transport_arrival_time_zone) between 1 and 100)),
  add constraint trip_activities_transport_service_number_check
    check (transport_service_number is null or (transport_service_number=btrim(transport_service_number) and char_length(transport_service_number) between 1 and 100)),
  add constraint trip_activities_transport_seat_check
    check (transport_seat is null or (transport_seat=btrim(transport_seat) and char_length(transport_seat) between 1 and 100)),
  add constraint trip_activities_transport_platform_check
    check (transport_platform is null or (transport_platform=btrim(transport_platform) and char_length(transport_platform) between 1 and 100)),
  add constraint trip_activities_transport_fields_scope_check
    check (
      activity_type in ('transport','transport_activity')
      or (
        transport_mode is null
        and transport_origin_name is null
        and transport_origin_address is null
        and transport_origin_city is null
        and transport_destination_name is null
        and transport_destination_address is null
        and transport_destination_city is null
        and transport_arrival_time_zone is null
        and transport_service_number is null
        and transport_seat is null
        and transport_platform is null
      )
    );
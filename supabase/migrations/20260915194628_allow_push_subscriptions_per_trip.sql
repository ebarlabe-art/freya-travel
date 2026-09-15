alter table public.push_subscriptions
  drop constraint push_subscriptions_endpoint_key;

alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_trip_key
  unique (endpoint, trip_id);

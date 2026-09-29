-- Cover TB-06 foreign keys reported by the database advisor.
create index trip_component_cost_operations_component_idx on public.trip_component_cost_operations(trip_id,component_id);
create index trip_budget_setting_operations_trip_idx on public.trip_budget_setting_operations(trip_id);
create index trip_component_costs_updated_by_idx on public.trip_component_costs(updated_by);
create index trip_budget_settings_updated_by_idx on public.trip_budget_settings(updated_by);

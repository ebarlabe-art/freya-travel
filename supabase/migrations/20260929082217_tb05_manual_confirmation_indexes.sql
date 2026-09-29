
create index if not exists trip_component_confirmation_handoff_idx
  on public.trip_component_confirmation_operations(handoff_id, trip_id);

create index if not exists trip_component_confirmation_evidence_idx
  on public.trip_component_confirmation_operations(trip_id, evidence_document_id)
  where evidence_document_id is not null;

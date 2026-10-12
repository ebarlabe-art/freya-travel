-- STAGING ONLY. The fresh 02_private_documents.sql already created the
-- exact UNIQUE(trip_id,id) which the first canonical accommodation
-- migration creates again. Staging has zero travel documents. Drop this
-- duplicate constraint immediately before applying that canonical migration.
-- Do not apply to production.
alter table public.travel_documents
 drop constraint if exists travel_documents_trip_id_id_key;

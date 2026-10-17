-- Validation-only least privilege after exact source-baseline comparison.
-- PostgREST/PDF flows need row DML, not table truncation or trigger/schema DDL.
BEGIN;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public, app_private, place_private, proposal_private FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('public','app_private','place_private','proposal_private') AND c.relkind='r'
  AND (has_table_privilege('anon',c.oid,'TRUNCATE') OR has_table_privilege('authenticated',c.oid,'TRUNCATE')
   OR has_table_privilege('anon',c.oid,'TRIGGER') OR has_table_privilege('authenticated',c.oid,'TRIGGER')
   OR has_table_privilege('anon',c.oid,'REFERENCES') OR has_table_privilege('authenticated',c.oid,'REFERENCES')))
 THEN RAISE EXCEPTION 'Unexpected elevated table privileges for client roles'; END IF;
END $$;
COMMIT;

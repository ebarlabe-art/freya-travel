-- TEST FIXTURE ONLY, for an empty disposable local database, never production.
-- Auth is a minimal test double, not a replacement for GoTrue.
create schema auth;
create table auth.users (
  id uuid primary key, instance_id uuid, aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
create publication supabase_realtime;
-- Supabase public-schema service-role defaults (RLS bypass is a cluster role).
alter default privileges in schema public grant all on tables to service_role;

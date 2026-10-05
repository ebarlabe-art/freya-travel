-- Local disposable SQL contract fixture, not the Storage HTTP server.
create schema storage;
create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,updated_at timestamptz default clock_timestamp(),unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,service_role;
grant select on storage.objects to authenticated;
insert into storage.buckets(id,name) values('trip-documents','trip-documents');

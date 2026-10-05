-- Align the source photo bucket with ALB-03's mobile-photo preservation ceiling.
-- Targeted operational change only: no policy, MIME allowlist, or object mutation.

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'trip-documents') then
    raise exception 'trip-documents bucket is missing';
  end if;
end
$$;

update storage.buckets
set file_size_limit = 33554432
where id = 'trip-documents'
  and file_size_limit is distinct from 33554432;

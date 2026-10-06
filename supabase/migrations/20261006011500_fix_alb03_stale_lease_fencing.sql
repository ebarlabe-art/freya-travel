-- Slow image processing may legitimately finish after the lease deadline.
-- lease_until controls when another worker may take over; lease_id is the fencing token.
-- A late finisher is safe while its lease_id is still current. If another worker has
-- claimed the asset, the changed lease_id still rejects the stale finisher.

create or replace function app_private.alb03_finish_v1(
  p_asset_id uuid,
  p_actor uuid,
  p_lease_id uuid,
  p_descriptor jsonb,
  p_error text default null
) returns void
language plpgsql security definer set search_path='' as $$
declare
  j app_private.alb03_ingestions;
  a public.travel_book_assets;
  x jsonb;
  k text;
  root text;
  token text;
  original_exists boolean;
  complete boolean;
  old_variant public.travel_book_asset_variants;
begin
  select * into j from app_private.alb03_ingestions where asset_id=p_asset_id;
  if not found then
    raise exception 'ALB_TARGET_UNAVAILABLE' using errcode='P0002';
  end if;

  perform app_private.alb03_scope_v1(j.trip_id,j.book_id,p_actor);
  select * into j from app_private.alb03_ingestions where id=j.id for update;

  -- lease_until only makes the job claimable by another worker. The lease_id is
  -- the actual fencing token: if no takeover happened, the original worker may
  -- still finish after the deadline; after takeover, the old token is rejected.
  if p_lease_id is null or j.lease_id is distinct from p_lease_id then
    raise exception 'ALB_STALE_LEASE' using errcode='40001';
  end if;

  select * into a from public.travel_book_assets where id=p_asset_id for update;

  if p_error is not null then
    if p_error not in (
      'SOURCE_MISSING','SOURCE_CHANGED','INVALID_IMAGE','LIMIT_EXCEEDED',
      'STORAGE_ERROR','MASTER_MISSING','DERIVATIVE_UNSUPPORTED',
      'DERIVATIVE_CAPACITY','DERIVATIVE_COLOR','DERIVATIVE_FAILED'
    ) then
      raise exception 'ALB_INVALID_ERROR' using errcode='22023';
    end if;
    update app_private.alb03_ingestions
      set error_code=p_error,lease_id=null,lease_until=null,updated_at=clock_timestamp()
      where id=j.id;
    update public.travel_book_assets
      set status=case
        when status='ready' or p_error in ('SOURCE_MISSING','MASTER_MISSING') then 'missing'
        else status
      end,
      updated_at=clock_timestamp(),updated_by=p_actor
      where id=a.id;
    return;
  end if;

  if p_descriptor is null
     or jsonb_typeof(p_descriptor)<>'object'
     or not(p_descriptor ? 'original')
     or p_descriptor-'original'-'preview'-'thumbnail'<>'{}'
     or (p_descriptor ? 'preview')<>(p_descriptor ? 'thumbnail') then
    raise exception 'ALB_INVALID_DESCRIPTOR' using errcode='22023';
  end if;

  complete:=p_descriptor ? 'preview';
  root:=j.trip_id::text||'/'||j.book_id::text||'/'||a.asset_key::text||'/'||a.version::text||'/v1/';

  select exists(
    select 1 from public.travel_book_asset_variants
    where asset_id=a.id and kind='original'
  ) into original_exists;

  if not original_exists then
    select app_private.travel_book_hash_v1(
      jsonb_build_object('id',o.id,'updated_at',o.updated_at,'path',o.name)
    )
    into token
    from storage.objects o
    where bucket_id='trip-documents' and name=j.source_path;

    if token is distinct from j.source_token
       or not exists(
         select 1 from public.travel_documents
         where id=j.source_id
           and trip_id=j.trip_id
           and category='Foto'
           and file_path=j.source_path
       ) then
      raise exception 'ALB_SOURCE_CHANGED' using errcode='40001';
    end if;
  end if;

  for k,x in select * from jsonb_each(p_descriptor) loop
    if jsonb_typeof(x)<>'object'
       or not(x ?& array['hash','width','height','path','mime','ext','byte_size','orientation'])
       or x-'hash'-'width'-'height'-'path'-'mime'-'ext'-'byte_size'-'orientation'<>'{}'
       or jsonb_typeof(x->'width')<>'number'
       or jsonb_typeof(x->'height')<>'number'
       or jsonb_typeof(x->'byte_size')<>'number'
       or jsonb_typeof(x->'orientation')<>'number'
       or coalesce(x->>'hash','')!~'^[0-9a-f]{64}$'
       or coalesce(x->>'width','')!~'^[1-9][0-9]{0,4}$'
       or coalesce(x->>'height','')!~'^[1-9][0-9]{0,4}$'
       or coalesce(x->>'byte_size','')!~'^[1-9][0-9]{0,7}$'
       or coalesce(x->>'orientation','')!~'^[0-8]$'
       or coalesce(x->>'ext','') not in ('jpg','png','webp','heic','heif')
       or coalesce(x->>'path','')<>root||k||'.'||(x->>'ext') then
      raise exception 'ALB_INVALID_DESCRIPTOR' using errcode='22023';
    end if;

    select * into old_variant
    from public.travel_book_asset_variants
    where asset_id=a.id and kind=k;

    if found then
      if (
        old_variant.content_hash,old_variant.width_px,old_variant.height_px,
        old_variant.storage_path,old_variant.mime_type,old_variant.file_extension,
        old_variant.byte_size,old_variant.orientation
      ) is distinct from (
        x->>'hash',(x->>'width')::int,(x->>'height')::int,
        x->>'path',x->>'mime',x->>'ext',(x->>'byte_size')::int,
        (x->>'orientation')::smallint
      ) then
        raise exception 'ALB_IMMUTABLE' using errcode='55000';
      end if;
    else
      insert into public.travel_book_asset_variants(
        trip_id,book_id,asset_id,kind,pipeline_version,content_hash,
        width_px,height_px,mime_type,storage_bucket,storage_path,
        file_extension,byte_size,orientation
      ) values(
        j.trip_id,j.book_id,a.id,k,1,x->>'hash',
        (x->>'width')::int,(x->>'height')::int,x->>'mime','travel-book',
        x->>'path',x->>'ext',(x->>'byte_size')::int,(x->>'orientation')::smallint
      );
    end if;
  end loop;

  if complete then
    update public.travel_book_assets
      set status='ready',
          content_hash=p_descriptor#>>'{preview,hash}',
          mime_type='image/png',
          width_px=(p_descriptor#>>'{preview,width}')::int,
          height_px=(p_descriptor#>>'{preview,height}')::int,
          storage_bucket='travel-book',
          storage_path=p_descriptor#>>'{preview,path}',
          verified_at=coalesce(verified_at,clock_timestamp()),
          updated_at=clock_timestamp(),
          updated_by=p_actor
      where id=a.id;
  end if;

  update app_private.alb03_ingestions
    set source_hash=p_descriptor#>>'{original,hash}',
        source_orientation=(p_descriptor#>>'{original,orientation}')::smallint,
        error_code=null,
        lease_id=case when complete then null else lease_id end,
        lease_until=case when complete then null else lease_until end,
        updated_at=clock_timestamp()
    where id=j.id;
end $$;

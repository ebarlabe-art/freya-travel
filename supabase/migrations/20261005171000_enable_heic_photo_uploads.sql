-- Extend generic photo uploads to preserve HEIC/HEIF sources without conversion.
create or replace function public.finalize_trip_photo(
  p_trip_id uuid,p_document_id uuid,p_title text,p_file_name text,p_mime_type text,
  p_upload_batch_id uuid,p_selection_index integer,p_local_date date,
  p_activity_id uuid,p_itinerary_item_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.travel_documents; m public.trip_photo_metadata; ext text; path text; uid uuid:=auth.uid();
begin
  if uid is null or not public.is_trip_member(p_trip_id) or not exists
    (select 1 from public.trips where id=p_trip_id and experience_key is distinct from 'london-2026') then
    raise exception 'No tens acces a les fotos contextuals' using errcode='42501';
  end if;
  ext:=case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    when 'image/heic' then 'heic'
    when 'image/heif' then 'heif'
  end;
  if p_document_id is null or p_upload_batch_id is null or p_selection_index is null or p_selection_index not between 0 and 19
    or ext is null or nullif(btrim(p_title),'') is null or length(p_title)>160
    or nullif(btrim(p_file_name),'') is null or length(p_file_name)>1024 then
    raise exception 'Dades de foto no valides' using errcode='22023';
  end if;
  path:=p_trip_id::text||'/photos/'||uid::text||'/'||p_document_id::text||'.'||ext;
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text,0));
  select * into d from public.travel_documents where id=p_document_id for update;
  if found then
    select * into m from public.trip_photo_metadata where document_id=d.id;
    if d.trip_id<>p_trip_id or d.created_by<>uid or d.category<>'Foto' or d.file_path<>path
      or d.file_name<>p_file_name or m.document_id is null
      or m.upload_batch_id is distinct from p_upload_batch_id or m.selection_index is distinct from p_selection_index then
      raise exception 'Identitat de pujada incompatible' using errcode='22023';
    end if;
    return jsonb_build_object('document',to_jsonb(d),'metadata',to_jsonb(m));
  end if;
  insert into public.travel_documents(id,trip_id,title,category,file_name,file_path,mime_type,created_by)
    values(p_document_id,p_trip_id,btrim(p_title),'Foto',p_file_name,path,p_mime_type,uid) returning * into d;
  insert into public.trip_photo_metadata(document_id,trip_id,local_date,activity_id,itinerary_item_id,upload_batch_id,selection_index)
    values(d.id,p_trip_id,p_local_date,p_activity_id,p_itinerary_item_id,p_upload_batch_id,p_selection_index) returning * into m;
  return jsonb_build_object('document',to_jsonb(d),'metadata',to_jsonb(m));
end; $$;

BEGIN;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('expense-receipts','expense-receipts',false,10485760,ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf']::text[]);

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('trip-documents','trip-documents',false,33554432,ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]);

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('travel-book','travel-book',false,33554432,ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]);

CREATE POLICY "travel_book_objects_read" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'travel-book'::text) AND app_private.alb03_can_read_object_v1(name)));

CREATE POLICY "trip members can delete trip document files" ON storage.objects AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'trip-documents'::text) AND is_trip_member(((storage.foldername(name))[1])::uuid)));

CREATE POLICY "trip members can read trip document files" ON storage.objects AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'trip-documents'::text) AND is_trip_member(((storage.foldername(name))[1])::uuid)));

CREATE POLICY "trip members can update trip document files" ON storage.objects AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((bucket_id = 'trip-documents'::text) AND is_trip_member(((storage.foldername(name))[1])::uuid))) WITH CHECK (((bucket_id = 'trip-documents'::text) AND is_trip_member(((storage.foldername(name))[1])::uuid)));

CREATE POLICY "trip members can upload trip document files" ON storage.objects AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'trip-documents'::text) AND is_trip_member(((storage.foldername(name))[1])::uuid)));

CREATE POLICY "trip members delete expense receipts" ON storage.objects AS PERMISSIVE FOR DELETE TO PUBLIC USING (((bucket_id = 'expense-receipts'::text) AND (EXISTS ( SELECT 1
   FROM trip_members tm
  WHERE (((tm.trip_id)::text = (storage.foldername(objects.name))[1]) AND (tm.user_id = auth.uid()))))));

CREATE POLICY "trip members delete storage documents" ON storage.objects AS PERMISSIVE FOR DELETE TO PUBLIC USING (((bucket_id = 'trip-documents'::text) AND (EXISTS ( SELECT 1
   FROM trip_members tm
  WHERE ((tm.trip_id = ((storage.foldername(objects.name))[1])::uuid) AND (tm.user_id = auth.uid()))))));

CREATE POLICY "trip members read expense receipts" ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC USING (((bucket_id = 'expense-receipts'::text) AND (EXISTS ( SELECT 1
   FROM trip_members tm
  WHERE (((tm.trip_id)::text = (storage.foldername(objects.name))[1]) AND (tm.user_id = auth.uid()))))));

CREATE POLICY "trip members read storage documents" ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC USING (((bucket_id = 'trip-documents'::text) AND (EXISTS ( SELECT 1
   FROM trip_members tm
  WHERE ((tm.trip_id = ((storage.foldername(objects.name))[1])::uuid) AND (tm.user_id = auth.uid()))))));

CREATE POLICY "trip members upload expense receipts" ON storage.objects AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((bucket_id = 'expense-receipts'::text) AND (EXISTS ( SELECT 1
   FROM trip_members tm
  WHERE (((tm.trip_id)::text = (storage.foldername(objects.name))[1]) AND (tm.user_id = auth.uid()))))));

CREATE POLICY "trip members upload storage documents" ON storage.objects AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((bucket_id = 'trip-documents'::text) AND (EXISTS ( SELECT 1
   FROM trip_members tm
  WHERE ((tm.trip_id = ((storage.foldername(objects.name))[1])::uuid) AND (tm.user_id = auth.uid()))))));

COMMIT;

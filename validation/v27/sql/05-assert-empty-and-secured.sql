-- NEW VALIDATION PROJECT ONLY, after 01..04 and before synthetic accounts/data.
BEGIN READ ONLY;
DO $$
DECLARE n integer;
BEGIN
  IF EXISTS(SELECT 1 FROM public.trips) OR EXISTS(SELECT 1 FROM public.trip_members)
    OR EXISTS(SELECT 1 FROM public.travel_documents) OR EXISTS(SELECT 1 FROM auth.users)
    OR EXISTS(SELECT 1 FROM storage.objects)
  THEN RAISE EXCEPTION 'Expected a new empty validation backend'; END IF;
  SELECT count(*) INTO n FROM pg_tables WHERE schemaname IN ('public','app_private','place_private','proposal_private');
  IF n<>62 THEN RAISE EXCEPTION 'Expected 62 application tables, found %',n; END IF;
  IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity)
  THEN RAISE EXCEPTION 'Exposed application table without RLS'; END IF;
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema='public'
    AND table_name IN ('trip_itinerary_items','trip_activities') AND column_name='resolved_location';
  IF n<>2 THEN RAISE EXCEPTION 'Missing v27 columns'; END IF;
  IF EXISTS(SELECT 1 FROM storage.buckets WHERE public)
  THEN RAISE EXCEPTION 'Public validation bucket'; END IF;
  IF (SELECT count(*) FROM storage.buckets WHERE id IN ('trip-documents','expense-receipts','travel-book'))<>3
  THEN RAISE EXCEPTION 'Missing private buckets'; END IF;
  IF (SELECT fresh_days FROM place_private.settings WHERE singleton) IS DISTINCT FROM 90
  THEN RAISE EXCEPTION 'Missing non-personal place configuration'; END IF;
END $$;
COMMIT;

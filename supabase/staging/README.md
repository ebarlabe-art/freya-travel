# Freya Travel PROVES · estat del backend aïllat

**Projecte Supabase:** `waatqrqyddurultrazbn` · **Europa central** · mateixa organització que Londres-2026 però projecte físicament diferent.

**Norma:** Aquest bootstrap és exclusiu per a Supabase PROVES. No s'han copiat dades, usuaris, documents, secrets ni còpies de la base pública. No executar cap SQL d'aquest directori a producció.

## Instal·lació ja aplicada

1. `supabase/staging/01_core.sql` — viatges, membres i checklist; RLS i RPCs inicials.
2. `supabase/staging/02_private_documents.sql` — documents privats, Storage `trip-documents`, polítiques RLS per viatge i límit de mida del bucket.
3. Migracions canòniques seleccionades del repositori: `20260901000000` (activitats d'itinerari), `20260903165549` (multi-viatge), `20260904151039` (checklist genèric), `20260908173557` i `20260908203753` (itinerari manual i hores aproximades).
4. `supabase/staging/03_before_accommodations.sql` — conciliació del duplicat del constraint únic `travel_documents(trip_id,id)` que la migració canònica següent crea per si mateixa. Només s'usa **abans** d'aquesta migració i amb la base encara buida.
5. Migracions canòniques seleccionades: `20260905094850`, `20260905145609` (allotjaments), `20260906123000` (vols), `20260907184020` (activitats), `20260908221942` (metadades de dia). Els fitxers canònics no s'han modificat.
6. `supabase/staging/04_harden_api_permissions.sql` — retirat l'EXECUTE anònim de quatre RPCs antigues que Supabase havia concedit directament a `anon` i mogut el validador de Storage a `app_private` (fora de l'esquema API). L'auditoria de seguretat posterior no mostra cap advertiment de `SECURITY DEFINER` accessible anònim. Els avisos de funcions autenticades continuen i s'han de revisar funcionalment, no suprimir a cegues.
7. Edge Function **`import-itinerary` versió 1**, desplegada **únicament** a Supabase PROVES amb `verify_jwt=true`. Rep referències a PDFs del bucket privat però no escriu itineraris. Per fer extraccions reals li caldran secrets propis de proves `OPENAI_API_KEY` i `A2_ITINERARY_MODEL` (i validació prèvia de cost/privacitat).

Hi ha **23 taules públiques** actualment, totes amb RLS, i bucket privat. A més del nucli inicial s'han aplicat les migracions canòniques seleccionades de `update_trip_metadata`, `trip_briefs_v1`, `trip_brief_contract_v1_1`, `trip_stops_and_draft_delete`, `extend_flight_travel_pack_documents`, `create_trip_reminders`, `shared_trip_progress`, `contextual_photos_v1`, `local_transport_fields`, `validate_local_transport_arrival_timezone`, `unify_piece_reservation_status`, `flight_passengers`, `trip_travelers_flight_documents`, `fix_trip_flight_travelers_rpc`, `accommodation_stay_dates`, `expand_trip_documents_mobile_photo_limit` i `enable_heic_photo_uploads`. Les migracions registrades al projecte de proves són les indicades; **no equivalen a una rèplica integral** de Londres-2026.

## Verificacions passades

- `verify_rls_rollback.sql`: dos usuaris i viatges ficticis; autenticació simulada, SELECT d'aïllament en `trips`, `travel_documents` i `storage.objects`; intent d'INSERT de document i objecte al viatge d'un altre usuari rebutjat; accés revocat quan es retira la pertinença. Tot es fa dins `BEGIN`/`ROLLBACK`.
- `verify_trip_creation_rollback.sql`: crear un viatge genèric amb `create_trip_v2` i verificar que `get_my_trips` el retorna i que el checklist té 10 punts universals. També amb `ROLLBACK`.
- Verificació posterior: **0 usuaris, 0 viatges, 0 documents, 0 fitxers, 0 aparcaments i 0 subscripcions**, sense cap fixture conservada. Les 23 taules tenen RLS activada.

## Què encara NO funciona per a usuaris

- Railway Freya PROVES encara **serveix** la branca anterior de previsualització d'Offline V2. S'han **preparat però no aplicat** les variables `FREYA_BACKEND_ENV=staging`, la URL i la clau pública del nou Supabase, i un canvi de codi fixat al commit de la PR #107 (pinned), dins el mateix patch pendent de Railway. Aquesta branca **no és la nova pantalla A2.7 i podria apuntar al Supabase de producció**. No usar-la per provar importacions fins a verificar explícitament el backend generat.
- El nou `configure-pages-backend.mjs` exigeix mode `FREYA_BACKEND_ENV=staging` i paràmetres del projecte independent per generar la futura PWA aïllada. No hem canviat la configuració del servei Railway.
- El projecte encara no té usuaris reals ni de prova persistents i no té tots els mòduls/esquemes de l'app completa (alguns components operatius, pressupost, Travel Book, etc.); completar migracions en l'ordre de dependències correcte abans d'habilitar-ne les pantalles.
- El servei d'IA i els PDFs de prova reals no s'han exercitat encara en HTTP E2E. La lectura de PDFs per model no demostra exhaustivitat; el consentiment explícit i la revisió humana continuen sent obligatoris.
- `supabase/staging/05_generic_auxiliary_tables.sql` incorpora `travel_parking` i `push_subscriptions`, amb RLS per usuari i viatge; `verify_auxiliary_rls_rollback.sql` verifica aïllament de lectura, insercions alienes denegades i revocació. Els dos scripts han passat a PROVES amb rollback complet. La taula `travel_expenses` no s'ha copiat perquè manté un contracte històric específic de Londres; cal un disseny propi abans de generalitzar despeses.
- L'auditoria del backend actual indica `rls_enabled_no_policy` per `trip_reminders` i `trip_brief_operations`: tenen RLS deliberadament sense policies d'accés directe a usuaris (servei intern). Resta comprovar les advertències de funcions `SECURITY DEFINER` autenticades segons l'abast de cadascuna; no confondre-ho amb accés anònim, que ja no hi apareix.
- `A2.8` (escriptura segura al viatge) **pendent**: el botó «Desar al viatge» continua desactivat.

## Següents portes

1. Conciliar l'esquema staging restant amb la base pública, sense exportar-ne dades ni fer canvis al projecte productiu.
2. Preparar dos comptes de prova nous i un PDF totalment sintètic. Verificar via API HTTP real JWT, RLS, membres/expulsió, errors i cost d'IA.
3. Configurar els secrets d'IA **només** al projecte de proves, amb límits de despesa.
4. La compilació CI en mode staging ha passat i comprova que no es filtra la URL de producció al HTML generat ni al fallback `404.html`. El canvi de Railway **és pendent d'aprovació/aplicació**, no hi ha cap deploy nou. La pantalla de l'app no és encara un test d'integració real.
5. Fer una prova física iPhone i revisar A2.7 abans de plantejar fusió/publicació.

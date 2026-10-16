# V27 — ubicacions automàtiques i trajectes

Branca: `fix/automatic-itinerary-places-v27`. Destinació de la PR: `main`, la branca pública. Cap fusió, migració remota, desplegament ni canvi a Freya Nova/Proves forma part d'aquesta entrega.

## Comportament

En obrir un dia de l'agenda, Freya reutilitza la cerca existent de `place-resolution` per enriquir tant el planning manual/importat com les activitats de `trip_activities`. Després de confirmar la importació habitual del document, no cal tornar a confirmar cada ubicació fiable. La proposta d'importació continua sent de només lectura fins que es desa explícitament.

L'assignació automàtica exigeix nom complet coincident, coordenades exactes dins de rang, ciutat coincident i país ISO acreditat per les destinacions del viatge. En un viatge amb diverses destinacions s'utilitza la ciutat explícita de l'activitat o, si falta, dues activitats adjacents del mateix dia que indiquin explícitament la mateixa ciutat. Els trasllats, vols, canvis de dia o desacords impedeixen aquesta inferència. No s'utilitzen la ubicació del telèfon ni coordenades generades per IA.

Els noms compostos de Londres es conserven complets durant l'extracció del PDF. Les coincidències desconegudes, aproximades, homònimes o sense context queden pendents en el selector existent. Els carrers, adreces explícites i àlies que no coincideixen amb el nom verificat requereixen revisió; no es força una coincidència. Les consultes continuen limitades a 30 per sessió de viatge i es comparteixen els resultats repetits. Un error del proveïdor atura la cua fins al reintent.

`resolved_location` conserva la geografia, identificador del proveïdor, atribució i snapshot dels camps de lloc originals. No substitueix un nom, adreça o ciutat ja introduïts. Un trigger invalida aquest snapshot quan es corregeix el títol o el lloc. Les coordenades existents de les activitats tenen prioritat i queden excloses de l'enriquiment. Cada escriptura comprova viatge, registre, revisió `updated_at` i nom original; les polítiques RLS existents continuen governant l'accés.

Les rutes reutilitzen `itinerary-route` i Geoapify Routing, les coordenades desades i les barreres entre tipus d'activitats. El mode inicial és a peu; l'usuari pot triar cotxe o transport públic. Temps i distància provenen del servei. Un conflicte entre el temps de trajecte i l'horari es mostra automàticament; el marge addicional és opcional. «Consulta el trajecte al mapa» obre Google Maps amb els punts i el mode verificats; Google pot proposar una ruta diferent. Freya no canvia hores, dates, reserves, documents ni activitats.

La PWA passa a `pwa-automatic-places-v27` / cache `freya-travel-release-6444-v27`; `404.html` es genera amb `entries:sync`.

## Dependències i ordre de validació

La migració nova està escrita i provada localment, **no aplicada remotament**. Les Edge Functions i el frontend estan modificats al repositori, **no desplegats**. No s'han verificat credencials de Geoapify, quotes, dades de producció ni login real amb un compte.

Per validar amb serveis reals, cal un entorn aïllat autoritzat amb:

**Revisió de validació real (16/10/2026):** vegeu [el pla i els bloquejos verificats](v27-real-validation.md). La preview Railway existent serveix encara l'endpoint de producció; no s'ha d'utilitzar per a aquestes proves. El generador `node scripts/build-v27-validation.mjs` prepara una còpia separada i falla si s'hi troben els backends protegits.

1. Les taules i contractes existents de Freya, més `20261016153108_itinerary_resolved_location_v27.sql` aplicada primer. No hi ha backfill ni taules/RLS noves. La migració afegeix la mateixa columna a `trip_itinerary_items` i `trip_activities`.
2. `place-resolution` actualitzada (ara retorna també `locality`) i `itinerary-route` actualitzada, amb `GEOAPIFY_API_KEY` només al servidor. Es reutilitzen la sessió/JWT i RLS de l'usuari.
3. La importació existent de PDF, amb la configuració OpenAI existent (`OPENAI_API_KEY` i model d'importació), Storage i permisos de documents del viatge.
4. El frontend de la branca connectat a aquest entorn. L'entrada actual té `SUPABASE_URL` i `SUPABASE_KEY` a `index.html`: els `VITE_SUPABASE_*` del workflow no els substitueixen. Configurar-los només en una còpia de validació; no apuntar una prova a producció. Executar `npm run entries:sync` després de configurar aquesta còpia.

No cal afegir cap proveïdor funcional nou, però l'aïllament exigeix recursos propis i pot generar costos de Supabase, hosting, OpenAI i Geoapify que cal autoritzar. Google Maps només és l'enllaç de consulta que ja utilitza l'aplicació. No hi ha geocodificació/rutes noves sense connexió ni garantia d'horaris de transport en viu.

## Proves reproduïbles

```sh
npm ci
npm test
npm run entries:check
npm run build
```

Resultat local: **725 proves passades**, build correcte i paritat exacta d'entrades. S'actualitzen els contractes de versió PWA; la selecció explícita antiga continua disponible quan no hi ha evidència suficient per automatitzar.

Les eines addicionals s'instal·len fora de les dependències del producte:

```sh
npm install --prefix /tmp/freya-v27-tools --no-package-lock --ignore-scripts playwright@1.58.2 @electric-sql/pglite@0.3.14
/tmp/freya-v27-tools/node_modules/.bin/playwright install --with-deps chromium webkit
export PLAYWRIGHT_MODULE=/tmp/freya-v27-tools/node_modules/playwright/index.mjs
node scripts/check-automatic-places-browser.mjs
ROUTE_ENGINE=webkit node scripts/check-automatic-places-browser.mjs
node scripts/check-itinerary-route-browser.mjs
ROUTE_ENGINE=webkit node scripts/check-itinerary-route-browser.mjs
node scripts/check-pwa-bootstrap-browser.mjs
PWA_ENGINE=webkit node scripts/check-pwa-bootstrap-browser.mjs
node scripts/check-itinerary-loading-browser.mjs
node scripts/check-shared-trip-browser.mjs
PGLITE_MODULE=/tmp/freya-v27-tools/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-itinerary-location-db.mjs
```

Les proves de navegador executen el build real a 390 px i les regressions també comproven tablet/identificació d'escriptori, PWA, reconnexió, sessió caducada, canvi de compte/viatge i logout. El test nou recorre transcripció PDF → proposta → revisió → contracte de desament → agenda → enriquiment → rutes, amb transport i persistència simulats. No fa OCR real ni peticions a dades externes. La comprovació de base de dades executa Postgres embegut, la migració base real del planning i la migració nova: camps preservats, RLS, revisions, coordenades invàlides, invalidació de correccions i eliminació. La taula d'activitats del test DB és un contracte mínim per validar el trigger compartit; no reconstrueix tot el backend remot. Les proves no equivalen a un iPhone físic ni a login de producció.

## Prova real des de l'iPhone

Pendent de validar en un iPhone físic i amb els serveis reals de l'entorn autoritzat. No s'ha publicat cap URL nova.

1. Preparar l'entorn aïllat anterior. Servir la còpia de la branca per HTTPS per provar també la instal·lació PWA. Per a una primera comprovació de Safari a la mateixa Wi-Fi, es pot fer `npm run build` i `npm run preview -- --host 0.0.0.0`; obrir `http://IP-DE-L-ORDINADOR:4173/freya-travel/`. La prova de PWA instal·lada requereix HTTPS.
2. Iniciar sessió amb un compte de prova. Crear un viatge de prova a Londres amb una destinació reconeguda London/GB i data 27/12/2026.
3. Importar `scripts/fixtures/v27-london-itinerary.pdf`, revisar la proposta i desar-la. Obrir el dia a l'agenda. British Museum, Tower of London i London Eye han d'obtenir ubicació sense tres confirmacions separades.
4. Comprovar les hores originals 09:00–10:00, 10:05–11:00 i 12:00–13:00. El marge de cinc minuts és deliberat: si el servei retorna un trajecte més llarg, ha d'aparèixer l'avís sense canviar les hores.
5. Obrir les opcions d'un trajecte i l'enllaç al mapa. Provar altres modes; si no hi ha dades, ha de quedar pendent, sense durada inventada.
6. Crear una activitat amb un lloc conegut, i una altra amb un nom desconegut. La primera s'ha de resoldre si hi ha evidència exacta; la segona ha de quedar pendent. En un viatge amb diverses ciutats, comprovar també l'homònim amb ciutats diferents.
7. Corregir manualment un lloc, recarregar i tornar al dia: la correcció s'ha de mantenir. Comprovar també una reserva amb documents vinculats, el retorn des del mapa, tancar/reobrir Safari i, amb HTTPS, la PWA instal·lada. Desconnectar la xarxa: les activitats s'han de conservar i cap ruta nova s'ha d'inventar.

La validació física, els serveis reals i la revisió de la PR precedeixen qualsevol autorització per publicar o fusionar.

## Fitxers de l'entrega

Implementació:

- `index.html`, `404.html` generat i `sw.js`.
- `domain/import-itinerary-text-extractor.mjs`.
- `domain/itinerary-route.mjs` i `domain/itinerary-route-ui.mjs`.
- `supabase/functions/place-resolution/providers/geoapify.mjs`.
- `supabase/functions/itinerary-route/backend.mjs` i `supabase/functions/itinerary-route/provider.mjs`.
- `supabase/migrations/20261016153108_itinerary_resolved_location_v27.sql`.

Proves, CI i documentació:

- `.github/workflows/pr-checks.yml` i `.gitattributes` (PDF binari).
- `scripts/check-automatic-places-browser.mjs` (nou), `scripts/check-itinerary-route-browser.mjs`, `scripts/check-itinerary-loading-browser.mjs`, `scripts/check-pwa-bootstrap-browser.mjs`.
- `scripts/test-itinerary-location-db.mjs` (nou).
- `scripts/itinerary-auto-place.test.mjs`, `scripts/itinerary-route.test.mjs`, `scripts/import-itinerary-pdf.test.mjs`.
- `scripts/itinerary-quick-place.test.mjs`, `scripts/import-itinerary-review-ui.test.mjs`, `scripts/offline-v2-readonly.test.mjs`, `scripts/pwa-diagnostic.test.mjs` (contractes de versió PWA).
- `scripts/fixtures/v27-london-itinerary.pdf` (nou).
- `docs/v27-automatic-locations.md` (aquest document).

La branca ja contenia dos commits previs de v27 sobre `domain/itinerary-quick-place.mjs`; es conserven a la PR. No es versionen artefactes locals de build ni dependències instal·lades per a les proves.

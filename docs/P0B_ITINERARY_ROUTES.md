# P0-B — trajectes de l’agenda (#118)

## Tall i auditoria

Base: `main` `b86970cc` (PR #126). Entrada real `index.html`; `404.html` generat. L’ordre prové de `normalizedItineraryProjection` i del dia de `renderGenericItinerary`. No hi ha una taula nova `trip_itinerary_projection`: és una projecció del frontend sobre vols, allotjaments, activitats i planning manual.

A2.12 ja és a main (PR #122): confirma `location_name`, sense coordenades persistides. Es reutilitzen els textos desats i l’editor existent. La PR #123 no és una dependència. `trip-transfer-estimate` continua intacte: l’estimació geodèsica no es presenta com una ruta.

Consulta remota de només lectura del 14/10: `place-resolution` ACTIVE v1 i `trip-transfer-estimate` ACTIVE v2 al projecte públic. La llista acredita existència/versió, no equivalència byte a byte amb el repositori ni cobertura real de rutes. `itinerary-route` no figurava desplegada. No s’han consultat ni modificat viatges reals.

## Contracte visible

- Parelles consecutives del mateix dia/viatge/ordre visible; cancel·lades excloses. Visites `manual` i `activity`, incloses fixes, opcionals i franges. Vols, allotjaments i transport són barreres: no es calcula un trajecte que els salti.
- En obrir el dia es calcula a peu per defecte. Mode seleccionable: a peu, cotxe, transport públic. La targeta s’insereix entre les visites; cap càrrega de rutes a Home.
- Noms/adreces desats, ciutat i país d’una parada inequívoca. Amb diverses destinacions cal coincidència de ciutat; mai s’utilitza el nom del viatge com a ciutat ni la primera parada arbitràriament. Falten dades → motiu específic.
- Geocodificació en país/ciutat concordants. Nom exacte i únic → resolució per al càlcul; qualsevol dubte → selecció explícita entre candidats revalidats al servidor. Cap coordenada del client és fiable ni es desa una coordenada suggerida. Correcció del text mitjançant el mateix editor de planning/activitat.
- Distància i temps exclusivament de `/v1/routing`, amb geometria i unitats verificades. Font Geoapify/OpenStreetMap, mode i qualitat visibles. Transport públic sempre etiquetat com aproximat, sense horaris en viu ni garantia de servei; sense fallback silenciós a cotxe/a peu.
- Viabilitat només amb instants exactes amb offset, inici/final de la primera visita, inici de la següent, ruta i marge explícit de la persona (inicialment buit; zero només si s’introdueix). Horaris aproximats, franges i final absent donen «Dades insuficients» encara que hi hagi ruta.
- Si `inici següent - final anterior - trajecte < 0`: «No factible». Si és no negatiu però inferior al marge indicat: «Molt ajustat». Si cobreix també el marge: «Factible amb marge estimat». No s’infereixen horaris d’obertura, trànsit ni puntualitat.
- Les preferències de mode/marge són locals i separades per usuari/viatge/dia/parella. Les rutes i seleccions de coordenades són efímeres; en reobrir es recalculen. Offline no mostra una ruta en cache com a estimació actual. Cap canvi automàtic d’horari, lloc, ordre o reserva.

## Seguretat i cost

`itinerary-route` verifica l’usuari a Auth; torna a comprovar accés al viatge abans de reutilitzar cache. PostgREST usa el JWT de qui crida, amb filtres `trip_id` **i** `id`, i les RLS vigents. Lectures mínimes; sense notes, contactes, localitzadors, documents ni dades de pagament. La revisió `updated_at` impedeix resoldre un text que el client ja té obsolet. No usa service-role per llegir viatges. `GEOAPIFY_API_KEY` només al servidor. Respostes HTTP `no-store`; missatges d’error acotats.

Frontend: dos treballs simultanis, màxim 20 peticions noves/minut per context actiu, deduplicació en curs, cache de 5 minuts (inclou identitats, revisions, context i mode), límit de 200 entrades, aturada després de 429/caiguda i reintent explícit. Petició de client amb timeout. Canvi de context invalida resultats tardans; offline/visibilitat refresquen l’estat.

Servidor: deduplicació en curs, cache geocodificació/ruta de 5 minuts, fins a 200 entrades, inici de crides separat 300 ms, 20 peticions/usuari/minut i 2.000 crides de proveïdor/dia **per instància**. Són proteccions locals a l’Edge runtime: **no són una quota global durable**, es reinicien en cold start i no s’agreguen amb `place-resolution` ni entre instàncies. La quota/consum del compte real no s’ha acreditat; revisar-la abans d’activar el servei. No hi ha model/migració nous ni cap garantia fictícia de facturació màxima.

## Proveïdor contrastat (14/10/2026)

La [documentació oficial de rutes](https://apidocs.geoapify.com/docs/routing/) descriu `walk`, `drive`, `transit` i `approximated_transit`; petició amb `apiKey`, waypoints `lat,lon`, resposta GeoJSON, distància en metres i temps en segons. Aquesta entrega demana el mode seleccionat, sense substituir-lo per un altre. La disponibilitat a una ciutat concreta només queda acreditada quan l’API respon amb una ruta vàlida. HTTP 400/404/501 per routing es tracta com a mode indisponible, 429 com a límit i timeout com a servei no disponible.

La [pàgina oficial de preus](https://www.geoapify.com/pricing/) indica 3.000 crèdits/dia i fins a 5 peticions/segon al pla gratuït; les consultes simples solen costar un crèdit. No s’ha verificat que aquest sigui el pla ni la quota restant de Freya. Les proves usen exclusivament un proveïdor simulat, no una clau real.

## Proves i publicació separada

- `node --test scripts/itinerary-route.test.mjs`: domini, HTTP i permisos simulats; modes, ambigüitat, país/ciutat equivocats, dades absents, solapament, poc marge, DST, 429/timeout, cache/quotes, canvi de context i autenticació/RLS via adaptador.
- `node scripts/check-itinerary-route-browser.mjs` després de build, amb `PLAYWRIGHT_MODULE` extern (i `CHROME_PATH` opcional): build real, service worker, pantalla 390 px, context 1024 px tàctil amb identificació d’escriptori, API simulada pel handler real. No és una prova física ni una connexió al backend real.
- `npm test`, `npm run entries:check`, `npm run build`; Deno check de `supabase/functions/itinerary-route/index.ts`. CI de PR inclou tests focals, navegador i comprovació Deno; es conserven les bateries anteriors.
- Sense canvis de model: no cal migració. Les suites RLS descartables existents continuen a CI; el contracte HTTP nou comprova l’aïllament de la petició i la denegació abans de qualsevol crida al proveïdor.

**Aquesta PR no desplega ni fusiona.** Amb autorització separada: verificar pla/quota i `GEOAPIFY_API_KEY` al projecte públic, desplegar només `itinerary-route` amb verificació JWT, comprovar els tres modes amb una parella sintètica i després publicar el frontend. El frontend anterior continua compatible; el nou mostra servei no disponible si la funció encara falta. Cache v18 i paritat generada.

Pendents: resposta Geoapify real per llocs concrets, quota real, Safari/PWA físic a iPhone (suspensió/reobertura i xarxa intermitent) i prova física d’iPad. No s’han reobert notificacions, imports previs ni creació/invitacions de Bolonya.

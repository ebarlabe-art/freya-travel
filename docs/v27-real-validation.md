# V27 — preparació de la validació real

Estat a 16/10/2026: **pendent d'autoritzar recursos; cap URL de v27 amb backend aïllat activa**. PR #147 en esborrany, branca `fix/automatic-itinerary-places-v27`; no fusionar ni publicar a main. Cap migració, dada remota, secret ni desplegament modificats en aquesta revisió.

## Evidència de CI i revisió

CI inicial del head `92dc78221c59791c4f12e47ccbe7e5014d000b8f`: [run 38927497306](https://github.com/ebarlabe-art/freya-travel/actions/runs/38927497306).

| Job | Resultat inicial | Abast |
| --- | --- | --- |
| a2-test-build | PASS | Build, PDF/llocs/rutes, Chromium, WebKit, PWA, permisos/migració Postgres embegut, viatges compartits |
| legacy-suite | PASS | Suite completa; job informatiu amb `continue-on-error` |
| shared-trip-contracts | PASS | Membres, invitacions, RLS i concurrència sobre Postgres local |
| alb03-contracts | PASS | Contractes, imatges, Deno i Postgres |
| alb02-contracts | FAIL infraestructura | 46 contractes JS PASS; descàrrega d'imatge ECR rebutjada quatre vegades per `toomanyrequests: Data limit exceeded`. DB i paritat posteriors no executades |

Correcció a la mateixa branca: `ci-postgres.sh` prova també `docker.io/supabase/postgres:17.6.1.165` quan falla el registre ECR predeterminat. Mateix editor i versió; no es substitueix per Postgres genèric ni se salten comprovacions. Una imatge explícita del caller no té fallback silenciós. Test local simula quota, selecció del mirror i fallada tancada; la nova CI ha de validar el contenidor real. La disponibilitat del tag del publisher s'ha comprovat al registre Docker Hub.

La revisió dels contractes v27 confirma migració additiva sense backfill, invalidació del snapshot en corregir el lloc, i lectures de rutes amb JWT d'usuari i filtre de viatge. Això no acredita encara compatibilitat amb la baseline remota, OCR real, resposta real de Geoapify ni iPhone físic.

Verificació local d'aquesta preparació: `npm run prebuild`, `npm test` (**728 PASS**), `npm run entries:check`, `npm run build` i build de validació amb configuració fictícia correctes. Els tres contractes nous cobreixen rebuig de configuracions protegides/privilegiades, transformació i restricció de xarxa, i fallback de registre sense alterar overrides. No s'ha executat aquí un contenidor Postgres real; el resultat de la nova CI és l'evidència necessària per tancar ALB-02.

## Inventari remot observat, només lectura

| Recurs | Estat observat | Decisió |
| --- | --- | --- |
| Supabase `otueskpksylzvkhldoft` / Londres-2026 | ACTIVE_HEALTHY; endpoint fixat a l'entrada pública | Protegit; no usar ni migrar |
| Supabase `waatqrqyddurultrazbn` / Freya Travel PROVES | ACTIVE_HEALTHY | Protegit per instrucció de l'usuari; no reutilitzar |
| Branques Supabase dels dos projectes | Llistes buides | No s'ha descobert cap backend alternatiu |
| Railway `freya-travel-offline-v2-preview`, entorn `preview` | Servei `freya-offline-v2-iphone-preview`, desplegament SUCCESS `afbb8636-3bbd-46ae-8acc-b37f56e99e85`, pin `fd465144f1df3406f9f8ae3cfb1a6a7ba1b12354`, altra branca | No substituir: no és un entorn completament aïllat |
| Railway `freya-travel-derivatives` | Servei `travel-book-derivatives`, entorn production | Worker protegit; exclòs de validació |

La URL existent `https://freya-offline-v2-iphone-preview-preview.up.railway.app` **no és la URL de validació v27**. Un GET de l'HTML ha confirmat `otueskpksylzvkhldoft` i el worker de producció. Les cinc variables del servei inclouen `FREYA_BACKEND_ENV` i `FREYA_STAGING_SUPABASE_*`, però el build/HTML no les aplica. Noms de variables i estat SUCCESS no demostren aïllament. No s'ha iniciat sessió ni carregat cap viatge en aquesta URL.

No s'ha identificat un recurs remot separat amb nom Freya Nova ni autorització per alterar-lo. La connexió de les eines permet inventariar recursos, però això no autoritza crear-los ni reutilitzar-los contra la instrucció de l'usuari.

## Pla concret després de l'autorització

1. Crear **un projecte Supabase independent** `freya-v27-validation`, preferiblement a `eu-central-1`. Cal confirmar organització i cost abans de crear-lo. Organització accessible dels projectes observats: `yhzulltddpihkjyzxkcd`; pendent de selecció expressa de l'usuari. No restaurar dades, usuaris, objectes, secrets, Vault, cron ni webhooks de producció.
2. Preparar una baseline només d'esquema revisada: taules `trips`, membres i permisos de viatge, `trip_stops`, `trip_itinerary_items`, `trip_activities`, `travel_documents`; RPCs invocats per creació/importació i resolució de llocs. Revisar funcions, triggers, grants, índexs, Realtime necessari i dependències `place_private`/`proposal_private`. L'historial del repositori **no reconstrueix tot el backend històric**; les baselines locals són contractes de test i no acrediten desplegabilitat completa. Si cal extreure DDL remot, només lectura d'esquema, amb revisió d'URLs/secrets i sense exportar files.
3. No fer `db push` indiscriminat: `20260901144811_schedule_itinerary_notifications.sql` inclou un endpoint de producció. Excloure tots els jobs de notificació, callbacks, extensions amb automatismes i webhooks del provisionament. No activar correus/push programats. Cap credencial externa copiada de producció.
4. Sobre la baseline buida, aplicar les dependències revisades i després `20261016153108_itinerary_resolved_location_v27.sql`. Verificar les dues columnes, triggers, RLS/grants, lectura i escriptura de propietari/membre, denegació d'un compte extern, revisions concurrents i eliminació. Comptar zero viatges abans de crear fixtures. Consultar advisors de seguretat abans d'obrir l'accés.
5. Crear bucket privat `trip-documents` i les polítiques de pertinença al viatge; validar pujada/lectura/eliminació i denegació entre viatges. No copiar documents reals previs. Dos comptes de validació amb identitats pròpies i sense sessions de producció.
6. Desplegar al **nou project ref explícit** `place-resolution`, `itinerary-route` i `import-itinerary`, amb imports locals i fitxers Deno de la mateixa revisió; afegir `import-reservation` si s'exercita la importació de reserves. Conservar la verificació JWT configurada i provar 401/403 sense sessió i amb un altre usuari. Comprovar compatibilitat de signing keys/JWT de l'entorn nou; no desactivar verificació per fer passar la prova.
7. Secrets exclusius de validació: `GEOAPIFY_API_KEY` (geocodificació i Routing, quota/límit de despesa), `OPENAI_API_KEY` i `A2_IMPORT_MODEL` (o `TB04_CANDIDATE_MODEL` com a fallback existent). La funció PDF envia el document a OpenAI Responses amb `store:false`, màxim 10 MiB i 5.000 tokens de sortida per intent; pot repetir la lectura per recuperar dates. Autoritzar aquest consum i l'enviament del segon itinerari. Els secrets Supabase injectats han de pertànyer al projecte nou; `place-resolution` usa service role només al servidor per cache/quota, mentre importació i rutes consulten dades amb JWT/RLS de l'usuari. No cal worker de fotografies per provar PDF/llocs/rutes.
8. Crear servei de hosting exclusiu `freya-v27-validation` amb HTTPS i pressupost aprovat. No tocar els dos projectes Railway existents. Desplegar només l'artefacte validat de la branca/SHA aprovada, sense seguiment de main ni auto-deploy de previews alienes. Configurar Auth Site URL i redirects exactes `https://<host-validacio>/freya-travel/`; no reutilitzar callbacks de producció. Registrar els IDs definitius al present document.
9. Smoke test de login, Auth, Storage, PDF, Geoapify i RLS; revisar al navegador que totes les peticions de dades van al nou ref. Obrir HTTPS en Safari real, instal·lar PWA i completar els dos casos següents. Només llavors comunicar la URL com a apta per validar.

## Build de validació preparat

Després de `npm ci`, configurar **al build privat**:

```text
FREYA_VALIDATION_PROJECT_REF=<nou-ref-aprovat>
FREYA_VALIDATION_SUPABASE_URL=https://<nou-ref-aprovat>.supabase.co
FREYA_VALIDATION_PUBLISHABLE_KEY=<publishable-key-del-projecte-nou>
```

Executar `node scripts/build-v27-validation.mjs`. No posar secrets de servidor en aquestes variables. El script rebutja els dos refs protegits, URLs diferents del ref, absència de configuració, claus secretes/JWT i reutilització de la clau pública actual. Treballa en còpia temporal, genera 404 amb el mecanisme existent i executa el build normal. Escaneja tots els bytes de `dist` per detectar els refs/clau pública protegits, altres projectes Supabase i claus secretes; elimina tota la còpia si falla. No desplega ni contacta els serveis de dades.

La sortida indica un directori temporal `…/site`; publicar **aquest directori** com a arrel estàtica. L'app hi queda a `/freya-travel/` i preserva registre/abast del service worker i les entrades històriques. `validation.json` identifica release i project ref, sense claus. El CSP de la còpia només permet connexions a mateix origen i al nou Supabase HTTPS/WSS. La còpia bloqueja explícitament el worker de derivats de producció; les fotos/àlbum queden fora d'aquesta prova. L'HTML públic del repositori no es modifica.

La CI genera també aquest artefacte amb credencials **fictícies** per verificar el packaging i l'aïllament; no és un backend funcional ni una URL publicada. El ref i la publishable key reals s'han de comprovar contra el dashboard nou abans de desplegar: el format d'una clau opaca no acredita a quin projecte pertany.

## Proves preparades per a l'iPhone

### A. PDF de Londres inclòs

Fitxer: [`scripts/fixtures/v27-london-itinerary.pdf`](../scripts/fixtures/v27-london-itinerary.pdf). En un viatge nou de validació, destinació London/GB, dia 27/12/2026: pujar el PDF des de Fitxers, generar proposta, comparar amb l'original i confirmar el desament. Abans de confirmar no hi ha escriptures d'itinerari. Després han d'aparèixer British Museum 09:00–10:00, Tower of London 10:05–11:00 i London Eye 12:00–13:00 amb ubicacions exactes sense tres confirmacions addicionals. Si Geoapify no aporta evidència suficient, registrar el resultat pendent; no forçar-lo per donar la prova per bona.

Comprovar avís pel marge de cinc minuts entre les dues primeres activitats si el trajecte real el supera; cap canvi d'hores/dates. Provar peu/cotxe/transport públic, retorn del mapa, lloc desconegut/homònim pendent, activitat manual i reservada, correcció manual persistent després de recàrrega. Desconnectar: dades preparades accessibles segons el contracte offline i cap ruta nova inventada. Reobrir Safari i PWA instal·lada, suspensió, reconnectar i logout/canvi de compte sense barreja de dades.

### B. Itinerari real de l'usuari

Pendent que l'usuari seleccioni el document dins de l'app de validació. Fer servir un altre viatge buit, amb ciutats/països i dates reals, sense sincronització ni importació des de producció. Eliminar dades personals no necessàries abans de pujar-lo. Comparar nombre d'activitats per dia, noms compostos, dates, hores, trajectes i documents amb l'original; revisar la proposta i desar una sola vegada. Els casos amb diverses ciutats, noms ambigus, adreces o errors del proveïdor han de quedar revisables, sense geografia inventada ni pèrdua de planning. Verificar persistència després de tancar/reobrir i denegació amb un compte que no pertanyi al viatge.

Per als dos casos, anotar: SHA del frontend, ref/backend i versions de funcions/migració, model, iPhone/iOS, Safari o standalone, data/hora, esperat/observat, resultat i captura sense tokens/codis personals. No marcar PASS amb mocks ni donar per fet que WebKit equival a un iPhone físic.

## Autoritzacions i configuracions pendents

- Confirmar organització Supabase i autoritzar crear projecte exclusiu, baseline només d'esquema, migració v27, bucket, comptes i Edge Functions. Aprovar el cost que es cotitzi abans de crear recursos.
- Autoritzar hosting HTTPS separat, compte/workspace i pressupost. La preview existent queda exclosa per connexió a producció; no substituir Nova, PROVES ni l'app pública.
- Proporcionar mitjançant secrets del nou entorn claus de Geoapify/OpenAI exclusives o autorització expressa d'un ús de validació separat, model habilitat i quotes. No enganxar secrets a GitHub, documentació ni xat.
- Configurar URL definitiva, callbacks d'Auth, comptes de prova i nou ref/publishable key del frontend; verificar aïllament i completar CI abans de desplegar.
- Seleccionar el segon itinerari i completar la prova física de Safari/PWA. La fixture Londres ja està al repositori.

No s'ha demanat permís per modificar producció; cap d'aquests passos ho necessita. La petició de confirmació per crear recursos i desplegar deriva de la instrucció explícita de l'usuari d'aquesta fase.

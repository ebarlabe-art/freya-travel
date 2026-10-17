# V27 — verificació tècnica final abans de contractar

**Resultat: PASS. La baseline i el frontend de validació queden tècnicament verificats; podem passar a l'autorització de Supabase Pro.** Aquesta conclusió no autoritza contractar, crear projectes ni desplegar res.

Data: 17/10/2026. Branca: `fix/automatic-itinerary-places-v27`. Codi verificat: `c68352d82685f3deb2916b77083eaa5340f000de`. V27 funcional de partida: `7b83cb8edcdf8e0d65cb2e762be96e50ceaf0916`.

Evidència principal: [V27 complete isolated baseline — SUCCESS](https://github.com/ebarlabe-art/freya-travel/actions/runs/39032720416), job `117396880491`. Evidència complementària: [PR checks — SUCCESS, cinc jobs](https://github.com/ebarlabe-art/freya-travel/actions/runs/39032722155). Els commits posteriors d'aquest informe només afegeixen documentació/evidències; no canvien el codi verificat.

## Entorn i cost

Docker local del workspace continua bloquejat: socket `/var/run/docker.sock`, `operation not permitted`; usuari UID 1000. El proxy del shell tampoc connecta. S'ha utilitzat l'alternativa autoritzada: runner GitHub-hosted **estàndard `ubuntu-latest`**, repositori públic, Supabase CLI **2.121.0**, Docker del runner, Node 22 i Deno **2.9.6**.

El workflow es limita a aquesta branca i rebutja l'execució si el repositori és privat. No usa runners grans, artifacts persistents, caches d'Actions, secrets de producció, credencials de Supabase remot ni APIs de facturació. Les variables del build són fictícies. La suite existent de la branca també s'ha canviat a valors ficticis i sense cache d'Actions. [GitHub documenta l'ús gratuït dels runners estàndard en repositoris públics i que els logs no compten com a artifact storage](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Cap subscripció, recurs de pagament, projecte Supabase remot, hosting ni desplegament creat. Cap modificació de main, Freya pública, Nova o Proves. PR #147 oberta, **draft i sense fusionar**. No s'han copiat usuaris, viatges, documents, objectes ni secrets de producció: només la captura prèvia de metadades i fixtures sintètiques.

## Matriu executada

| Prova | Resultat | Evidència concreta |
|---|---|---|
| Supabase local complet al runner, amb Docker i CLI | PASS | Arrencada de la plataforma, inclosos Auth, REST i Storage |
| Restauració buida 01–03 | PASS, dues vegades | 4 esquemes d'aplicació, **62 taules**, **688 columnes**, **116 funcions**, **535 constraints**, **185 índexs**, **48 triggers**, **103 polítiques** |
| Fidelitat de catàleg | PASS, dues vegades | Comparació normalitzada de taules/columnes/defaults, constraints, índexs, funcions, triggers, RLS i publicació contra la captura només d'esquema |
| Dependències de totes les funcions | PASS, dues vegades | Les 116 definicions recompilades amb `check_function_bodies=true` després de crear taules i tipus compostos |
| Permisos | PASS, dues vegades | Grants de taules i funcions per rols API/PUBLIC; USAGE dels esquemes segons origen; cap CREATE d'esquema per clients |
| Storage i Realtime | PASS, dues vegades | 3 buckets privats amb límits/MIME; polítiques; 14 taules publicades; 11 amb REPLICA IDENTITY FULL |
| Migració v27 | PASS, dues vegades | `04-v27.sql` és byte a byte la migració original; estat final: 62 taules, 690 columnes, **117 funcions i 50 triggers** |
| Base inicial sense dades | PASS | Assercions de zero viatges, membres, documents, usuaris i objectes abans de fixtures; verificat també després de destruir i reconstruir |
| Auth real local | PASS | Tres comptes sintètics confirmats i login amb contrasenya; claus només del stack local |
| Creació i compartició | PASS | RPC create/join reals, destinació i checklist; propietari/membre autoritzats, extern i anon sense accés |
| Integritat v27 i concurrència | PASS | Geografia vàlida acceptada, coordenada invàlida denegada, horaris preservats, correcció manual invalida snapshot; dos canvis amb la mateixa revisió: només un s'aplica |
| Documents i RLS | PASS | Extern no llegeix ni modifica itinerari/documents ni insereix plans al viatge aliè |
| Storage real via HTTP local | PASS | PDF sintètic pujat, lectura propietari/membre amb hash idèntic, extern denegat, substitució i eliminació; metadades protegides per RLS |
| Enduriment de validació | PASS, dues vegades | `06-validation-permissions.sql` retira TRUNCATE/REFERENCES/TRIGGER als clients; assercions de permisos efectius; CRUD i RPCs continuen passant després de revocar-los |
| Quatre còpies Edge | PASS | Deno check de place-resolution, itinerary-route, import-itinerary i import-reservation, amb wrapper Auth i dependències locals completes |
| Suite JS completa | PASS | **728 tests, 0 fallades**, sense relaxar ni eliminar tests |
| Build complet aïllat | PASS | npm ci, prebuild, TypeScript, Vite i packaging real; **51 fitxers** escanejats; paritat index/404; ref fictici únic; sense refs protegits ni worker de producció; CSP de connexions a l'entrada |
| Regressions habituals de PR | PASS | a2-test-build (inclou Chromium/WebKit), legacy-suite, shared-trip-contracts, alb02-contracts i alb03-contracts |
| Baixa del stack de proves | PASS | Destrucció sense backup/volums, segona arrencada realment buida i neteja final del stack/fitxer de claus; runner efímer retirat en acabar |

Els esquemes de plataforma Auth/Storage els inicialitza Supabase local; no s'han importat des de producció. Els 535 constraints de la captura inclouen tres constraint triggers. Les dades de prova són noves, amb adreces `example.test` i PDF sintètic.

## Incidències trobades i resoltes

| Incidència observada | Correcció | Revalidació |
|---|---|---|
| Context `runner.temp` no admès a env del job | Workdir inicialitzat en un step amb GITHUB_ENV | Workflow i runner PASS |
| Còpia Edge incompleta: imports de domini absents | Afegits els tres mòduls reals de domini al paquet de validació | Deno check PASS de les quatre funcions |
| Signatures TypeScript implícites del lector env i callbacks | JSDoc/tipus explícits, sense desactivar strict ni afeblir comprovacions | Deno check i suite PASS |
| Target de reserva indexat sense comprovació de propietat pròpia | Validació de tipus i Object.hasOwn; eliminat log de cos d'error del proveïdor, que podia repetir contingut privat | Deno check PASS; error genèric preservat |
| Bootstrap creava funcions abans dels tipus compostos de les taules | Crear primer les 62 taules buides per registrar tipus; després funcions, columnes/defaults/generades, constraints i triggers | Dues reconstruccions completes i recompilació estricta de les 116 funcions PASS |
| Comparació de DDL dependent del search_path de la sessió | Mateix context public/extensions/pg_catalog que a la captura, sense ignorar objectes ni permisos | Tots els catàlegs PASS |
| ACL històrics incloïen permisos de taula aliens al frontend | Fidelitat comprovada primer; enduriment separat i obligatori només al projecte de validació | Permisos efectius i fluxos reals després de revocar-los PASS |
| Cleanup podia fallar abans d'haver inicialitzat el stack | Només aturar si existeix el config local del projecte efímer | Cleanup final PASS |

No s'ha modificat cap migració històrica ni desplegat cap correcció sobre un entorn existent. Les correccions de funcions són a les **còpies de validació**, no a funcions remotes.

## Paquet que s'ha d'utilitzar

El SQL anterior del paquet inicial era candidat: no reutilitzar-ne el vell `generate.py` per sobreescriure aquests fitxers corregits. La font operativa és ara el directori versionat `validation/v27/` del commit verificat, amb hashes al manifest del paquet actualitzat.

Ordre obligatori per a una base nova: **01-baseline → 02-storage → 03-realtime → 04-v27 → 05-assert-empty-and-secured → 06-validation-permissions**. La comparació exacta contra origen es fa després de 03; el delta v27 i la reducció de privilegis es comproven després. No executar la cadena de migracions històriques damunt d'aquesta baseline ni importar l'historial de producció.

Per reproduir: checkout complet del SHA verificat (incloent binaris i lockfile), dependències instal·lades amb npm ci i la mateixa configuració del workflow. El ZIP és el paquet de verificació/overlay, no un frontend desplegable ni un substitut del checkout complet. Els scripts només apunten a PostgreSQL/HTTP localhost i el segon replay només pot aturar el projecte dins del directori efímer del runner.

La futura publicació necessita reconstruir l'artefacte amb el **nou ref i la seva publishable key**, tornar-lo a escanejar i aplicar els headers/redirects de Cloudflare previstos. El build amb claus fictícies no s'ha de publicar com a prova funcional.

## Límits que continuen pendents

| Prova o acció | Estat i bloqueig exacte |
|---|---|
| Supabase Pro independent i Pages real | NO EXECUTAT: encara no autoritzat ni creat. Cal organització nova, projecte nou, Auth/redirects/origen exactes i secrets de validació |
| OCR/OpenAI i geocodificació/routing amb proveïdors reals | NO EXECUTAT: cap clau nova de validació ni consum facturable autoritzat. Els tests de proveïdors són contractes/mocks; Storage sí que s'ha exercitat realment en local |
| Execució Edge amb proveïdors i signing keys del projecte nou | NO EXECUTAT: aquest projecte encara no existeix. S'han comprovat empaquetatge i tipus; cal smoke 401/403 i amb sessió nova després de crear-lo |
| Safari/PWA a iPhone físic i segon PDF real | NO EXECUTAT: cal URL HTTPS funcional i l'iPhone/document seleccionat per l'usuari. Chromium/WebKit no substitueixen la prova física |
| Totes les branques de negoci de les 116 funcions | No es reclama cobertura exhaustiva. S'han recompilat totes, contrastat esquema/ACL i exercitat el circuit de validació i les suites existents |

**No queda cap bloqueig de restauració, build o seguretat local per a aquesta preparació. Ja podem passar a l'autorització de Supabase Pro**, mantenint separats el consentiment de despesa, el provisionament i les proves reals posteriors. No s'ha fet cap d'aquestes accions anticipadament.

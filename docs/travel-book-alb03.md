# ALB-03 — Fonts, originals i derivats editorials

Implementació local sobre `origin/main` `6177cc62fc0891f76458179c974ce6a881463a73`, revisada abans de commit per preservar originals i admetre formats mòbils. Complementa [ALB-01](travel-book-alb01.md) i [ALB-02](travel-book-alb02.md), sense modificar els seus fitxers, migracions, composicions, CAS ni revisions.

## 1. Abast i model

La font operativa, el snapshot immutable, l'asset versionat i l'ús en composicions són entitats diferents. Els recursos són del llibre, reutilitzables entre les seves edicions, mai compartits directament entre llibres. Només viatges genèrics actius amb membres autoritzats. Londres continua separat.

Cada asset incorpora tres variants:

| Variant | Funció i immutabilitat |
|---|---|
| `original` | Còpia **byte-for-byte** del fitxer admès, format original, SHA-256 propi, MIME, extensió canònica, mida, dimensions intrínseques i orientació coneguda. Immutable des del primer registre verificat, també mentre l'asset està pending. |
| `preview` | PNG visual orientat, costat màxim 1600 px, sense ampliar imatges petites. Hash i dimensions propis. |
| `thumbnail` | PNG orientat, costat màxim 320 px, sense ampliar. Hash i dimensions propis. |

No es genera `working_master`. Cap derivat substitueix l'original. L'UUID històric del document, token de font, llibre, `asset_key` i versió preserven procedència. JPEG/JPG es normalitza només **en el nom d'extensió** a `.jpg`, no en els bytes. La declaració MIME del document es filtra; el MIME canònic es deriva de la capçalera real.

ALB-02 només admet MIME web al seu descriptor d'asset. Es manté aquest contracte: el descriptor visual d'`travel_book_assets` referencia la preview; la variant `original` és la referència autoritativa del fitxer font, inclòs HEIC/HEIF. No s'amplia l'enum MIME ni el model d'estats d'ALB-02. El futur consumidor ha d'usar preview/thumbnail per renderitzar i `original` per recuperar el màster font. Les revisions ALB-02 continuen fixant el descriptor visual; l'original immutable es resol pel mateix asset/version. No s'enriqueixen revisions antigues retroactivament.

## 2. Migració i taules

`20261004234233_travel_book_ingestion_v1.sql` encara no està publicada ni desplegada: s'ha ajustat aquesta mateixa migració ALB-03, sense tocar cap migració històrica. Requereix ALB-02, fonts operatives, helpers i baseline real de Storage.

Crea:

- `app_private.alb03_ingestions`: font/path/token històrics, asset/snapshot, lease, intents, error, hash original i orientació.
- `app_private.alb03_requests`: rebuts immutables per actor/operation UUID, petició exacta i resultat.
- `public.travel_book_asset_variants`: original/preview/thumbnail, `pipeline_version`, hash, MIME, extensió, bytes, dimensions, orientació i descriptor Storage.

FK compostos imposen trip/llibre/asset coherents i `RESTRICT`. El trigger immutable protegeix totes les variants des de la inserció, no només després de ready. El FK viu d'ALB-02 pot quedar NULL en eliminar el document, preservant l'UUID històric, originals, derivats, snapshots i revisions. No es modifiquen files operatives en la migració.

## 3. Formats mòbils i HEIC/HEIF

No hi ha discriminació per iPhone/Android. S'admeten originals JPEG/JPG, PNG, WebP i HEIC/HEIF estàtics. PNG animat, WebP animat, seqüències HEIF, AVIF i formats no admesos es rebutgen. RAW, ProRAW i DNG continuen fora d'abast.

HEIC/HEIF es preserva sense descodificar píxels: s'inspecciona el contenidor ISO-BMFF amb límits de mida/nombre de boxes, es resol l'item primari (`pitm` + `ipma`) i la seva propietat `ispe`. No es pren arbitràriament la primera dimensió, que podria ser una miniatura. Les dimensions són les intrínseques del primari; crop, rotació/mirroring i EXIF originals es mantenen dins els bytes. Orientació `0` significa encara no interpretada (HEIF); no s'inventa una orientació EXIF. Una capçalera que no permet identificar dimensions segures es rebutja amb error explícit.

**Suport HEIC/HEIF actual: original preservat, derivats pendents.** El WASM fixat anuncia lectura HEIC/HEIF i descodifica la fixture real en local (10 bits). Això no acredita interpretació HDR/nclx/ICC, transformacions d'item ni CPU/memòria al runtime allotjat. No s'activa aquesta conversió sense qualificar-la: retorna `DERIVATIVE_UNSUPPORTED`, HTTP 202, asset no-ready i original accessible al membre. Reintentar no duplica ni perd l'original, encara que desaparegui la galeria.

Boundary tècnic immediat pendent: un processador qualificat ha de llegir **l'original editorial** amb descriptor/hash fixos, obtenir lease a través del boundary de servei, interpretar HEIF/ICC/nclx/crop/orientació, generar els PNG i tornar a verificar-los abans de `alb03_finish_v1`. Ha d'usar els mateixos paths i descriptors immutables; un intent no pot substituir variants diferents. Pot ser el WASM actual si supera qualificació, o un worker amb pressupost de CPU/memòria superior. No s'ha escollit ni desplegat cap proveïdor ni implementat un worker remot alternatiu.

## 4. Límits de preservació i de conversió

| Frontera | Límit implementat |
|---|---|
| Fitxer original | 32 MiB |
| Dimensions originals | Màxim 32.768 px per costat i 200.000.000 píxels totals |
| Conversió JPEG a Edge | Fins a 12.500.000 píxels; JPEG scaled IDCT `2048x2048` abans del resize |
| Conversió PNG/WebP a Edge | Fins a 4.000.000 píxels |
| Conversió HEIC/HEIF | Pendent de qualificació; l'original sí que es preserva |
| Preview / thumbnail | Màxim 1600 / 320 px per costat, PNG |

El límit de preservació cobreix fotografies ordinàries de 12/24/48 MP i fins a 200 MP quan el fitxer no supera 32 MiB. Superar el pressupost de conversió **no rebutja ni elimina l'original**: `DERIVATIVE_CAPACITY` i derivat pendent. No es promet que qualsevol foto de mòbil sigui immediatament editable: 24/48 MP, PNG/WebP grans i HEIC necessiten el boundary de conversió pendent. El límit de 32 MiB evita múltiples buffers de fitxers enormes en una petició i limita el cost per original; no és una quota acumulada per llibre. Política de quotes/retenció/purga encara pendent.

[Supabase documenta](https://supabase.com/docs/guides/functions/limits) 256 MB i 2 s de CPU per petició. Els límits de conversió són conservadors i separats de l'admissió del fitxer. Abans de cap descompressió es validen mida/dimensions; WASM té límit de memòria de píxels 128 MiB, disc 0 i perfils 4 MiB. Un isolate processa una petició alhora; cada asset té lease exclusiu. El lector HTTP limita bytes en streaming, i les operacions de xarxa tenen timeout. El còdec es carrega dinàmicament després de registrar l'original, no durant la preservació HEIC/imatges grans.

Mesura local orientativa amb JPEG sintètic 4032×3024: la descodificació completa arribava a 2,64 s CPU en el primer processament; amb scaled IDCT, 1,71 s al primer i 0,82 s al següent. El RSS del procés de prova, inclosa la generació de la fixture, rondava 242 MB. **Això no és una validació del runtime allotjat ni un marge garantit**, especialment en cold start i amb imatges complexes. La qualificació integrada de CPU, memòria, bundle i color és una porta prèvia al desplegament. Una terminació del worker conserva l'original registrat i el lease caduca; no marca ready.

## 5. Color, EXIF i orientació

L'original conserva absolutament tots els bytes, ICC, EXIF i metadades, inclòs contingut potencialment sensible: queda privat i no s'afegeix als snapshots de producte.

Els derivats apliquen orientació abans de redimensionar i registren orientació normalitzada `1`. Conserven el perfil ICC/ICM i la interpretació cromàtica PNG; no es fa `strip()` indiscriminat ni una conversió CMYK/print. Es retiren els altres perfils i atributs descriptius (EXIF/GPS/comentaris). La prova comprova que el perfil ICC sobreviu i que desapareix el comentari privat. No s'eliminen tots els chunks textuals PNG perquè això també podia fer desaparèixer el perfil amb el còdec actual. Els chunks temporals s'exclouen per estabilitat.

El pipeline visual actual és RGB/sRGB/Gray i el còdec és Q8; són derivats de visualització, no màsters d'arxiu ni garanties de fidelitat HDR/impressió. Espais no acceptats retornen `DERIVATIVE_COLOR`, preservant l'original. La conversió de HEIF d'alta profunditat/HDR no s'activa silenciosament. La qualificació futura ha de comprovar ICC/nclx/gamma i fixtures representatives de dispositius, no només que s'obtenen píxels.

## 6. Storage i permisos

Bucket privat `travel-book`, màxim 32 MiB per objecte; MIME JPEG, PNG, WebP, HEIC i HEIF. Paths:

```text
<trip>/<book>/<asset_key>/<version>/v1/original.<jpg|png|webp|heic|heif>
<trip>/<book>/<asset_key>/<version>/v1/preview.png
<trip>/<book>/<asset_key>/<version>/v1/thumbnail.png
```

Uploads insert-only (`upsert=false`), seguits de read-back i SHA-256. Si el path existeix, només s'accepta si els bytes coincideixen. Sense col·lisions entre llibres/versions ni signed URLs persistents. Les signatures temporals futures no seran identitat i no es revocaran retroactivament només per eliminar un membre.

RLS activa a les tres taules. SELECT de variants per `is_trip_member`; cap DML directe client ni service_role a les noves taules. Les dues taules privades només són accessibles via RPC. A Storage, l'original registrat es pot llegir pel membre encara que els derivats estiguin pending; els derivats només quan l'asset és ready. Cap policy nova de mutació client. Els objectes parcials no registrats no són accessibles per aquesta policy.

Abans de desplegar cal contrastar les policies Storage reals preexistents, perquè les permissives se sumen amb OR, el límit global de Storage i que `app_private` continuï no exposat. Aquesta tasca no canvia la configuració remota ni garanteix que la UI històrica de Fotos admeti totes aquestes entrades: ALB-03 consumeix fonts que ja existeixen a `travel_documents`.

## 7. API i frontera física

Cinc RPC públiques amb wrappers `SECURITY INVOKER` i implementació privada amb `search_path = ''`:

| RPC | Accés | Funció |
|---|---|---|
| `request_travel_book_photo_v1` | authenticated | Valida font/llibre i crea o reutilitza asset, snapshot i ingesta. |
| `capture_travel_book_context_v1` | authenticated | Snapshot filtrat a partir de fonts reals. |
| `get_travel_book_ingestion_v1` | authenticated | Asset, variants, intents, error, lease, `original_preserved` i `processing_state`. |
| `alb03_claim_v1` | service_role | Revalida membre/viatge i obté lease exclusiu. |
| `alb03_finish_v1` | service_role | Registra original o finalitza original + preview + thumbnail, de forma atòmica i fenced. |

`POST /functions/v1/travel-book-ingest` amb JWT i body exclusiu `{"asset_id":"UUID"}`, màxim 4096 bytes. Auth `/user` determina actor; mai s'accepta actor/path/URL del client. La descàrrega de la galeria usa JWT d'usuari; l'original editorial es llegeix des del servei després del claim autoritzat. La service key no surt del servidor.

`alb03_finish_v1` accepta `{original}` per fer durable l'original **abans del còdec**, mantenint el lease. `{original,preview,thumbnail}` verifica descriptors i fixa ready atòmicament, alliberant lease. `{original,preview}` es rebutja. Els descriptors tenen hash, width, height, path, MIME, ext, byte_size i orientation, amb camps estrictes i límits SQL. El servei és responsable del read-back físic; SQL no afirma haver llegit Storage.

HTTP 200 ready; 202 derivat pendent; 422 error de processament; 401/403 autenticació/autorització; 409 conflicte de lease; 429 isolate ocupat; 503 indisponibilitat. No hi ha scheduler ni cua remota desplegada. El consumidor futur haurà de reintentar o activar el worker de conversió pendent.

## 8. Estats, idempotència i errors

Es conserven `pending / ready / missing` d'ALB-02. La consulta ALB-03 afegeix `processing_state`: `pending`, `derivative_pending`, `recoverable_error`, `ready` o `missing`. `original_preserved` indica que existeix el descriptor immutable registrat després de read-back, no un sondeig en viu de Storage.

Original copiat amb derivat pendent: asset pending, variant original registrada, `processing_state=derivative_pending`. No hi ha ready fins que els dos derivats i l'original estan verificats. Un error després d'haver estat ready passa a missing conservant descriptors; es pot tornar a ready només amb els mateixos bytes/descriptors. No es força la transició missing→pending que ALB-02 prohibeix.

Errors persistents: `SOURCE_MISSING`, `SOURCE_CHANGED`, `INVALID_IMAGE`, `LIMIT_EXCEEDED`, `STORAGE_ERROR`, `MASTER_MISSING`, `DERIVATIVE_UNSUPPORTED`, `DERIVATIVE_CAPACITY`, `DERIVATIVE_COLOR`, `DERIVATIVE_FAILED`. No es desen errors crus del proveïdor.

Rebut persistent per actor/operation UUID: petició idèntica retorna els mateixos IDs; UUID reutilitzat amb dades diferents falla. Es revalida pertinença fins i tot per retornar un rebut antic. Mateix llibre/document/token de Storage reutilitza asset. Token = hash d'object ID, updated_at i path; un canvi de font crea nova versió de la mateixa família. No hi ha deduplicació global per contingut: reescriure bytes iguals amb token nou pot generar versió nova.

L'original immutable mai es reemplaça: hash diferent requereix una nova versió. Reprocessar derivats no modifica l'original. Si la galeria desapareix després del registre, el retry llegeix la còpia editorial. Restaurar una còpia editorial absent exigeix el mateix hash font; un objecte corrupte existent no se sobreescriu. Objectes parcials orfes es conserven privats; no hi ha purga automàtica.

Lease de dos minuts amb UUID renovat i bloqueig de fila, rebut/font serialitzats amb advisory locks. Claim i finish tornen a verificar viatge actiu/membre; un lease antic o actor revocat no poden finalitzar. No es mantenen transaccions obertes durant I/O. No hi ha atomicitat distribuïda Storage/Postgres: una caiguda abans del registre pot deixar un objecte privat orfe; després del registre, la còpia és recuperable sense galeria.

## 9. Adapters i snapshots

| Font | Camps llegits | Camps de snapshot possibles |
|---|---|---|
| trip | `trips.name`, `start_date` | label, local_date |
| photo | `travel_documents.title`, `trip_photo_metadata.local_date` | label, local_date |
| activity | `trip_activities.title`, `venue_name`, `start_at` + `time_zone` | label, place_label, local_date |
| day | `trip_day_metadata.title`, `local_date` | label, local_date |

Allowlist de camps, sense payload arbitrari del client. Text lliure: revisió explícita `p_text_reviewed=true`, màxim 500 caràcters, rebuig de credencials/contactes/reserves evidents. És una barrera conservadora, no classificació exhaustiva de sensibilitat. Dates poden entrar automàticament; la ingesta de foto només captura `local_date`, mai EXIF/GPS ni títol automàtic.

Snapshots immutables `classification=context`, `origin=trip_source`; no converteixen planning en experiència viscuda. `user_statement` i `source_evidence` continuen distingits a ALB-02 i no s'infereixen aquí. Snapshot idèntic llibre/font/payload es reutilitza; no importa canvis de camps exclosos. Reserves, notes privades, contactes, pagaments i Builder privat no s'importen.

## 10. Dependències i verificació

Cap dependència nova respecte de la primera implementació ALB-03. Continua `@imagemagick/magick-wasm@0.0.44`, pin i lockfile, Apache-2.0, només servidor. Paquet desempaquetat aproximadament 32,36 MB amb variants WASM; no equival a mida de bundle desplegat i no entra a PWA. No s'afegeix libheif extern, Sharp ni servei de conversió. S'ha comprovat la lectura HEIC anunciada pel WASM i una descodificació local; no es declara qualificada en producció ni una auditoria completa de vulnerabilitats.

Tests:

- `npm run test:alb03`: 13 tests JS, incloent còpia byte-for-byte, hash/MIME, idempotència, eliminació de font, errors parcials, revocació i HEIC/HEIF pending.
- `npm run test:alb03:image`: 16 tests Deno amb còdecs reals JPEG/PNG/WebP, orientació, ICC, 12 MP, JPEG >5 MiB, PNG sorollós >5 MiB, bombes, HEIC real/HEIF i còpies a filesystem amb eliminació de galeria.
- `npm run test:alb03:db`: migracions sobre DB local descartable, cinc blocs SQL ALB-02 i 11 proves concurrents, SQL ALB-03 (inclòs HEIC immutable mentre pending), quatre blocs de regressió conductual ALB-02 i dues curses d'ingesta/lease.
- `npm run test:alb02`: 11 tests JS originals, separats d'ALB-03.
- Deno typecheck de l'entrypoint; build; paritat d'entrades; `git diff --check`.

Les fixtures són sintètiques, sense fotos d'usuari. El HEIC real és 40×20; la variant HEIF canvia brands compatibles del mateix contenidor. El test de 48 MP és de capçalera/capacitat, no valida descodificació de 48 MP. La fixture ICC és generada per provar preservació, no fidelitat comercial. SQL Storage usa un baseline mínim; les proves físiques usen filesystem. **No s'ha executat el circuit integrat Auth→PostgREST→Storage→Edge allotjat.**

Job `alb03-contracts` independent de `legacy-suite`, sense continue-on-error ni secrets remots, amb JS/còdecs/tipus/SQL/concurrència/paritat. El runner ALB-02 manté la seva cadena fins a les dues migracions ALB-02; ALB-03 aplica l'extensió i repeteix els tests conductuals. No es relaxen invariants antics. Les regles de protecció GitHub han d'exigir el nou job; el YAML no les modifica.

## 11. Fora d'abast i estat exacte

Pendents: worker/qualificació HEIC i grans imatges, color HDR, editor, layouts, proposta Freya, recomposició IA, PDF, impressió, CMYK, bleed, DPI comercials, formats comercials, proveïdor, RAW/ProRAW/DNG, permisos editorials finals i purga.

Sense canvis a frontend, navegació, index/404/sw, Builder ni Fotos visibles. Mòduls no carregats per la PWA actual; cap invalidació de cache en aquesta fase. La integració futura haurà de coordinar frontend/backend/Storage/Edge/PWA.

Codi i migració ALB-03 locals; SQL només aplicat a bases descartables de tests. Cap canvi remot, desplegament, db push ni migration repair. Sense commit ni PR. La preservació original i els estats pendents es poden revisar; l'edició immediata de qualsevol fotografia mòbil i el desplegament necessiten les qualificacions i conversions descrites, que no es donen per resoltes.

Resultat final local (2026-10-05): 13/13 JS ALB-03, 16/16 proves d’imatge, SQL/concurrència ALB-03, regressió ALB-02 (11 JS, cinc blocs SQL inicials, 11 curses i quatre blocs post-migració), typecheck, build, paritat i diff check PASS. El build ha usat `NODE_PATH` cap a les dependències macOS ja instal·lades al checkout original; els artefactes generats s’han exclòs del diff. Cap check GitHub executat perquè encara no hi ha PR.

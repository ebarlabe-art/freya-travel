# FOTOS-01 · Cua recuperable de fotografies

Estat de branca: **IMPLEMENTAT, PENDENT DE VALIDACIÓ**. No tancat. Base `574d52dd1224407f0f5ce8490a58918b02a7c536`; branca `fix/fotos-01-upload-reliability`. Cap desplegament, migració ni escriptura de producció.

## Auditoria abans del canvi

- Frontend públic llegit l'11/11/2026: SW v55; bloc PHOTO_V2 idèntic al main auditat. També idèntic al commit `c246746` disponible durant Bolonya (23–25/10). Això acredita el codi publicat, no quina cache executava cada iPhone.
- Límit client 20 per selecció, cua només en memòria, descartada en reset/recàrrega. Idempotència limitada al lot retingut; no hi havia represa persistent. Reintents desactivats durant tota la cua i mentre s'esperava la galeria.
- Descodificació prèvia obligatòria de cada JPEG/PNG/WebP original, previsualitzacions d'originals i reconstruccions de la cua; potencial pressió de memòria. No hi ha captura de memòria de l'iPhone: no s'afirma que expliqui una terminació concreta.
- Finalització sense error es marcava «Pujada» sense rellegir objecte/document/metadades. Recuperació via Realtime només contrastava metadades. Un HTTP 200 de Storage no prova finalització.
- `docs/contextual-photos-v1.md` encara descrivia JPEG/15 MB; main i remot admeten HEIC/HEIF i 32 MB des de 5/10. El límit 20 sí seguia vigent. Són limitacions anteriors, no regressions introduïdes per A-01/A-03.
- Consulta remota de només lectura: bucket privat `trip-documents`, límit 33.554.432 bytes i MIME JPEG/PNG/WebP/HEIC/HEIF; RLS actiu en objects, documents i metadades, amb pertinença al viatge. La RPC desplegada `finalize_trip_photo` comprova auth/membre/viatge genèric, camí/propietari/identitat, índex 0–19 i retorna la parella existent sota lock; no es modifica.
- Recompte agregat 6–9/11: 20 documents Foto, 20 objectes corresponents, 20 metadades. Logs 7/11 UTC: 13 uploads HTTP 200, 366 signatures 200 i 192 lectures signades 200. Cap error en les operacions Storage d'aquest interval consultat. Això no acredita els intents que no arribaren al servidor. No s'han descarregat fotografies ni exposat noms privats, tokens o URL signades.
- `IMG_8708.jpeg / Load failed`: evidència aportada per la usuària. La causa exacta d'aquell error de transport no es pot determinar amb aquests logs. No s'inventa una fallada RLS/servidor, ni es qualifica la Wi-Fi com a causa demostrada.

## Canvi mínim de contracte

Es conserva el model i el writer existents. Fins a 50 fitxers per selecció, amb sublots UUID de 20 i índex 0–19; cua màxima 200 entrades amb explicació explícita. Pujada seqüencial, errors independents. Context dia/activitat/planning/títol copiat explícitament, editable abans de pujar i congelat abans de finalització ambigua. Les correccions posteriors continuen usant la UI/RPC/CAS existents.

Nou adaptador `domain/photo-upload-store.mjs`: IndexedDB xifrat AES-GCM, clau CryptoKey no exportable per usuari, AAD usuari/viatge/UUID, metadades i originals en stores separats. Una transacció local desa els dos, sense carregar tots els originals quan es recupera la cua. Es desxifra un fitxer a la vegada; la cua es confirma localment abans de cap pujada. Quota/IDB bloquejat és un error visible, mai un permís per pujar sense còpia recuperable. Selecció/persistència cedeixen el fil entre fotos.

Identitat immutable document/lot/índex/camí. Sense upsert, neteja remota, migració ni substitució. Web Locks impedeix treballadors simultanis del mateix àmbit; absència de suport és explícita. Timeout no implica fracàs del servidor: es conserva la identitat i, al reintent, es comproven primer document/metadades/objecte i mida. Si només l'objecte existeix, es finalitza sense retransmetre'l. «Desada» requereix confirmació de document, metadades i fitxer, no HTTP 200 sol.

Reintents individuals i de les fallides disponibles: si hi ha una altra foto en curs, queden programats. Reset de viatge/usuari atura nous passos/UI antics però conserva la cua al seu àmbit local. Reobertura recupera els estats interromputs com a revisables/reintentables; no puja automàticament una selecció que l'usuari encara no havia confirmat. «Acabar» només allibera originals locals de fotos confirmades; els pendents es conserven. Fitxers de format/mida no admissibles es poden retirar explícitament de la selecció.

No hi ha recompressió amb pèrdua ni descodificació obligatòria abans de pujar: es conserva l'original. Galeria amb signatures de concurrència màxima 4, imatges lazy i error de previsualització amb accés a l'original. HEIC/HEIF pot requerir Fotos en navegadors sense decoder; no es promet conversió universal. Londres conserva el seu uploader històric, amb test de paritat de bloc.

## Proves i distinció d'evidències

- Suite unitària ampliada: 56 proves fotos, incloent 50→20+20+10, formats/mida, errors, persistència fallida, callbacks tardans, canvi d'usuari/viatge, verificació obligatòria, metadades/CAS i navegació existent.
- `check-photos-upload-browser.mjs`: build real a 390×844, clics tàctils, IndexedDB i Web Crypto reals. Backend **sintètic local**, xarxa externa bloquejada. Lots 5/20/50 amb JPEG generats al navegador, bytes comparats amb originals, finalització i metadades comprovades i galeria real recarregada amb càrrega d'imatges. HTTP 503 després de conservar objecte/finalització, clic de reintent durant la cua, recàrrega durant pujada lenta, offline/online, àmbits i exclusió de treballadors. Original gran de 16 MB i rebuig explícit de 33 MB. HEIC/HEIF usa un contenidor vàlid generat amb `sips` a partir de la icona de l'app, sense dades personals. No substitueix fotos autèntiques d'iPhone ni garanteix decoder en tots els navegadors.
- Prova històrica de Home ajustada deliberadament: el bloc genèric Fotos ja no és immutable perquè és l'objecte d'aquesta correcció; Join, uploader Londres i Smart Home segueixen protegits. No es relaxen garanties de dades.
- Tests fotos i navegador afegits als blocs obligatoris de CI. Suite general, build, packaging, paritat, PWA des de v55 i regressions Chromium/WebKit: resultats finals a la PR del commit revisat. La lectura remota acredita configuració i recomptes, no una pujada E2E sota RLS amb iPhone.

## Límits i recuperació

No es promet càrrega en segon pla. iOS pot suspendre la PWA o eliminar dades del lloc; una còpia local xifrada no substitueix la fototeca original. No es fa deduplicació visual global: reseleccionar voluntàriament un original després d'eliminar la cua local pot crear una foto nova. Reintents dins de la cua recuperada conserven identitat. Transferència estàndard, no TUS: un intent realment interromput abans d'arribar a Storage pot requerir retransmetre el fitxer complet. No s'han afegit serveis ni llibreries.

Les claus locals protegeixen dades en repòs, no davant codi maliciós executat al mateix origen. Les cues no se sincronitzen entre dispositius. L'accés als originals segueix subjecte a sessió/RLS; si canvien permisos es conserva l'error sense esquivar-los. No es netegen objectes remots suposadament orfes.

Cache v56 preparada, actiu nou registrat a packaging i SW. Reversió abans de publicar: revertir la PR. Després d'una publicació autoritzada: restaurar frontend coherent, incrementar cache, provar offline; preservar IndexedDB i no eliminar cues ni objectes. Tornar al client antic impedeix reprendre la cua nova fins a recuperar el client compatible; cal informar-ho i acabar les cues abans d'una reversió planificada.

## Validació física obligatòria després d'autorització

1. Confirmar versió publicada i actualització PWA. Conservar originals a Fotos; triar un context real explícit de dia/planning.
2. Seleccionar 5 JPEG, comprovar noms, títol i context; pujar. Contrastar 5 desades i 5 visibles; obrir-les.
3. Repetir amb 20 i 50, incloent originals HEIC i grans compatibles. Comprovar recompte, qualitat visual i context de cada sublot. No duplicar les fotos dels lots anteriors voluntàriament.
4. Interrompre Wi-Fi amb una pujada en curs, tancar/reobrir PWA i tornar al mateix compte/viatge. La cua ha de reaparèixer amb els mateixos fitxers; usar Reintenta, **no tornar-los a seleccionar**. Comprovar recompte únic i galeria.
5. Canviar de viatge/usuari durant un intent: cap foto ni estat antic a l'altre àmbit; tornar a l'original i reprendre. Navegar per l'app mentre puja i verificar que els controls responen.
6. Tancar/reobrir després d'acabar; verificar originals accessibles i context conservat. Registrar versió, tipus/mida aproximada, recompte i missatge exacte si falla, sense compartir URL signades.
7. Només amb revisió, CI/regressions, desplegament autoritzat i aquesta prova física satisfactòria es pot declarar FOTOS-01 TANCADA. Fins aleshores: IMPLEMENTAT, PENDENT DE VALIDACIÓ.

Referències consultades: [uploads estàndard](https://supabase.com/docs/guides/storage/uploads/standard-uploads), [control d'accés Storage](https://supabase.com/docs/guides/storage/security/access-control), [changelog](https://supabase.com/changelog.md). No s'han detectat canvis aplicables que requereixin migrar la API existent; no s'ha actualitzat l'SDK.

# #228 · Identitat geogràfica, persistència, rutes i guia

Auditoria del 13/11/2026. Base real `main` **4bee57843f3c18a7505c3e13eaa323f9d31d8a6d**; branca `fix/228-stable-geographic-identity`. Implementació en branca, sense merge ni desplegament. #228 i #226 continuen obertes: no s'acredita encara el tancament físic.

## Evidència i límits

- GitHub consultat: #225 fusionada a `db487d5` el 12/11; #227 fusionada a `4bee578` el mateix dia. Les notes anteriors «branca, no publicat» de l'inventari són històriques; no descriuen l'estat Git actual.
- Supabase: **només metadades**, mitjançant transaccions `READ ONLY`: definicions dels dos triggers d'invalidació i polítiques de les dues taules. No s'han llegit ni utilitzat files de viatges productius.
- Bundles desplegats `cultural-guide` **v7** i `itinerary-route` **v7**, tots dos amb JWT: contingut geogràfic compartit, domini cultural i adaptador de rutes idèntics a `main`. No és una hipòtesi de backend antic. Còpies privades fora de Git, sense secrets. Això no acredita el frontend que una PWA física té en cache.
- RLS activa, SELECT/UPDATE per membres i WITH CHECK de pertinença a totes dues taules. No hi ha evidència de RLS desactivada o manca general de política. No s'ha verificat la sessió/dispositiu afectat ni una denegació específica de producció.
- Reproduccions amb noms dels casos comunicats i identitats de proveïdor **sintètiques**; no són respostes live de Geoapify ni informació cultural real.

## Recorregut transversal

| Tram | Contracte i resultat de l'auditoria |
| --- | --- |
| PDF → extracció | `import-itinerary/transcript.mjs` i motor de revisió existents. L'activitat, l'evidència i les hores no són una identitat geogràfica. Es conserva el treball de #214/#225. |
| Normalització → candidats | `extractActivityPoints` produeix consultes pendents; no coordenades. #227 recupera el poble d'un àpat, però descartava l'establiment explícit. Ara són consultes separades. Un àpat genèric no inventa cap lloc. |
| Proveïdor → selecció | `validPointPlace` i `pointPlace` mantenen identitat, atribució, país i precisió. Homònims distants no s'accepten automàticament; la selecció explícita pot ser transfronterera. |
| Formulari manual → Supabase | Defecte confirmat: `searchManualItineraryPlaces` només copiava `canonical_name` al text. El handler no enviava identitat/coordenades. Ara la selecció es conserva també a l'esborrany i es desa com a `location_points` amb la mateixa activitat, sense tocar-ne l'horari. |
| Editor de punts → persistència | Defecte confirmat: `saveActivityPoints` demanava només `id`. Un trigger podia retornar ubicació nul·la i la UI comunicar «Punts desats». Ara compara la instantània real retornada amb la confirmada; una resposta buida, diferent o sense ubicació és error. |
| Edició → triggers | Defecte confirmat tant al repositori com desplegat: qualsevol canvi de títol, lloc textual, adreça o ciutat anul·lava `location_points` i `resolved_location`. Migració additiva de funcions: si es conserva la mateixa selecció vigent, es conserva el lloc acreditat i s'actualitza el fingerprint. No es recuperen ubicacions ja perdudes ni snapshots obsolets. |
| Recuperació → consumidors | Domini comú `activityGeographicPoints`: punts ordenats confirmats, alternativa legacy vigent si només hi ha suggeriments, i respecte d'una llista buida explícita. Editor, mapa, ruta i guia reutilitzen el mateix criteri. |
| Mapa → trajectes | Punt verificat reutilitzat sense imposar la ciutat base ni repetir geocodificació. Pobles representatius conserven l'avís de precisió. Un punt representatiu d'un bosc **no acredita un accés transitable**: la ruta continua pendent quan falta un accés exacte. No s'inventen km/min. |
| Guia general → fonts | #227 ja eliminava la comparació rígida consulta/nom canònic per a llocs confirmats. Es preserva. Pobles, barris, boscos, monuments i establiments poden ser temes culturals; fonts i cites continuen validades. Un lloc identificat no garanteix que existeixi un article adequat. |
| Guia → audioguia | Es reutilitza el motor català existent i només text acreditat/desat; controls, errors, offline i fallback sense veu catalana coberts per regressió. Veus i execució en segon pla a iOS necessiten prova física. |

## Causes confirmades i antecedents

1. **Selecció visual sense identitat persistent** al formulari manual. Es podia triar el candidat i desar només un nom. Un altre consumidor l'havia de cercar de nou.
2. **Fingerprint de prosa tractat com a identitat.** Les migracions `20261016153108` (legacy) i `20261020100255` (punts ordenats, introducció `ff4548f`) anul·laven la selecció quan canviava qualsevol d'aquests camps. Els lectors la rebutjaven igualment. És una invalidació deliberada del contracte antic, no una manca de Storage.
3. **Comprovació de desament insuficient.** Retornar un `id` acredita una fila afectada, però no que el trigger hagi conservat la ubicació. La correcció verifica el valor retornat.
4. **Consumidors divergents.** La guia podia recuperar un legacy confirmat mentre l'editor mostrava consultes pendents i ocultava l'enllaç de mapa textual. Ara comparteixen la font d'identitat; una eliminació explícita no ressuscita un legacy.
5. **Població/establiment barrejats.** Es conserven separadament les mencions explícites d'un àpat al poble i al restaurant. Són suggeriments fins a verificació, no reserves.
6. **Resolució automàtica excessivament limitada per tipus.** Un poble inequívoc de la localitat del context o un espai natural amb concordança acreditada pot conservar el punt representatiu com a tal. Es mantenen país, localitat, nom i ambigüitat; no s'amplien aquests filtres per acceptar el primer resultat transfronterer.

La inspecció històrica de `f3adad8` mostra mapes manuals de consulta textual i activitats amb coordenades originals; Londres conserva el camí històric i Eivissa usa la projecció genèrica. La introducció de punts ordenats va afegir un contracte més estricte que el simple enllaç textual. Això explica com una versió amb mapes textuals podia semblar funcionar i una confirmació posterior perdre's o quedar pendent. **No** s'afirma haver reproduït el dispositiu o els viatges històrics particulars.

#225 va corregir selecció transfronterera, aliases i navegació; #227, identitat cultural confirmada i poble en àpats. Cap de les dues eliminava els triggers anteriors ni feia que el formulari manual enviés la selecció completa. Les seves proves de navegador substituïen la persistència per una assignació en memòria; aquesta assignació no executava els triggers i no podia detectar aquesta pèrdua.

## Canvi de contracte, seguretat i compatibilitat

- No hi ha segon model ni taules noves: es reutilitza JSON v1 i el legacy existent, amb els mateixos IDs, CAS, RLS i validació de coordenades/atribució.
- La identitat confirmada pertany a l'activitat fins que l'usuari la substitueix o la retira explícitament. Canviar la descripció, l'adreça textual o la ciutat contextual no és una nova selecció geogràfica. Per canviar el lloc s'utilitza la cerca/selecció o l'editor de punts. El formulari conserva els altres punts de l'activitat.
- La migració només modifica dues funcions existents, no polítiques ni privilegis. Cap backfill. Una llista buida explícita continua buida; `null` explícit continua nul. Si canvia la prosa, les consultes pendents del snapshot anterior no s'eleven a llocs confirmats. Només es preserven seleccions ja vigents, no snapshots de fingerprint incorrecte.
- Les limitacions de les hores, les reserves fixes, la confirmació de canvis i la importació amb consentiment no es relaxen. Cap dada real, itinerari, document, fotografia o reserva s'ha alterat.
- Cache preparada **v60**, marcador `pwa-geography-identity-228`; paritat index/404 generada. No s'han publicat aquests recursos.

## Validació i criteris d'acceptació

Resultats locals finals: **968/968 tests Node**, cap omissió; build i paritat correctes. Chromium: flux d'Aran amb Postgres real descartable i reobertura de disc, guia/audioguia universal (Bolonya/Eivissa/Londres), punts ordenats, ubicacions automàtiques, rutes i bootstrap (caches v18–v59 → v60, recuperació 503/offline), tots correctes. SQL: punts i guia cultural amb les migracions reals, RLS i CAS correctes. El control del paquet confirma el destí públic previst i absència de configuració d'altres entorns. Les primeres execucions han detectat un límit del sandbox per crear subprocessos i expectatives de versió/fixture obsoletes; s'han corregit aquests contractes sense suprimir cap prova. La bateria final passa completa.

Comandes principals:

```sh
npm test
npm run entries:check
npm run build
PGLITE_MODULE=/ruta/a/pglite/dist/index.js node scripts/test-itinerary-points-db.mjs
PLAYWRIGHT_MODULE=/ruta/a/playwright-core/index.mjs IMPORT_BROWSER_PATH=/usr/bin/chromium PGLITE_MODULE=/ruta/a/pglite/dist/index.js node scripts/check-aran-cultural-flow-browser.mjs
```

- `geography-identity.test.mjs`: poble + restaurant separats, Luchon, Carlac general sense monument, ambigüitats, transfronterer, lectura legacy compartida, eliminació i fals èxit rebutjat.
- `test-itinerary-points-db.mjs`: migracions reals en Postgres descartable; reprodueix primer la invalidació antiga i després verifica la migració nova. Confirmats exactes/representatius, manual/reserva, camps originals, consultes pendents, eliminació explícita, conflicte de versió, membres/aliens/anon.
- `check-aran-cultural-flow-browser.mjs`: PDF/revisió/writer existents, preparació de les guies de Saint-Bertrand, Luchon i Carlac i àpat amb poble, selecció manual des del formulari; amb `PGLITE_MODULE`, persistència en Postgres local amb triggers i RLS, tancament/reobertura del disc i recàrrega de la PWA, mapa i guia recuperats. La generació cultural i els proveïdors continuen simulats. El wrapper d'importació no és una instància real de PostgREST.
- Regressions existents de punts/rutes, automatismes, guia/audioguia, Londres, Eivissa, Bolonya, navegació, errors i offline. La CI conserva la matriu Chromium/WebKit i executa el flux cultural amb Postgres descartable a cada motor.
- **Pendent local:** descàrrega de WebKit bloquejada amb HTTP 403 `Domain forbidden` a `cdn.playwright.dev` i `playwright.download.prss.microsoft.com`. No s'ha substituït WebKit per Chromium. La matriu CI queda com a comprovació independent; no se'n pressuposa el resultat.
- **Pendent live:** lectura del PDF amb IA, cerca Geoapify, disponibilitat de fonts Wikimedia i generació cultural reals. En aquest executor no hi ha credencials segures de proveïdor ni un entorn Supabase de prova configurats; no es fan servir viatges productius com a fixtures.
- **Pendent físic:** iPhone instal·lat, selecció/desament → canvi de pantalla → recàrrega → suspensió/reobertura → sincronització d'un segon membre i mapes/audioguia. No es dona per tancada #228 sense aquesta validació.

## Publicació i reversió: només després d'autorització

1. Capturar versions i definicions actuals i conservar el frontend anterior; confirmar CI, font d'instal·lació i còpia de seguretat. Les còpies Edge consultades en aquesta auditoria són privades, no credencials.
2. Aplicar **només amb autorització específica** `20261113124532_preserve_confirmed_activity_geography.sql`, sense backfill. Verificar metadata i un cas sintètic autoritzat, no viatges personals. Clients antics mantenen el contracte JSON v1.
3. Desplegar bundles `cultural-guide` i `itinerary-route` amb el mòdul compartit de punts; no només fitxers solts. Verificar JWT i tractament de país/precisió. No hi ha canvi d'API pública.
4. Després publicar frontend v60 des de la PR revisada. Validar la versió real rebuda per la PWA sense esborrar dades locals, crear una única visita sintètica autoritzada i executar la comprovació física.
5. Si falla: aturar noves edicions, restaurar els artefactes anteriors i comprovar sessions/llocs. La migració és compatible amb el JSON anterior, no obliga a esborrar dades. Restaurar les funcions antigues requereix una altra migració explícita i reintroduiria la invalidació: no fer-ho a cegues. Les ubicacions que ja s'havien perdut abans d'aquest canvi no es poden reconstruir sense evidència; no inventar-les.

## Altres incidències obertes: fora d'aquesta PR

| Ordre proposat | Incidències | Motiu / següent pas |
| --- | --- | --- |
| 1 | #228, #226 | Acabar prova live i iPhone d'aquesta cadena abans de tancar. |
| 2 | #222, #128, #132 | Reprendre PWA i tornar a l'itinerari és prerequisit d'ús; capturar diagnòstic físic sense reinstal·lar ni esborrar dades. No reobrir genèricament totes les correccions històriques. |
| 3 | #194, #198, #196, #202, #135, #140 | Reconciliar els estats amb les PR ja fusionades i validar PDF real, omissions/trasllats, represa i confirmació; no reimportar ni alterar dades reals. |
| 4 | #224 | Avisos d'Aran: auditar horari exacte/aproximat, registre i permisos/lliurament del dispositiu abans de modificar el worker. No s'ha provat cap notificació real aquí. |
| 5 | #220, #212, #213 | Visor/càrrega de fotos i Travel Book: revisar resultats físics i codi ja integrat, separar pujada/derivats/estat de l'editor. No modificar l'àlbum en aquesta PR. |

Aquesta llista reflecteix issues obertes consultades, no prova que tot el seu codi continuï absent. Es manté el roadmap canònic i no s'implementen aquests altres treballs aquí.

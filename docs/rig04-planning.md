# RIG-04 — Conciliació intel·ligent i viabilitat

## Abast i estat

Base auditada: `main` `674fd37667c6409915e42af60bc57208f74612a8`, després de [PR #191](https://github.com/ebarlabe-art/freya-travel/pull/191). Implementació a `codex/rig04-intelligent-planning`. No és una publicació: cap migració, desplegament, consulta de dades privades o escriptura a producció durant aquesta feina. No s'ha utilitzat Freya PROVES. Els canvis locals previs de `proposal-engine` romanen al checkout original, fora d'aquesta branca.

## Auditoria abans d'implementar

| Capacitat existent | Evidència de codi | Reutilització / buit detectat |
| --- | --- | --- |
| Extracció i revisió del PDF | `import-itinerary-proposal.mjs`, `import-itinerary-review.mjs`, `import-itinerary` | Camps, confiança, evidència i avisos preservats; no es modifica l'extractor. |
| Comparador i decisions explícites | `import-itinerary-reconciliation.mjs`, `import-itinerary-reconciliation-ui.mjs` (#189–191) | Reutilitzem el mateix pla i el suggeriment de candidates noves. Faltava identitat entre idiomes i avaluació del conjunt resultant. |
| Desament atòmic | RPC de les migracions `20261029141108` / checkpoint `20261029172805`; writer de #190 | Es mantenen confirmació, versions, idempotència, RLS, bloqueig, recuperació d'operació incerta i proteccions. No es modifica SQL. L'aplicació remota consta a l'inventari anterior; aquesta tasca no la torna a certificar. |
| Equivalències | `matchingExistingImportItems`, `sameNamedLandmark`, `normalizePointName` | Comparador conservador existent; s'amplia amb àlies delimitats per ciutat i nom complet. Cap segon motor de duplicats. |
| Durades i marges | `routeFeasibility`, `visitTimeBudget`, `recommendedVisitAdvice` | Es reutilitza `routeFeasibility`. Els consells de durada de visita ja existeixen, però són orientatius: no es converteixen en durades confirmades ni es torna a implementar el recomanador. |
| Rutes | `itinerary-route.mjs`, `itinerary-route-ui.mjs`, Edge `itinerary-route` | Mateixa cua limitada, mateix Geoapify, resolució conservadora i JWT. El servidor només acceptava referències ja desades: s'afegeix l'entrada d'esborrany de només lectura. |
| Reserves / agenda | `itineraryProjection`, readiness de fonts i classificació exact/approximate | La projecció existent aporta activitats, vols i hotels. Només es copien camps de calendari; són barreres protegides. |
| Obertura | No s'ha trobat un contracte actiu que acrediti el calendari d'obertura del lloc per al dia concret | Es deixa pendent. El motor admet evidència verificable amb lloc, dia, fus, font, vigència i intervals; no inventa ni extreu un horari festiu a partir d'un horari genèric. |

L'auditoria i el pla tècnic es van presentar abans de la implementació. Les proves anteriors acreditaven el comparador i el desament; no acreditaven aquesta nova intel·ligència ni l'estat públic.

## Pla tècnic executat

1. Ampliar el comparador existent amb identitats conservadores, sense col·lapsar visites compostes ni noms genèrics.
2. Projectar en memòria el resultat del mateix pla de conciliació: existents conservades + noves/actualitzades + reserves protegides. Retirades només si l'usuari ja les ha decidit explícitament en la conciliació existent.
3. Classificar solapaments UTC, temps insuficient de trajecte, marges ajustats i informació absent. No moure cap reserva.
4. Cercar alternatives limitades d'hora, ordre o dia dins les dates del viatge i reavaluar el conjunt abans d'oferir-les.
5. Acceptar una proposta amb l'editor d'esborrany existent; repetir la validació en aquell moment. El writer atòmic només s'executa després de la confirmació final ja existent.
6. Consultar trajectes amb el mateix endpoint, proveïdor i pressupost de consultes, sense desar les candidates prèviament.
7. Empaquetar els mòduls per Pages/PWA i validar el mateix flux amb dades sintètiques en Chromium/WebKit.

## Comportament

«Analitza i combina l'itinerari seleccionat (sense desar)» aplica les decisions segures només a l'esborrany i mostra visites reconegudes, noves, incompatibilitats, marges i pendents. Funciona amb un viatge buit o amb planning existent.

Una equivalència automàtica necessita una única identitat coneguda, ciutat coherent, data, inici, final i fus iguals, ubicació equivalent i notes/adreça sense diferències. No serveix per ignorar canvis operatius. Dues entrades del PDF amb la mateixa identitat o dues existents possibles requereixen revisió. Si després es canvia una hora o nota de la candidata, es retira la decisió automàtica i es torna a demanar revisió. Les decisions explícites no es repeteixen.

El resum diferencia incompatibilitats de franges, trajectes insuficients, marges ajustats i pendents. Els instants UTC permeten travessar mitjanit i comparar fusos. Les hores condicionals/orientatives conserven el contracte de #190: no es converteixen en reserves exactes.

«Comprova els trajectes a peu» consulta com a màxim 20 trams, amb dues peticions simultànies. Resultats recents reutilitzats durant cinc minuts; errors visibles i reintent explícit. Es mostren durada, temps entre visites, font i instant del càlcul. Un resultat ambigu no es confirma automàticament. Les preferències i modes de transport de l'agenda existent continuen intactes; aquesta anàlisi consulta a peu i no pretén verificar serveis/horaris de transport públic.

«Acceptar el canvi proposat» modifica únicament dia, inici i final de la candidata importada. Manté la durada, només ofereix dies del viatge, no canvia reserves, dades existents ni el document. Abans d'acceptar comprova que el conjunt no hagi canviat i que la proposta continuï sent admissible amb les dades actuals. Reordena cronològicament com a conseqüència del canvi d'hora; no crea un ordre paral·lel persistent.

## Seguretat i compatibilitat

- `itinerary-route` conserva autenticació, comprovació de membre, reads amb JWT/RLS, validació de versió de referències desades i pressupost existent de 20 peticions/minut/usuari per instància. L'entrada nova només admet títol, nom del lloc, adreça i ciutat acotats; no accepta coordenades injectades. No hi ha cap escriptura nova al servidor.
- No s'envien notes, documents, codis de reserva, fotografies ni el PDF al servei de rutes. El proveïdor rep només les dades necessàries de lloc.
- Reserves, vols, hotels i plans fixos no són objectius de les solucions. El mateix writer atòmic continua protegint fotos, progrés i concurrència de les activitats manuals.
- Errors, desconnexió, canvi de viatge/usuari o fonts incompletes no es converteixen en confirmacions de viabilitat. Fonts incompletes impedeixen proposar canvis.
- Es conserva la recuperació de l'operació ja confirmada de #190. L'esborrany no confirmat continua sent en memòria com abans: cancel·lar-lo o recarregar la pàgina no és un desament. No s'afegeix persistència silenciosa de contingut privat.
- No hi ha migració ni dependència nova. Caldrà autorització per desplegar primer l'Edge `itinerary-route` i després el frontend; l'Edge ampliada conserva el contracte del frontend anterior. Amb backend antic, la nova consulta d'esborrany falla de manera visible i queda pendent, sense falsificar una ruta.
- Marcador preparat: `pwa-itinerary-planning-rig04`; cache preparada: `freya-travel-release-6444-v44`. No són afirmacions de desplegament.

## Límits explícits

- Àlies automàtics actuals: tres llocs de Riga (catedral, Casa dels Caps Negres, mercat central) i tres de Bolonya (San Petronio, Neptú, Piazza Maggiore). És un catàleg inicial verificable, no un traductor universal. Altres noms continuen pel comparador conservador i revisió humana.
- No existeix encara un adaptador de calendari d'obertura verificat per a dates concretes. Per això els llocs sense evidència apareixen pendents; el contracte d'evidència i la seva caducitat estan provats sintèticament, no connectats a una nova font.
- No s'infereix un final de visita absent. Les estimacions de la guia existent no constitueixen una reserva ni proven la durada suficient d'una visita composta. Els trams interns continuen a la infraestructura de punts de l'agenda; aquesta conciliació calcula trams entre activitats.
- Les solucions resolen incompatibilitats conegudes, però indiquen les comprovacions que resten. No són un optimitzador global: màxim 200 elements combinats, 10 objectius problemàtics, 40 alternatives examinades per objectiu, tres propostes per objectiu i 30 totals; màxim 31 dies candidats.
- No s'afegeixen reserves ni canvis a les activitats existents sense la decisió i confirmació del flux previ. Les propostes de RIG-04 no accepten ni desfan retirades automàticament.

Fonts primàries dels àlies: [catedral de Riga](https://www.liveriga.com/en/visit/what-to-see/sightseeing/churches/riga-dome-cathedral-1), [Casa dels Caps Negres](https://www.liveriga.com/en/visit/what-to-see/top-sights/house-of-the-blackheads), [mercat central](https://www.liveriga.com/en/1597-riga-central-market), [San Petronio](https://www.bolognawelcome.com/en/places/religious-buildings/basilica-of-san-petronio-eng). Els noms catalans són variants del producte; aquestes fonts acrediten la identitat dels llocs, no disponibilitat futura ni horaris de festius.

## Verificació i continuïtat

- `scripts/rig04-planning.test.mjs`: traduccions i falsos positius, diferències operatives, immutabilitat, reserves, mitjanit, rutes absents/caducades, marges, obertures amb identitat/data/caducitat, acceptació obsoleta, viatge buit i HTTP autenticat de rutes d'esborrany.
- `scripts/check-rig04-planning-browser.mjs`: build real de Pages, clics tàctils Chromium/WebKit a 390 × 844; viatge existent i nou, equivalència segura, acceptació, fallada/reintent de rutes, reutilització de resultats, invalidació d'equivalència després d'editar i cancel·lació. Totes les xarxes externes bloquejades, transport simulat i zero escriptures.
- CI incorpora les proves de domini i el flux de navegador en les dues matrius existents; conserva totes les regressions anteriors i tests SQL/concurrència del writer.

Resultats locals: **863/863** tests de `npm test`; build, paritat i artefacte públic correctes. Flux RIG-04 superat en Chromium i WebKit mòbil i WebKit iPad (1024 × 768). Regressió RIG-03B superada en Chromium/WebKit i contractes SQL executats en Postgres embegut amb dades sintètiques (RLS, concurrència optimista, rollback, idempotència i proteccions). La CI remota del SHA final i la prova física a l’iPhone s’informen separadament; no s’equiparen a aquestes proves locals.

Punt de relleu: revisar aquesta branca/PR, la CI del SHA final i els límits descrits; validar posteriorment a l'iPhone després d'autoritzar publicació. No utilitzar el viatge real per demostrar el desament durant desenvolupament. Una futura ampliació d'àlies o obertures ha de conservar els mateixos contractes, no crear un segon motor.

## Revisió funcional de la PR #193 (29/10/2026)

Encàrrec executat segons [comentari de revisió](https://github.com/ebarlabe-art/freya-travel/pull/193#issuecomment-6509630494), mantenint la PR en esborrany.

- **Pendents explícits:** ubicació absent, durada incompleta, hora aproximada, obertura no acreditada i transport indicat al títol/notes no obtenen certificació positiva. Un conjunt buit tampoc. Per prudència, una ruta a peu superior a 15 minuts queda pendent de confirmar la mobilitat real: és el llindar de passeig curt de la política de rutes existent, no una incapacitat de caminar ni una prohibició. El text de les solucions diu que només redueixen un conflicte conegut i que la viabilitat continua pendent.
- **Cache i més de 20 trams:** mostrar i reutilitzar exigeix la mateixa verificació de qualitat, font i vigència que l'avaluació. Ja no es mostren rutes caducades com a vigents ni una resposta no verificada evita el reintent. Cada consulta continua limitada a 20 trams; els no intentats van abans dels errors/reintents perquè un lot amb fallades no impedeixi avançar. UI amb recompte de pendents, límit per consulta i advertiment explícit de transport públic no verificat.
- **Flux mòbil:** després d'analitzar, decisions avançades i editor PDF queden plegats, accessibles a demanda. Conflictes i solucions precedeixen els detalls de pendents/rutes/planning. No hi ha cap model nou de decisions: els mateixos selectors i esborrany continuen actius.
- **Proves ampliades:** recorregut amb clics des d'«Importa document», selecció de PDF sintètic, consentiment, resposta simulada d'importació, anàlisi, acceptació, conflicte revelat pel trajecte calculat, confirmació cancel·lada i edició real d'una durada que queda pendent. Mateix recorregut per viatge existent i inicialment buit, Chromium/WebKit mòbil i WebKit iPad; zero escriptures. Proves de domini de 22 parelles, errors, rutes caducades/invàlides i canvi de clau per canvi de lloc. Edge: sense sessió, membre denegat, entrada sobredimensionada, versió obsoleta i límit de peticions; el proveïdor no s'executa abans de validar.
- **Resultat local d'aquesta revisió:** 866/866 tests, build/paritat/artefacte correctes i els tres recorreguts tàctils superats. CI també incorpora iPad. Cal verificar la CI del SHA final; la prova física no es dona per passada amb Playwright.

Segueixen pendents d'evolució els àlies fora del catàleg inicial, una font d'obertura per data concreta i la mobilitat multimodal dins la conciliació. No s'han afegit migracions ni escrit dades reals. Ordre de desplegament, només amb autorització: Edge `itinerary-route` primer, frontend després; validació física final a l'iPhone. Reprendre a `codex/rig04-intelligent-planning`, PR #193, revisant aquesta secció i la CI del commit més recent.

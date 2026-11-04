# Fase A-02 · Propostes de conciliació al domini

Base: `main` remot `c2f9ea40afeef18ab388a26a274532d4dee168d0`, després de #216. Estat: branca de revisió, no desplegada. Continua [A-01](architecture-a01.md); no crea un roadmap paral·lel.

## Anàlisi prèvia i consumidors

`proposeUnmatchedReconciliationDecisions(snapshot, state)` depenia del predicat privat `safeForBulk` i del comparador existent `matchingExistingImportItems`, via el petit wrapper `matchesFor`. No fa IO ni desament.

Consumidors revisats:

- `reconciliationHtml`: recompte i botó de propostes noves.
- `index.html`, controlador de `itineraryReconcileSuggestNew` (i còpia generada `404.html`): consulta la funció de l'API UI, afegeix decisions només a l'esborrany i renderitza. Conserva guards de context, busy i pendingRequest.
- `initialPlanningDecisions` de `import-itinerary-planning-ui.mjs`: prepara un esborrany filtrat, retira només l'avís de solapament, combina decisions equivalents amb noves.
- `prepareFlashDecisions` de `import-itinerary-flash.mjs`: descarta coincidències amb activitats/reserves, retira l'avís de solapament a la còpia i delega.
- Tests de conciliació UI: continuen usant l'exportació històrica.

## Contracte caracteritzat abans de modificar

1. Exclou un element només si `included === false`, el títol no té text o falta una data amb valor truthy. La validació completa de dates/hores correspon a les capes existents, no a aquest shortcut.
2. Bloca exactament els deu flags existents: `invalid_title`, `invalid_date`, `invalid_start_time`, `invalid_end_time`, `invalid_time_zone`, `timezone_needs_confirmation`, `date_required_for_time`, `time_order_needs_review`, `possible_duplicate_in_review`, `possible_overlap_in_review`.
3. Qualsevol decisió existent amb el mateix `source_order` l'exclou, independentment de l'acció. Es conserva la comparació estricta (número/string no es coercionen).
4. Qualsevol coincidència del comparador existent impedeix ADD: exacta, ambigua, reprogramació o conflicte de matinada. No interpreta una coincidència com a permís d'actualitzar. Activitats genèriques en dies diferents mantenen la semàntica existent.
5. Retorna objectes nous `{source_order, action:'add'}`, en ordre d'entrada; no altera snapshot, activitats, decisions ni reserves. No converteix activitats opcionals en reserves.
6. `decisions` absent és compatible; els inputs obligatoris malformats mantenen els errors existents. No s'afegeixen defaults que ocultin dades incorrectes.
7. Planning i flaix conserven el seu preprocessament diferenciat; la funció directa continua bloquejant solapaments. No s'unifiquen aquests comportaments.

## Extracció

La funció i `safeForBulk` passen a `import-itinerary-reconciliation.mjs`. La consulta singleton al comparador s'expandeix literalment al cos de la funció; no es copia el motor de coincidències ni s'altera el recorregut. El wrapper `matchesFor` de presentació continua servint els seus altres consumidors.

La UI importa i reexporta la mateixa funció; planning UI i flaix importen directament del domini. No s'edita `index.html` ni `404.html`. No s'extreu `suggestedReconciliationTarget` en aquesta fase.

## Garanties i distribució

Sessions, canvi de viatge, Londres, permisos, RLS, RPC atòmica, idempotència, concurrència, writer, esborranys, offline i confirmació explícita queden sense canvis. No hi ha modificacions SQL, Edge, dades, dependències ni APIs externes.

Els quatre mòduls ja figuren a packaging i precache. Cache v53 → v54 i expectatives actualitzades; mateixa política SW. La prova d'actualització cobreix v53→v54 i conserva els casos anteriors. La reexportació protegeix l'API anterior, però no garanteix atomicitat general entre recursos de versions diferents.

## Evidència i límits

- Caracterització abans/després: 30/30 tests (set nous casos de caracterització més 23 existents).
- Comparació diferencial contra el codi de `c2f9ea4`: 1.080 casos amb resultats idèntics i no-mutació.
- Nou test de congelació profunda de snapshot/estat i de resultats independents; exportació compatible per identitat i imports de consumidors/registre d'actius.
- Suite completa local: 940/940; build, packaging i paritat superats. Regressions Chromium/WebKit i CI finals registrades a la PR del commit revisat.
- Cap prova física nova a l'iPhone ni estat de producció acreditat per aquests tests. Proves de navegador amb dades sintètiques; no s'envia el PDF a cap proveïdor real.

## Riscos, reversió i A-03

Es manté l'acoblament global existent i altres dependències de presentació, fora d'abast. La funció continua confiant en flags produïts abans: aquesta extracció no endureix ni relaxa la validació.

Reversió abans de desplegar: revertir la PR. Després d'una publicació autoritzada: restaurar els quatre mòduls, avançar la caché a una versió nova, reconstruir i comprovar el paquet abans d'una nova publicació autoritzada. Cap reversió de dades.

A-03 proposada, no iniciada: caracteritzar `suggestedReconciliationTarget` i extreure exclusivament l'elecció conservadora de target al domini; preservar null per ambigüitat, proteccions de fotos/vincles/estat/fixesa i confirmació explícita. Reexportar des de la UI. No ampliar la detecció de coincidències ni tocar el writer.

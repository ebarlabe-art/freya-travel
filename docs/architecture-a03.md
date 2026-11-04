# A-03 · Extraccions agrupades de conciliació i planificació

Base remota: `8643306` (main després de #217). Branca `codex/a03-grouped-domain-extractions`; proposta no desplegada. Continua els contractes d'[A-01](architecture-a01.md) i [A-02](architecture-a02.md), sense roadmap alternatiu.

## Selecció i consumidors

| Extracció | Justificació i dependències | Consumidors/API conservats |
| --- | --- | --- |
| `suggestedReconciliationTarget` → `import-itinerary-reconciliation.mjs` | Elecció pura d'un ID; mateix `matchingExistingImportItems` per fila i mateixes proteccions. | `index.html` via `r.api` després d'una decisió keep/update explícita, còpia 404 i tests. Reexportació des de reconciliation UI. |
| `initialPlanningDecisions` → `import-itinerary-planning.mjs` | Compon els motors existents `automaticEquivalentDecisions` i `proposeUnmatchedReconciliationDecisions`, sense IO. | API pública de planning UI i tests RIG04/importació/unmatched. La cerca al main auditat no mostra una crida directa des d'index a aquesta funció; no s'introdueix cap nova invocació. |
| `refreshAutomaticDecisions` → `import-itinerary-planning.mjs` | Revalida només decisions abans automàtiques reutilitzant el motor existent. | `index.html` via `state.planningApi`, amb guards de pendingRequest/context existents, i tests. Reexportació des de planning UI. |

Màxim de dues addicionals respectat. `analyzePlanning` es deixa per a una fase pròpia; `calculatePlanningRoutes` implica cua, IO, caducitat i cancel·lació; render/flash i accions que muten estat no s'extreuen aquí. No es creen mòduls nous.

## Contractes caracteritzats

**Target:** només keep/update; zero o múltiples coincidències retornen null. Update exigeix estat planned i absència dels valors truthy de fixesa/fotos/vincles; keep pot conservar una activitat protegida. No es coercionen comptadors ni s'inventa un ID absent. Es manté la detecció de matinada/àmbit geogràfic i l'error dels inputs malformats. No hi ha cap actualització automàtica ni confirmació implícita.

**Initial:** decisions KEEP equivalents abans d'ADD, mateix ordre, exclusió de decisions prèvies i activitats excloses. Només candidats manuals per ADD. En mode unified es conserven els filtres d'incertesa/source_warnings; el flag de solapament s'elimina només a la còpia usada pel shortcut, no a la revisió original. No es canvien equivalències, horaris, reserves ni duplicats.

**Refresh:** conserva les decisions manuals dels candidats inclosos en el mateix ordre i amb les mateixes referències d'objecte; recalcula equivalències només per als source_order abans automàtics. No introdueix decisions automàtiques noves. Un canvi rellevant, exclusió o ambigüitat pot retirar una decisió automàtica segons les regles existents. Array de retorn nou, sense mutar les dades d'entrada; no es promet còpia profunda on abans no existia.

## Implementació separable

- Commit 1: target + caracteritzacions de les tres funcions; les addicionals encara usen el codi original en aquest punt.
- Commit 2: initial; reemplaça només l'àlies local `equivalentDecisions` pel nom real del motor.
- Commit 3: refresh, amb el mateix canvi de nom; elimina l'import d'àlies ara innecessari de la UI.
- Commit d'integració: exports/assets, versió de caché, CI i documentació.

El wrapper de matching del target s'expandeix literalment a la funció extreta; la UI manté el seu wrapper per al render. No es copia ni modifica el comparador. L'assert arquitectònic A-02 ara comprova el consumidor de domini planning en lloc de l'antic import de planning UI, que passa a ser una reexportació: és el canvi de frontera deliberat, no una relaxació del contracte funcional.

## Garanties i PWA

Index/404 sense edicions funcionals. Sense SQL, Edge Functions, dependències noves, dades de producció ni crides a proveïdors reals. Es preserven sessions, membres/RLS, Londres, documents/fotos, Travel Book, writer atòmic, versions/idempotència, confirmació, esborranys i polítiques offline.

Els quatre mòduls ja són a packaging i precache; cap recurs nou. Cache v54→v55, mateixa política SW. Les exportacions antigues són referències a les implementacions de domini, no còpies. Es conserva la correcció d'esperes asíncrones del test introduïda a A-02. La regressió prova actualització des de v54 i les versions anteriors.

## Evidència

- 33/33 proves existents i de caracterització abans de tocar codi i després de cadascuna de les tres extraccions.
- Comparació amb el codi real de main `8643306`: 720 casos target + 576 comparacions de planning = 1.296 resultats equivalents; comprovació de no-mutació.
- Casos congelats profundament, referències manuals preservades, exports idèntics, imports de domini sense UI i actius registrats.
- Suite completa local: 948/948. Build/packaging/paritat correctes. Regressions Chromium/WebKit mòbil/iPad i CI: resultats finals a la PR del commit revisat.
- No és una nova prova física a l'iPhone ni una verificació de desplegament.

## Riscos, reversió i fase següent

Continuen existint la coordinació global i altres dependències UI. La reexportació protegeix l'API però no converteix el desplegament multi-recurs en atòmic; cal publicar un conjunt coherent només amb autorització.

Abans de desplegar es pot revertir cada extracció individualment o tota la PR. El test d'identitat d'exports s'ha d'ajustar si es reverteix deliberadament una frontera; les caracteritzacions funcionals s'han de mantenir. Després d'una publicació autoritzada, restaurar els mòduls afectats, avançar de nou la caché i reconstruir/verificar; no recuperar una versió vella de caché ni fer rollback de dades.

A-04 candidata, no iniciada: caracteritzar i traslladar `analyzePlanning` al domini existent, preservant els defaults, identitat de les referències routes/openings/context i incertesa de l'avaluació. No incloure-hi la cua de rutes ni persistència.

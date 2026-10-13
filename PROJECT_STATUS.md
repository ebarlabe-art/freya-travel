# Freya Travel — Estat únic i següent pas

**Actualització:** 13 octubre 2026, 18:00. **Objectiu immediat:** beta amb amigues a Bolonya, cap al 27/10/2026.

> Font de veritat operacional. Actualitzar **en cada PR fusionada**, no recrear-la en xats nous. Separar sempre: codi implementat, tests automatitzats, comprovació física i publicació. No donar mai una funcionalitat per validada només perquè hi ha una PR fusionada.


## Issue #125 — circuit de creació i compartició (branca, pendent de fusió/publicació)

- Base auditada: `main` després de PR #124 (`055f77b`). `manualTripView` → `create_trip_with_stops_v1` → `get_my_trips` / `refreshTrips` → tauler → codi → `join_trip_v2`. Reutilitza els permisos i l’agenda existents; Londres no canvia.
- Defecte reproduït: creació confirmada seguida de recàrrega fallida deixava el formulari reenviable i podia mostrar només l’error de xarxa. Correcció: consumir el formulari quan arriba la confirmació i indicar que el viatge està desat encara que falli la lectura posterior. Una llista obsoleta tampoc obre un altre viatge en lloc del creat/convidat. Una petició sense confirmació continua conservant les dades; no s’afegeix idempotència de servidor a la creació.
- **PASS local:** `npm test` (654 tests), `npm run entries:check`, `npm run build`; PostgreSQL descartable amb baselines existents i migracions cronològiques (sense Cron): propietària, amiga i tercera persona sintètiques, dos viatges, RLS de lectura/escriptura/eliminació, invitació repetida sense duplicats, edició concurrent amb `updated_at` i relectura des de les dues sessions.
- **PASS navegador automatitzat:** build de Pages real, Chromium a 390 px, crear/compartir/copiar, Back/Forward, error de xarxa després de desar sense duplicació ni obertura d’un altre viatge, segon compte sintètic, recàrrega i reobertura offline amb service worker; 1024 px amb tacte i identificació d’escriptori. Auth, dades i compartir són adaptadors sintètics; la prova SQL és independent. No acredita el transport Realtime remot ni el full de compartir natiu.
- CI de PR incorpora aquests dos circuits; consultar el resultat sobre el commit de la PR. Cache incrementada a v17 i paritat `index.html` / `404.html` preservada. El test antic d’identitat textual del formulari se substitueix per regressions de comportament; les comprovacions de cache s’actualitzen explícitament a v17.
- **Pendent físic:** dos comptes reals a Freya pública, Safari/PWA iPhone (inclosa suspensió/reobertura), full natiu de compartir i actualització entre telèfons. Cap viatge real de Bolonya creat, cap data/reserva inventada, cap dada remota modificada, cap migració ni Edge Function desplegada. La disponibilitat a pública depèn de fusió i publicació.

Per crear Bolonya (només quan l’Eva tingui les dates):
1. A Freya pública, iniciar sessió → Dissenya un viatge → Crear un viatge nou.
2. Afegir Bolonya i confirmar la destinació; introduir les dates reals i crear.
3. Al tauler, obrir Viatgers → Compartir invitació o Copiar codi.
4. L’amiga inicia sessió al seu compte → Uneix-te a un viatge → enganxa el codi.
5. Obrir el mateix viatge i comprovar una edició d’agenda des dels dos telèfons.

## Estat de la prova física (13/10): desament desbloquejat

- **Verificat a iPhone / Freya PROVES:** les activitats del PDF de Riga s'han **afegit** al planning després de confirmar. Correcció provada en ús real.
- **PR #117 fusionada a main el 13/10.** Pendent confirmar la publicació final de GitHub Pages; no es dona per provat físicament a pública fins a comprovació real. Reimportació sense duplicats pendent de prova específica.
- Incidència [#116](https://github.com/ebarlabe-art/freya-travel/issues/116), PR #117 fusionada; cerca d'ubicacions individual en preparació per a main, sense recarregar el PDF.
- **Nova mancança física observada:** activitats desades sense ubicacions, ni distàncies ni diagnòstic de factibilitat.
- **Diagnòstic al codi:** `domain/import-itinerary-text-extractor.mjs` no genera camps de lloc; `domain/import-itinerary-write.mjs` sí els admet però arriben buits. Geoapify `place-resolution` existeix per a briefs/propostes, no per a `trip_itinerary_items`. `trip-transfer-estimate` només produeix una aproximació de cotxe entre textos i no està connectat al planning; no equival a una ruta real.
- **Següent feina P0:** [#118 — ubicacions i viabilitat](https://github.com/ebarlabe-art/freya-travel/issues/118). **A2.12 preparant PR** des de `main`: proposta automàtica agrupada per dia a partir dels títols existents, cerca Geoapify pública i confirmació explícita en bloc de només `location_name`. Sense reimportació, duplicats, coordenades inventades ni automodificacions. Circuit breaker en fallades de servei, límit de 20 consultes i resultats reutilitzats. **No donar per feta fins CI verda i deploy de GitHub Pages.** Següent: trajectes/viabilitat realista.

## Camí crític Bolonya (per ordre)

| Prioritat | Funció | Estat de comprovació |
| --- | --- | --- |
| P0 | Importar itinerari i confirmar-ne les activitats | **Validat en prova física a iPhone** i PR #117 a main; pendent comprovació a pública i reimportació sense duplicats |
| P0 | Recuperar/confirmar ubicacions dels elements importats; trajectes i viabilitat honestos | Pendent; issue #118, dividir en dues entregues |
| P0 | Crear viatge de Bolonya i compartir-lo amb les amigues amb permisos per viatge | Pendent de prova específica multiusuària |
| P0 | Revisar l'agenda compartida, edicions i coherència entre mòbils | Pendent de prova específica multiusuària |
| P1 | Documents/reserves, accés a l'itinerari i ús real al telèfon | Existeixen fluxos, cal comprovació específica per Bolonya |
| P1 | Avisos abans de les activitats | Ja es van fer proves després d'Eivissa: **no reiniciar la bateria sencera**. Només regressió dirigida davant canvis o incidències reproduïbles |
| P2 | Funcionalitats noves no necessàries per al viatge | Ajornades fins a superar la prova real |

## Normes operatives

1. **Acord vigent 12–13/10: treballar sobre l'app pública, main i GitHub Pages. Deixar de fer créixer Freya PROVES.** Les PRs i tests protegeixen la publicació; no obrir una segona línia de desenvolupament ni demanar noves proves repetitives a l'entorn paral·lel.
2. **Codex només quan compensi:** tasca acotada, una ronda d'implementació + com a màxim una de correcció. Investigació prèvia i tasques petites amb els altres recursos; no es pot garantir el consum concret sense informació de la quota.
3. **Sessions compactes:** triar una única fita per sessió; registrar què s'ha canviat, què s'ha validat i què queda. Evitar haver de repetir proves ja completades.
4. **Publicar a la pública els canvis aïllats i validats** per PR amb CI; cap migració, escriptura directa de dades ni alteració d'Edge Functions per inèrcia. Les funcions que fallen als tests no es fusionen.
5. **Si el xat canvia**, obrir aquest fitxer, l'issue #116 i les últimes PR abans de plantejar feina nova.

## Historial de decisions

- 12/10: #113 importació lectura, #114 reparació dates, #115 flux de desament fusionades; la prova iPhone mostra un error posterior a la fusió.
- 12/10: error de botó identificat, correcció petita en branca `fix/a2-9-iphone-import-save-20261012`. **Encara no es pot afirmar que funcioni al telèfon.**

- 13/10: confirmació física a PROVES que les activitats de Riga es desen. Detectat que les ubicacions arriben buides i que encara no hi ha càlcul de trajecte/viabilitat; issue #118. No tornar a importar les 13 activitats com a solució.

- 13/10: decisió de concentrar desenvolupament a la pública. A2.9/#117 fusionada. A2.10 cerca manual és una alternativa, no substitueix l'extracció automàtica de llocs. A2.11/#120 bloquejada per error real de servei a PROVES i CI fallida: NO publicar-la a main fins corregir i passar tests.

- 13/10 tarda: A2.12 preparació d'una única PR de propostes de llocs a l'app pública, corregint el flux A2.11 fallit: no depèn d'Open-Meteo PROVES, millora presentació, atura cerques si proveïdor cau i evita regenerar/duplicar activitats. No repetir proves prèvies d'Eivissa. Pendent CI i fusió.

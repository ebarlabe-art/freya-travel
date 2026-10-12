# Freya Travel — Estat únic i següent pas

**Actualització:** 13 octubre 2026. **Objectiu immediat:** beta amb amigues a Bolonya, cap al 27/10/2026.

> Font de veritat operacional. Actualitzar **en cada PR fusionada**, no recrear-la en xats nous. Separar sempre: codi implementat, tests automatitzats, comprovació física i publicació. No donar mai una funcionalitat per validada només perquè hi ha una PR fusionada.

## Estat de la prova física (13/10): desament desbloquejat

- **Verificat a iPhone / Freya PROVES:** les activitats del PDF de Riga s'han **afegit** al planning després de confirmar. Correcció provada en ús real.
- **No comprovat encara:** reimportació sense duplicats, paritat amb la versió pública ni fusió de la PR #117. No afirmar «acabat en producció».
- Incidència [#116](https://github.com/ebarlabe-art/freya-travel/issues/116); PR en esborrany [#117](https://github.com/ebarlabe-art/freya-travel/pull/117).
- **Nova mancança física observada:** activitats desades sense ubicacions, ni distàncies ni diagnòstic de factibilitat.
- **Diagnòstic al codi:** `domain/import-itinerary-text-extractor.mjs` no genera camps de lloc; `domain/import-itinerary-write.mjs` sí els admet però arriben buits. Geoapify `place-resolution` existeix per a briefs/propostes, no per a `trip_itinerary_items`. `trip-transfer-estimate` només produeix una aproximació de cotxe entre textos i no està connectat al planning; no equival a una ruta real.
- **Següent feina P0:** [#118 — ubicacions i viabilitat](https://github.com/ebarlabe-art/freya-travel/issues/118). Primer completar ubicacions de les activitats **ja desades**, sense tornar a importar ni inventar llocs; després trajectes per mode de transport i advertiments segons horaris, durades i marges, amb «dades insuficients» quan pertoqui.

## Camí crític Bolonya (per ordre)

| Prioritat | Funció | Estat de comprovació |
| --- | --- | --- |
| P0 | Importar itinerari i confirmar-ne les activitats | **Validat el desament a iPhone PROVES**; pendent reimportació sense duplicats i fusió a pública |
| P0 | Recuperar/confirmar ubicacions dels elements importats; trajectes i viabilitat honestos | Pendent; issue #118, dividir en dues entregues |
| P0 | Crear viatge de Bolonya i compartir-lo amb les amigues amb permisos per viatge | Pendent de prova específica multiusuària |
| P0 | Revisar l'agenda compartida, edicions i coherència entre mòbils | Pendent de prova específica multiusuària |
| P1 | Documents/reserves, accés a l'itinerari i ús real al telèfon | Existeixen fluxos, cal comprovació específica per Bolonya |
| P1 | Avisos abans de les activitats | Ja es van fer proves després d'Eivissa: **no reiniciar la bateria sencera**. Només regressió dirigida davant canvis o incidències reproduïbles |
| P2 | Funcionalitats noves no necessàries per al viatge | Ajornades fins a superar la prova real |

## Normes operatives

1. **Freya PROVES és entorn d'assaig**, no una segona app per evolucionar indefinidament. Després de validar, integrar ordenadament a la pública.
2. **Codex només quan compensi:** tasca acotada, una ronda d'implementació + com a màxim una de correcció. Investigació prèvia i tasques petites amb els altres recursos; no es pot garantir el consum concret sense informació de la quota.
3. **Sessions compactes:** triar una única fita per sessió; registrar què s'ha canviat, què s'ha validat i què queda. Evitar haver de repetir proves ja completades.
4. **No tocar producció** o fer migrations/Edge Functions per inèrcia. Fer PR i tests, revisió, validació en entorn de proves i publicació controlada.
5. **Si el xat canvia**, obrir aquest fitxer, l'issue #116 i les últimes PR abans de plantejar feina nova.

## Historial de decisions

- 12/10: #113 importació lectura, #114 reparació dates, #115 flux de desament fusionades; la prova iPhone mostra un error posterior a la fusió.
- 12/10: error de botó identificat, correcció petita en branca `fix/a2-9-iphone-import-save-20261012`. **Encara no es pot afirmar que funcioni al telèfon.**

- 13/10: confirmació física a PROVES que les activitats de Riga es desen. Detectat que les ubicacions arriben buides i que encara no hi ha càlcul de trajecte/viabilitat; issue #118. No tornar a importar les 13 activitats com a solució.

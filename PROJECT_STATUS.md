# Freya Travel — Estat únic i següent pas

**Actualització:** 13 octubre 2026, 18:00. **Objectiu immediat:** beta amb amigues a Bolonya, cap al 27/10/2026.

> Font de veritat operacional. Actualitzar **en cada PR fusionada**, no recrear-la en xats nous. Separar sempre: codi implementat, tests automatitzats, comprovació física i publicació. No donar mai una funcionalitat per validada només perquè hi ha una PR fusionada.

## Estat de la prova física (13/10): desament desbloquejat

- **Verificat a iPhone / Freya PROVES:** les activitats del PDF de Riga s'han **afegit** al planning després de confirmar. Correcció provada en ús real.
- **PR #117 fusionada a main el 13/10.** Pendent confirmar la publicació final de GitHub Pages; no es dona per provat físicament a pública fins a comprovació real. Reimportació sense duplicats pendent de prova específica.
- Incidència [#116](https://github.com/ebarlabe-art/freya-travel/issues/116), PR #117 fusionada; cerca d'ubicacions individual en preparació per a main, sense recarregar el PDF.
- **Nova mancança física observada:** activitats desades sense ubicacions, ni distàncies ni diagnòstic de factibilitat.
- **Diagnòstic al codi:** `domain/import-itinerary-text-extractor.mjs` no genera camps de lloc; `domain/import-itinerary-write.mjs` sí els admet però arriben buits. Geoapify `place-resolution` existeix per a briefs/propostes, no per a `trip_itinerary_items`. `trip-transfer-estimate` només produeix una aproximació de cotxe entre textos i no està connectat al planning; no equival a una ruta real.
- **A2.12 incorporada a `main` (commit `3955a439`, 13/10):** propostes agrupades de llocs amb confirmació explícita, sense reimportar ni duplicar. La fusió no equival a prova física en la PWA pública.
- **A2.13 — PR [#123](https://github.com/ebarlabe-art/freya-travel/pull/123) oberta:** conservar `Lloc`, `Adreça` i `Ciutat` quan són etiquetes explícites immediatament posteriors a l'activitat en PDFs transcrits, amb proves específiques al control obligatori de CI. **No desplegada ni fusionada**; el codi s'utilitza des de l'Edge Function `import-itinerary`, que requerirà desplegament propi després de la validació. Això només afecta futures importacions, no les activitats ja desades.
- **Següent P0 després d'ubicacions:** trajectes i viabilitat realista per a Bolonya, [#118](https://github.com/ebarlabe-art/freya-travel/issues/118), sense estimacions fictícies.

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

- 13/10 tarda: A2.12 incorporada a `main`: propostes agrupades sense reimportar. A2.13 oberta en PR #123 per preservar etiquetes explícites de lloc des del PDF; pendent CI, revisió i desplegament d'Edge Function. No repetir proves prèvies d'Eivissa.

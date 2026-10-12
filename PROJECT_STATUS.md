# Freya Travel — Estat únic i següent pas

**Actualització:** 12 octubre 2026. **Objectiu immediat:** beta amb amigues a Bolonya, cap al 27/10/2026.

> Font de veritat operacional. Actualitzar **en cada PR fusionada**, no recrear-la en xats nous. Separar sempre: codi implementat, tests automatitzats, comprovació física i publicació. No donar mai una funcionalitat per validada només perquè hi ha una PR fusionada.

## Propera prova (P0): importar i aprovar itinerari

- Prova física Riga amb PDF: IA extreu 14 candidats, 13 seleccionats, 2 avisos; dates reconegudes.
- **Fallada observada:** botó «Desar activitats seleccionades» inoperatiu; cap activitat afegida.
- **Causa identificada al codi:** `renderItineraryImportPreview()` es crida amb `state.busy=true`; el `finally` allibera `state.busy` però no torna a renderitzar/habilitar el botó.
- **Correcció en revisió:** reactivar el botó al final; confirmació integrada a l'app (no `window.confirm` tardà); proves de regressió; versió de cache PWA.
- Incidència de seguiment: [#116](https://github.com/ebarlabe-art/freya-travel/issues/116).
- **Definició de «fet»:** CI verda + comprovació a la PWA física amb 13 candidats, confirmació, persistència al planning, cap duplicat. Fins llavors és «pendent de validar».
- **Prohibició:** cap inserció sense confirmació, ni modificació d'activitats preexistents. No confondre `PROVES` i `main`.

## Camí crític Bolonya (per ordre)

| Prioritat | Funció | Estat de comprovació |
| --- | --- | --- |
| P0 | Importar itinerari i confirmar-ne les activitats | Bloquejat en prova física; correcció en revisió |
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

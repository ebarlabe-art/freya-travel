# Fase A-01 · Fronteres i primera extracció

Base verificada: `main` remot `b1c2c764454c0e5d6dd39360bfbd7d37ffa5104e` (PR #214 i #215). Document de contractes, no roadmap alternatiu. Estat: proposta de branca, no desplegada.

## Fronteres actuals

| Capa | Responsabilitat i límit actual |
| --- | --- |
| Nucli | `index.html`: arrencada, sessió, viatge actiu, navegació i cicle de vida. No hi ha un router únic; es preserven els camins històrics. `404.html` és una còpia generada. |
| Domini | Identitat, proposta, conciliació i viabilitat a `domain/`. El nom de la carpeta no garanteix puresa: alguns fitxers encara contenen UI o persistència. Les regles no han de dependre de la presentació. |
| Coordinació | `index.html` i coordinadors existents: carregar fonts, executar motors, gestionar revisió i invocar el writer. Renderitzar no autoritza desar. |
| Presentació | HTML i mòduls `*-ui`: controls, missatges i estat visual. Poden consumir regles, però no ser-ne l'única ubicació. |
| Adaptadors | Supabase/Auth/RPC/Storage/Realtime, IndexedDB, IA, mapes i Railway. No se substitueixen ni es reconfiguren en A-01. |

## Garanties que no es poden alterar

- **Sessió i viatge:** mantenir identitat d'usuari/viatge, generacions, invalidació de respostes antigues i cancel·lació en canvi real de context. No compartir esborranys entre comptes o viatges.
- **Permisos:** continuar verificant pertinença i RLS al servidor. Cap decisió de UI substitueix autorització. Londres conserva el seu camí separat.
- **Conciliació:** proposta local fins a confirmació explícita; mateixa RPC atòmica, versions esperades, conflictes de concurrència i claus d'idempotència. No alterar reserves, documents, passatgers ni vincles protegits.
- **Esborranys:** mantenir persistència, abast, caducitat i recuperació existents; no introduir un estat alternatiu.
- **Offline:** preservar lectura, snapshots i vault existents; no assumir escriptura offline universal ni permisos remots indefinits.
- **PWA:** mateixa entrada, paritat exacta, recursos empaquetats i precache coherents, recuperació de càrrega i compatibilitat de versions. Els tests de navegador utilitzen dades sintètiques i serveis interceptats.

## Única extracció de codi

`classifyReconciliationTiming(values = {})` es trasllada literalment de `import-itinerary-reconciliation-ui.mjs` a `import-itinerary-reconciliation.mjs`, domini ja existent i distribuït. El motor `import-itinerary-planning.mjs` l'importa directament del domini. La UI la consumeix i la reexporta per conservar l'API anterior.

Sense canvis d'algoritme, normalització, expressions regulars, coerció ni retorn `{is_optional, is_tentative}`. Una hora «a confirmar» continua activant també la condició opcional; no es corregeix ni s'amplia aquest contracte en una extracció. No hi ha noves dependències ni nous recursos de domini.

Els tres mòduls afectats ja figuren a `scripts/package-pages.mjs` i `sw.js`; no cal ampliar les llistes. Cache v52 → v53 perquè una futura publicació autoritzada renovi els recursos modificats. No canvia la política del SW ni el marcador funcional del frontend. Un client completament antic conserva el comportament antic equivalent. La reexportació preserva l'entrada pública; no constitueix una garantia general d'atomicitat entre tots els recursos d'un desplegament.

## Validació i límits

- Equivalència amb la base remota: cos de funció idèntic i 144 combinacions títol/notes amb resultat idèntic. Suite completa local: 931/931.
- Caracterització prèvia: 23/23 tests existents de conciliació UI i RIG04; els mateixos 23/23 després de moure la regla.
- Regressió específica: frases opcionals i orientatives en títol/notes, accents, majúscules, espais, límits de paraula, valors absents, coerció i precedència; identitat de la reexportació i absència de dependència de planning cap a `*-ui`.
- Verificació dels registres de packaging/precache i del build real; suite completa i regressions Chromium/WebKit. Els resultats finals s'han de consultar a la PR i la CI del commit revisat.
- Aquesta tasca no acredita un desplegament ni substitueix la validació funcional física pendent del PDF a l'iPhone. No executa migracions ni invoca proveïdors reals.

## Riscos residuals, reversió i següent pas

La coordinació global, les dependències de presentació d'altres mòduls i les llistes manuals de recursos continuen existint; no s'amplia l'abast per resoldre-les. La publicació futura encara necessita un conjunt coherent de recursos i comprovació PWA.

Reversió abans de desplegar: revertir aquesta PR. Si ja s'hagués publicat amb autorització, restaurar els tres mòduls anteriors en un nou commit i avançar la versió de caché (no reutilitzar una caché antiga); reconstruir, comprovar paritat i publicar només amb autorització. Cap rollback SQL ni canvi de dades.

Següent extracció recomanada, en una PR pròpia: estudiar i traslladar `proposeUnmatchedReconciliationDecisions` al domini, amb el seu predicat d'elegibilitat i proves de no-mutació, abans de canviar els imports de flash/planning UI. No executar-la en A-01 ni ampliar les regles de coincidència.

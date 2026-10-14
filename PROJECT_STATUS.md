# Freya Travel — Release Bolonya

**Actualització: 14/10/2026. Tauler únic: [issue #132](https://github.com/ebarlabe-art/freya-travel/issues/132).** Objectiu: una sola Freya pública preparada per al viatge de Bolonya. No es declara preparada fins a superar l’arrencada física i el circuit compartit entre dues usuàries. Dates reals del viatge pendents de confirmar; no inventar-les.

## Porta de sortida immediata: PWA instal·lada

- Base auditada `main` **44146db**, inclou PR #129 (agenda parcial) i #130 (diagnòstic v20). Segons la prova de l’usuària recollida a #132, Safari iPhone mostra les 13 activitats de Riga (7+6), però la icona «Freya Nova» s’atura a l’arrencada. Pages SUCCESS no valida standalone.
- **Fase 1 en branca `codex/issue-132-pwa-bootstrap`, pendent de fusió/publicació autoritzades.** Recuperació del programa/SDK en cache davant HTTP 503 i connexions pendents, bootstrap anterior al SDK amb etapes acotades, reintent des de la mateixa icona i actualització del worker independent del script principal. No s’esborren caches de l’entrada antiga, esborranys ni sessió. Manifest/start_url i RLS intactes; cap Edge Function ni migració requerida.
- Reproducció: WebKit normal obre login; no hi ha evidència per atribuir al telèfon un error de sintaxi concret. Les fallades injectades de SDK, inicialització, parse i sessió pendent ara ofereixen recuperació. El worker anterior retornava HTTP 503 en lloc de la còpia en cache i no tenia límit d’espera de xarxa. Això es corregeix, sense afirmar que fos l’única causa de la icona real.
- Proves obligatòries: suite completa, paritat, build, Chromium/WebKit a 390 px i iPad amb identificació d’escriptori, sessió desada/no desada, 13 plans sintètics 7+6, reintent sense pèrdua local i upgrade de SW v18/v19/v20. Resultats finals i CI al cos de la PR; detalls a [docs/PWA_BOOTSTRAP.md](docs/PWA_BOOTSTRAP.md).
- **Única prova física pendent (Eva, després d’autoritzar i publicar aquesta PR):** obrir la mateixa icona existent i entrar a Riga + Tallin → Itinerari; confirmar 7 activitats el 27/12, 6 el 28/12 i reobertura després de suspendre. No crear cap altra icona, reimportar ni editar Riga.
- Les icones sobrants **no s’eliminen ara**. Abans de proposar-ne retirar una: identificar l’entrada, comprovar fotos/documents locals i esborranys pendents, obtenir-ne còpies recuperables i l’autorització explícita de l’Eva. No prescriure esborrar dades de Safari.

## Estat acreditat del producte i de producció

| Peça | Repositori | Producció / comprovació física |
| --- | --- | --- |
| Agenda parcial i duplicats | PR #129 a main; fonts independents, avís/reintent, accés als plans desats | Safari iPhone mostra 13 plans segons #132; PWA instal·lada pendent |
| Crear i compartir viatge | PR #126 a main; RPCs `create_trip_with_stops_v1`, `join_trip_v2`, RLS i proves SQL | Circuit entre amigues a iPhone pendent |
| Importar PDF/foto i confirmar | Flux existent, revisió humana, desament idempotent | `import-itinerary` **ACTIVE v2**; dades Riga ja existents, no tocar-les |
| Propostes de llocs contextuals | A2.12/PR #122 a main; confirmació de `location_name` | `place-resolution` **ACTIVE v1**; 13 llocs de Riga buits segons #132, no modificar automàticament |
| Trajectes entre visites | PR #127 a main; `walk/drive/transit`, font/incertesa i viabilitat conservadora | `itinerary-route` **ACTIVE v1**, `trip-transfer-estimate` **ACTIVE v2**; circuit real i quota/secret de Routing pendents de validació no intrusiva |
| Inspiració / visites desitjades | `travel-builder`, `proposal-engine`, `travel-search` existents | `proposal-engine` **ACTIVE v8**, `travel-search` **ACTIVE v7**; integració vertical cap a la mateixa agenda pendent |
| Mencions explícites de llocs al document | PR #123 separada; la issue informa de conflictes | No fusionar-la així; revisar/cherry-pick net o equivalent en fase 2; canvi d’Edge Function requereix desplegament autoritzat separat |

Metadades de funcions **contrastades per lectura el 14/10/2026** a `otueskpksylzvkhldoft`, sense llegir viatges ni secrets. ACTIVE acredita existència/versió, no equivalència del codi, secret correcte ni circuit validat. L’afirmació anterior «itinerary-route no desplegada» era obsoleta. Freya PROVES no forma part d’aquesta release.

## Després de l’arrencada: 1–3 PRs verticals ordenades

1. **Importació → llocs → ruta → edició:** conservar revisió/confirmació i identitat dels plans; aprofitar mencions explícites i resolució contextual existent. Provar dos dies sintètics, amb ubicacions buides/ambigües, recàlcul de parelles afectades i cap duplicat. Reutilitzar la mateixa agenda `trip_itinerary_items`.
2. **Visites desitjades / Inspira’m → proposta revisable → mateixa agenda:** reutilitzar Builder/propostes/cerca, acceptació parcial, cap persistència no acceptada; no crear segon planificador. Concretar el contracte després d’auditar aquests fluxos.
3. **Circuit Bolonya amb dues usuàries:** crear amb dates confirmades, importar o inspirar, confirmar llocs, editar hora/lloc i comprovar nou càlcul, convidar amiga, lectura i edició permesa amb RLS/refresc. Prova física amb Eva i amiga després de CI i publicació autoritzada, idealment ≥48 h abans del viatge.

## Governança

Branques/PRs independents; cap merge, publicació, desplegament de funcions ni migració sense autorització. No tocar dades de Riga ni Freya PROVES. Preservar canvis locals aliens. No reobrir avisos ja comprovats a Eivissa llevat d’una regressió concreta. En cada entrega: què pot fer ja l’usuària, proves exactes, què falta, desplegament necessari i responsable de validació. L’historial tècnic continua a Git i a les PRs; aquest fitxer mostra només l’estat vigent.

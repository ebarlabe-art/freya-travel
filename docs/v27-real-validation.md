# V27 — estat per publicar a Freya Travel pública

Revisió: 17/10/2026. Objectiu: Bolonya, 23/10/2026.
**Publicació bloquejada per còpia de dades i recuperació encara no acreditades.**
Cap migració, desplegament, fusió ni canvi de dades remot executat.

| Comprovació | Resultat i límit |
|---|---|
| Esquema públic actual | PASS: 62 taules, 116 funcions, 55 taules públiques amb RLS; les dues columnes, funció, constraints i triggers v27 encara no existeixen. |
| Compatibilitat additiva | PASS de revisió de catàleg i execució prèvia local. Dues taules petites (96/128 KiB, estimacions de 15/64 files); no backfill, substitució de dades ni polítiques noves. Aplicació real pendent d'autorització. |
| Build i regressions | PASS anteriors: [PR checks 39032722155](https://github.com/ebarlabe-art/freya-travel/actions/runs/39032722155), inclou build públic, Chromium/WebKit, reserves, documents, PDF/rutes i migració. Les comprovacions addicionals d'aquesta revisió s'indicaran al final. |
| Supabase local real | PASS anterior: [39032720416](https://github.com/ebarlabe-art/freya-travel/actions/runs/39032720416): restauració, Auth, RLS, concurrència i PDF a Storage amb usuaris sintètics. No és prova de la pública. |
| Edge Functions actuals | PASS: quatre ACTIVE i verify_jwt=true. Comparació de fonts: import-reservation v5 és idèntica; cal actualitzar import-itinerary v6, place-resolution v1 i itinerary-route v1. |
| Codi per recuperar Edge | PASS: quatre fonts desplegades guardades localment amb versions, verify_jwt i SHA256 per fitxer. No inclou secrets ni acredita una restauració desplegada. |
| Frontend per recuperar | Commit publicat d7fee2f307b80bc621392465da67b6a5a6a6a182, desplegament correcte 38813083232. Artefacte ja no disponible; s'afegeix reconstrucció del commit anterior al CI existent. No s'ha publicat una reversió. |
| Còpia de base de dades | BLOQUEJAT: no s'ha aportat una còpia recent amb recuperació acreditada; organització Free, no pressuposem backup diari. Sense connexió PostgreSQL configurada ni eina de backup al connector. |
| Login, viatges i documents públics | PENDENT amb compte autoritzat al dispositiu; no s'han llegit files personals ni utilitzat sessions de producció. |
| PDF real de Bolonya / iPhone físic | PENDENT: document i dispositiu no disponibles en aquesta execució. OCR/proveïdor real, geocodificació i rutes reals encara no acreditats. |

## Què queda exactament

1. Obtenir i custodiar una còpia consistent recent; verificar que es pot recuperar. Vegeu [procediment](v27-production-release.md). La còpia d'esquema anterior no conté dades i no substitueix aquest requisit.
2. Confirmar pressupost/quotes disponibles dels proveïdors existents i presència de les variables requerides, sense llegir-ne ni compartir-ne valors.
3. Comprovar login i lectura dels viatges/documents existents des del compte de l'usuari, sense alterar-los; tancar els checks de la branca.
4. Només llavors, autorització expressa per a UNA migració, TRES funcions i frontend públic. No fer merge abans: main publica automàticament.
5. Després de publicar, prova curta amb reserva/PDF controlats i PDF real de Bolonya a Safari i PWA. Aturar i revertir si hi ha regressió.

## Termini, risc i decisió

Un cop disponible la còpia verificada i resolts els accessos: estimació de 2–4 hores de feina efectiva per tancar comprovacions, publicar amb autorització i fer la prova física. No és una data garantida; depèn de la còpia, credencials configurades de manera segura, dispositiu i disponibilitat de l'usuari. És raonable completar-ho abans del 23/10 si aquests requisits es resolen aviat; objectiu de prova el mateix dia i marge fins al 22/10 per incidències.

Risc de migració baix pel canvi nullable sense backfill; existeix un bloqueig breu de les dues taules, limitat per lock_timeout. Risc funcional moderat per extracció del PDF, disponibilitat/quotes externes i actualització PWA. Les coincidències dubtoses han de quedar pendents i els horaris/reserves no s'han de reescriure. Risc de recuperació inacceptable mentre no hi hagi còpia comprovada. No cal Pro, projecte nou, Cloudflare ni servei nou. Els proveïdors existents poden consumir crèdits/quotes amb les proves reals; no s'han fet peticions facturables ara.

La prova a l'iPhone quedarà preparada per executar després de la còpia, els checks i l'autorització de publicació. **Encara no se sol·licita autorització per publicar.**

## Incidències resoltes en aquesta revisió

- S'han retirat els 39 artefactes d'entorns independents i les referències al procés de contractació de Pro.
- S'han corregit anotacions de tipus dels handlers reals, sense canviar JWT ni la lògica d'importació.
- S'ha detectat i corregit la reutilització de resultats de llocs antics sense locality durant fins a 24 hores. La nova clau de consulta evita aquest problema sense esborrar dades/tokens ni alterar la base de dades. Prova local: 22/22, incloent actualització de memòria cau i reutilització sense crides duplicades al proveïdor.
- Checks de la primera revisió de publicació: PASS [39036399861](https://github.com/ebarlabe-art/freya-travel/actions/runs/39036399861), 726 tests, build públic, reconstrucció del commit anterior, clau/destí del dist, typechecks i regressions Chromium/WebKit. Pendent de repetir les proves amb la correcció de memòria cau abans de tancar el candidat.

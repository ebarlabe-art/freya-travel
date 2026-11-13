# fix: persistir identitat geogràfica entre planning, rutes i guia (#228)

**[PR #229](https://github.com/ebarlabe-art/freya-travel/pull/229), DRAFT contra main. Push i creació autoritzats expressament el 13/11/2026. No fusionar ni desplegar.**

Una ubicació seleccionada al formulari manual només desava el nom i els triggers podien esborrar una selecció existent quan canviava la descripció. A més, l'editor comprovava només un id afectat i els consumidors de mapa/rutes/guia no recuperaven el mateix conjunt de punts. La correcció conserva identitats de proveïdor vigents, verifica el snapshot real retornat i reutilitza una lectura comuna, mantenint la correcció de Saint-Bertrand de #227.

Refs #228, #226. No tancar automàticament: falta validació live/iPhone.

## Canvis

- Selecció completa de lloc al formulari manual, conservada a l'esborrany; CAS i verificació del valor desat. Els punts no afectats es conserven.
- Lector únic de punts ordenats/legacy per editor, mapes, guia i rutes; respecte de retirades explícites i snapshots obsolets. Identitat cultural independent del nom descriptiu.
- Poble i restaurant explícits com a consultes separades; suport de pobles i espais naturals representatius amb filtres de context, noms i homònims. No inventa llocs ni equipara el centre d'un bosc amb un accés exacte.
- Migració nova, sense backfill ni canvis RLS/privilegis, que preserva llocs ja confirmats davant d'edicions descriptives. Els triggers anteriors, verificats en READ ONLY, reproduïen la invalidació.
- Cache v60; paritat index/404. No altera dates, reserves, documents, fotografies ni dades reals.

## Validació local

- **968/968 tests Node**, cap error ni omissió; build, paritat i verificació del paquet correctes.
- Postgres descartable amb migracions i RLS reals: invalidació antiga reproduïda, nou contracte de preservació, retirades, pendents, CAS, membres/aliens/anon, camps originals. Proves de la guia cultural també correctes.
- Chromium: PDF → revisió → importació confirmada → selecció de Saint-Bertrand/Luchon/Carlac i àpat al poble → guia; formulari manual → ubicació → tancament/reobertura de Postgres en disc → recàrrega PWA → mapa i guia. El proveïdor i el wrapper d'importació són simulats; no és PostgREST real.
- Chromium: regressions de Londres/Eivissa/Bolonya, punts ordenats, rutes, automatismes, guia/audioguia, navegació, offline/recàrrega i bootstrap de caches v18–v59 a v60, correctes.
- WebKit local **bloquejat**: descàrrega HTTP403 per la política de xarxa. La matriu Chromium/WebKit segueix a CI i executarà també la persistència local, els resultats del SHA actual s’han de consultar a la PR. El bloqueig anterior de push queda substituït per l’autorització específica del 13/11/2026.

## Pendents i publicació

Entorn Supabase/proveïdors live de prova no configurat en aquest executor. Geoapify, fonts Wikimedia i generació real continuen pendents; no s'ha fet servir producció com a banc de proves. Validació física d'iPhone/PWA, suspensió/reobertura, sincronització de dos membres i veus necessària abans de declarar resolta la incidència.

Només amb autorització específica: aplicar `20261113124532_preserve_confirmed_activity_geography.sql`, actualitzar els bundles `cultural-guide` i `itinerary-route` amb el domini compartit i després publicar el frontend v60. Cap d'aquests passos s'ha executat. No hi ha canvi d'API ni privilegis nous; còpies anteriors i reversió descrites a l'auditoria.

Diagnòstic complet, evidència remota de només metadades, antecedents Londres/Eivissa, altres incidències i procediment de reversió: [location-identity-228-audit.md](location-identity-228-audit.md).

# V27 — ubicacions automàtiques i trajectes

Branca: `fix/automatic-itinerary-places-v27`. Destinació de la PR: `main`, la branca pública. Cap fusió, migració remota, desplegament ni canvi a Freya Nova/Proves forma part d'aquesta entrega.

## Comportament

En obrir un dia de l'agenda, Freya reutilitza la cerca existent de `place-resolution` per enriquir tant el planning manual/importat com les activitats de `trip_activities`. Després de confirmar la importació habitual del document, no cal tornar a confirmar cada ubicació fiable. La proposta d'importació continua sent de només lectura fins que es desa explícitament.

L'assignació automàtica exigeix nom complet coincident, coordenades exactes dins de rang, ciutat coincident i país ISO acreditat per les destinacions del viatge. En un viatge amb diverses destinacions s'utilitza la ciutat explícita de l'activitat o, si falta, dues activitats adjacents del mateix dia que indiquin explícitament la mateixa ciutat. Els trasllats, vols, canvis de dia o desacords impedeixen aquesta inferència. No s'utilitzen la ubicació del telèfon ni coordenades generades per IA.

Els noms compostos de Londres es conserven complets durant l'extracció del PDF. Les coincidències desconegudes, aproximades, homònimes o sense context queden pendents en el selector existent. Els carrers, adreces explícites i àlies que no coincideixen amb el nom verificat requereixen revisió; no es força una coincidència. Les consultes continuen limitades a 30 per sessió de viatge i es comparteixen els resultats repetits. Un error del proveïdor atura la cua fins al reintent.

`resolved_location` conserva la geografia, identificador del proveïdor, atribució i snapshot dels camps de lloc originals. No substitueix un nom, adreça o ciutat ja introduïts. Un trigger invalida aquest snapshot quan es corregeix el títol o el lloc. Les coordenades existents de les activitats tenen prioritat i queden excloses de l'enriquiment. Cada escriptura comprova viatge, registre, revisió `updated_at` i nom original; les polítiques RLS existents continuen governant l'accés.

Les rutes reutilitzen `itinerary-route` i Geoapify Routing, les coordenades desades i les barreres entre tipus d'activitats. El mode inicial és a peu; l'usuari pot triar cotxe o transport públic. Temps i distància provenen del servei. Un conflicte entre el temps de trajecte i l'horari es mostra automàticament; el marge addicional és opcional. «Consulta el trajecte al mapa» obre Google Maps amb els punts i el mode verificats; Google pot proposar una ruta diferent. Freya no canvia hores, dates, reserves, documents ni activitats.

La PWA passa a `pwa-automatic-places-v27` / cache `freya-travel-release-6444-v27`; `404.html` es genera amb `entries:sync`.

## Publicació a la pública

La destinació és el projecte públic existent Londres-2026. No es crea cap aplicació, projecte Supabase o subscripció.
Vegeu [estat verificat i bloquejos](v27-real-validation.md) i [procediment de còpia, publicació i reversió](v27-production-release.md).

L'ordre és: còpia recuperable acreditada → comprovacions → autorització expressa → única migració additiva → tres Edge Functions compatibles → frontend GitHub Pages → prova física amb el PDF real de Bolonya.
import-reservation es conserva perquè la font desplegada coincideix. import-itinerary s'actualitza també perquè el bundle inclou el mòdul d'extracció PDF modificat.
No executar baselines, migracions històriques, wrappers de validació ni configuracions d'un altre projecte.

Les regressions automatitzades inclouen build complet, paritat index/404, Chromium/WebKit, preservació d'horaris i reserves, RLS i concurrència. Les proves físiques, login públic i proveïdors reals queden distingits al registre de resultats.

# #176 · Itinerari i Activitats

Estat: implementació en branca `fix/176-unified-itinerary-activities`, basada en `main` `678d8d007eed89448b6201173ac797b53cd7e360`. No acredita desplegament ni canvis a dades reals.

## Contracte

«Activitats» és una vista de lectura de la mateixa agenda (`normalizedItineraryProjection`). Inclou les activitats operatives i tots els plans manuals/importats, també sense reserva, entrada, cost, document, lloc o hora. La importació PDF continua escrivint només a `trip_itinerary_items` després de la confirmació existent. No hi ha còpia, migració, backfill, sincronització entre taules ni escriptura en obrir Activitats.

Identitat: `manual:<id>` o `activity:<id>:start`, exactament com al planning. Una clau apareix una vegada. Les activitats de transport operatives segueixen al mòdul de Transport local. Dues files independents amb el mateix títol no es fusionen ni s'eliminen per heurística: el nou flux no crea aquestes duplicitats i conserva les dades existents.

Cada peça té una sola font canònica. Les reserves mantenen el formulari d'activitat, les relacions de reserva/entrada opcionals i els controls existents. Els plans manuals ofereixen «Veure / editar al planning», que selecciona el dia o Pendents i enfoca la peça original. L'edició, eliminació, Fet/Desfer, documents, llocs i fotos continuen sota els contractes de la seva font. L'edició manual conserva el filtre de viatge, ID i `updated_at`; un conflicte no se sobreescriu silenciosament. No es converteix el pla en reserva.

`trip_itinerary_items` no té tipus persistent. Els títols explícits d'àpat o trasllat reben una etiqueta de presentació; la resta diu «Visita o pla de l’itinerari». Tots continuen visibles, sense inferir que una reserva o pagament defineixi una visita. Aquestes etiquetes no alteren dades ni classificació persistent i no amaguen plans amb noms ambigus. Els sis tipus temporals existents es projecten amb les mateixes dates/zones/franges i incertesa que l'itinerari.

## Estat, permisos i navegació

- Es reutilitzen les lectures amb RLS, els marcadors d'usuari/viatge/generació i les subscripcions Realtime de l'agenda. Una recàrrega de la font actualitza també Activitats. No hi ha permisos nous ni vista SQL que pugui saltar RLS.
- La càrrega parcial es declara expressament. Es conserva la projecció disponible i es poden reintentar les fonts pendents reobrint Activitats.
- Offline reutilitza el snapshot autoritzat existent (`activityRows`, relacions i `manualItineraryRows`). No desa una segona llista. No s'afegeixen escriptures offline.
- El retorn a Activitats utilitza el context operatiu existent i el dispatcher History existent, amb un marcador acotat a usuari/viatge/generació. Back/Forward restaura la peça/dia. La recàrrega continua respectant el contracte d'entrada Home; Activitats reconstrueix la mateixa vista a partir de les fonts disponibles.
- Londres conserva `experience_key=london-2026` i les seves vistes històriques. Eivissa, Bolonya i la resta de viatges genèrics utilitzen la mateixa projecció, sense condicions per ciutat.
- Cache de shell incrementada de v39 a v40. Sense canvi de format del snapshot, backend, Edge Functions o esquema. `404.html` es genera des de `index.html`.

## Validació i límits

Executat localment amb transport sintètic i trànsit remot del navegador bloquejat:

- Suite completa: **791 proves correctes**, incloses importació/idempotència, agenda, Home, progrés, offline, navegació i cinc proves noves de projecció.
- `npm run build`, `npm run entries:check` i `node scripts/check-v27-production.mjs`: correctes.
- `check-activities-projection-browser.mjs` en Chromium: mòbil 390×844 i tauleta 1024×768 amb identificació d'escriptori. Bolonya/Eivissa/Londres sintètics, sis horaris, documents opcionals de reserva, edició explícita amb versió/ID originals, Back/Forward, retorn, reload, consulta offline/pageshow, canvi de viatge, font fallida/reintent i cap insert/upsert/delete.
- `check-itinerary-loading-browser.mjs`: correcte; inclou reobertura offline, sessió caducada, canvi d'usuari/viatge, logout, imports ja existents i dades parcials.
- `check-shared-trip-browser.mjs`: correcte; dos membres sintètics, retorn, reload, reobertura offline i layout tauleta.

La CI incorpora el nou contracte i el navegador en Chromium mòbil/tauleta i WebKit mòbil. **WebKit local pendent:** el navegador es descarrega però falten biblioteques del sistema (GTK4, Graphene, HarfBuzz ICU, Manette, Hyphen i GLES). Això no acredita Safari físic. Validació iPhone/PWA física i dos usuaris reals pendent d'autorització posterior. No s'ha usat FREYA PROVES, no s'han llegit/modificat dades productives, ni aplicat migracions, desplegat, publicat o fusionat.

Per reprendre: consultar la PR d'aquesta branca, revisar la CI (inclòs el job legacy), validar el comportament amb Product Owner i acordar la prova física abans de qualsevol publicació.

# Inventari de regressió #226 · 12/11/2026

## Incidència observada (producció, iPhone real)
- Captura: «Dinar a Sant Bertrand du Conninges a Chez Simone» obre la guia cultural, però mostra «Tria el lloc de la visita», «Cap fitxa desada» i exigeix confirmar un monument.
- L'usuària confirma que la ubicació introduïda al planning no apareix a la guia.
- Regressió reportada també en rutes i ubicacions d'itineraris importats. Londres i Eivissa funcionaven; Aran no. Encara no reproduïda instrumentalment a producció.
- #225 (CI verda amb proveïdors simulats) es va publicar, però no va cobrir aquest cas d'ús.

## Inventari de contractes i riscos
| Tram | Fitxer | Comportament / risc | Estat |
|---|---|---|---|
| Extracció de punts d'activitat | `domain/itinerary-place-points.mjs:extractActivityPoints` | Rebutja àpats genèrics (correcte), però no extreia la població explícita d'un títol «Dinar a [poble] a Chez [restaurant]». | Primera correcció PR #227; candidat pendent, sense geocodificar automàticament |
| Identitat de punt i selecció | `domain/itinerary-place-points-ui.mjs` | L'editor desa el `place` del proveïdor i substitueix el text de cerca pel nom canònic, però la selecció no equival a confirmació persistida fins a «Desa els punts». | Cal prova navegador i persistència |
| Validació d'estat desat | `domain/itinerary-place-points.mjs:savedActivityPoints` | Requereix coincidència exacta de títol, adreça, ciutat i nom de lloc; canvis de redacció poden invalidar punts confirmats. | Pendent redisseny amb procedència explícita i detecció de canvi semàntic |
| Llegat `resolved_location` | `domain/cultural-guide.mjs:culturalPlaces` | Rebutjava una ubicació de proveïdor desada quan el títol no coincidia amb el nom canònic. | Primera correcció PR #227; conserva control de fingerprint i `validPointPlace` |
| Punts ordenats `location_points` | `domain/cultural-guide.mjs:culturalPlaces` | Filtra noms no idèntics, fins i tot variants lingüístiques. | Pendent revisió segura de selecció manual versus assignació automàtica |
| Guia cultural | `domain/cultural-guide-ui.mjs`, Edge `cultural-guide` | Només prepara la guia quan existeix una identitat acceptada; l'Edge comprova fonts, noms i coordenades. Un poble o bosc ha de ser un subjecte vàlid. | Pendent proves amb fonts reals i error explicatiu si no hi ha font |
| Mapa i ruta | `domain/itinerary-place-points.mjs`, `supabase/functions/itinerary-route`, PWA | Context base de la ciutat i país pot impedir reconèixer punts transfronterers; mapes i rutes depenen de punts persistits. | Pendent comparativa amb Londres/Eivissa i prova end-to-end |
| Importació PDF | `supabase/functions/import-itinerary`, PWA | La transcripció i revisió han de conservar poblacions, visites, excursions i establiments. | Pendent prova amb PDF real i verificació d'escriptura |
| Caché / iPhone | `sw.js`, PWA | La PWA pot tenir versions diferents entre sessions; necessitem verificar recàrrega, reobertura i sincronització. | Pendent iPhone físic |

## Historial identificat
- 15–18/10: cercador ràpid i automatització de POI (`itinerary-quick-place.mjs`).
- 20/10: s'afegeix la restricció de coincidència exacta de monuments i punts geogràfics a `itinerary-place-points.mjs` (commits `7669d8a9a` i `3cd8d13c4`); **possible origen de regressió**, encara no confirmat per bisect.
- 22/10: guia cultural universal incorporada (`3068a2135`).
- 11–12/11: correcció #225, CI simulada verda; reproducció real falla a iPhone.
- 12/11: issue #226 i PR #227, primera correcció acotada.

## Condicions de tancament, no negociables
1. Seleccionar un poble (Saint-Bertrand, Luchon), espai natural (Bosc de Carlac) o monument produeix una guia general d'aquell lloc, amb aprofundiment opcional; no exigeix monument si el lloc és una població.
2. Un lloc confirmat una vegada es recupera després de desar, recarregar, tancar i reobrir l'app, sense reimportar PDF.
3. Els mapes i trajectes utilitzen el mateix lloc confirmat, amb punts transfronterers, i conserven l'ordre de visites.
4. No hi ha confusions entre homònims, ni assignacions automàtiques d'identitats dubtoses.
5. Regressions Londres, Eivissa i Vall d'Aran executades en Chromium i WebKit, inclosa una activitat de dinar a una població i una excursió a un bosc.
6. Prova amb proveïdors reals i amb iPhone físic, sense esborrar ni alterar viatges reals; si requereix interacció d'usuària, documentar el pas mínim i el resultat.
7. Cap merge ni publicació fins que les proves hagin passat i el risc sobre dades existents s'hagi avaluat.

## Restriccions
No migrar, reescriure ni esborrar dades de viatges; no tocar producció per provar hipòtesis. PR #227 és una primera correcció, no el tancament de #226.

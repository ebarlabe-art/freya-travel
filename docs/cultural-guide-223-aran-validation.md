# #223 · Aran: importació nova fins a la guia cultural

Canvis a la PR existent #225, branca `test/223-aran-new-trip-cultural-identity`. No fusionada ni publicada. No s'han consultat ni modificat viatges reals.

## Mancances verificades i correcció

- La guia sense identitat només explicava que calia verificar el lloc. Ara ofereix «Confirma el lloc al planning», reutilitzant l'editor de punts existent i conservant el dia i l'activitat.
- La cerca manual de punts imposava el país/ciutat base i descartava resultats d'una altra ciutat. Ara la cerca dirigida per l'usuari no imposa aquest context. Els candidats continuen exigint concordança de nom i selecció + desament explícits. La resolució automàtica conserva els filtres estrictes de país, ciutat, identitat i ambigüitat.
- Una selecció explícita conserva el nom canònic del proveïdor al punt; una consulta «Luchon» confirmada com Bagnères-de-Luchon ja no queda bloquejada pel filtre d'identitat cultural. Títol, dates, notes i altres camps originals no canvien.
- La frase importada «Bausen i excursió al Bòsc de Carlac» extreu el bosc com a punt visitable. Es manté l'extracció de «Passeig pel bosc de Carlac» i la normalització Bosc/Bòsc.
- Una ubicació verificada antiga d'una passejada pot obrir la guia del destí extret del títol, mantenint la comprovació del fingerprint original i del nom. Una identitat diferent o obsoleta continua rebutjada.
- El planning podia substituir el botó mentre es carregaven els mòduls de l'editor. L'obertura recupera el botó actual de la mateixa activitat i sessió abans de muntar l'editor.
- Cache PWA v58 per renovar els mòduls; `404.html` regenerat des d'`index.html`.

## Validació reproduïble

`npm test`, `npm run build`, `npm run entries:check`, `git diff --check`.

Prova nova: `scripts/check-aran-cultural-flow-browser.mjs`, incorporada a les dues branques de la matriu de CI. Executar amb `PLAYWRIGHT_MODULE` apuntant a Playwright 1.63.0 i `CULTURE_ENGINE=chromium` o `webkit`.

La prova carrega la PWA compilada a 390×844 i un viatge sintètic inicialment buit amb base Arties. Selecciona el PDF sintètic versionat, revisa la proposta, confirma la importació, executa el writer real i simula el contracte de persistència i Storage. A continuació verifica:

1. Saint-Bertrand-de-Comminges, Bagnères-de-Luchon i Passeig pel bosc de Carlac arriben com tres activitats diferents.
2. El context Arties no assigna automàticament llocs francesos ni el punt representatiu del bosc a Bausen.
3. El botó de guia ofereix la verificació de l'activitat corresponent.
4. Una cerca sense filtre de país mostra dos homònims distants de Saint-Bertrand. Cercar no confirma ni genera cap guia.
5. Seleccionar i desar explícitament vincula només el punt de l'activitat correcta. La variant Luchon conserva la identitat canònica confirmada.
6. Reobrir la guia executa `prepare` del handler cultural real, amb el `source_id` i `place_key` correctes, i mostra el text de cadascun dels tres llocs.
7. Les propostes culturals continuen locals fins a revisió i desament. Els camps originals importats es conserven.

Regressions complementàries a tots dos motors: `check-cultural-guide-browser.mjs` (Bolonya, Eivissa, Londres, Activities/Itinerary, Back/Forward, errors, offline, recàrrega), `check-itinerary-points-browser.mjs`, `check-automatic-places-browser.mjs` i `check-aran-import-browser.mjs` (PDF original amb transcripció real capturada). La prova de tauleta de guia s'executa també amb `CULTURE_TABLET=1`. Totes aquestes proves han passat localment en els motors indicats. També han passat `check-v27-production.mjs` i `check-pwa-bootstrap-browser.mjs` en Chromium i WebKit, amb actualització de caches v18/v19/v20/v52–v57 a v58, recuperació HTTP 503 i arrencada offline conservant les dades locals. La primera CI va detectar expectatives v57 obsoletes als scripts de packaging/bootstrap; corregides sense afeblir els controls.

## Límits i publicació

La prova nova usa transcripció, identitats Geoapify, fonts culturals i generació sintètiques. No acredita una nova extracció IA del PDF, una consulta Geoapify/Wikimedia/model live, la disponibilitat d'articles reals per a tots tres llocs, ni Safari en un iPhone físic. Les peticions no locals i WebSocket estan bloquejades. La prova del PDF original continua separada; no es presenta la transcripció sintètica com a resposta real d'aquell PDF.

No s'han aplicat migracions ni desplegat Edge/frontend. El canvi a `domain/cultural-guide.mjs` també forma part del bundle Edge: en una publicació autoritzada cal desplegar `cultural-guide` abans del frontend perquè la compatibilitat amb ubicacions antigues sigui coherent. No hi ha cap migració nova. No utilitzar FREYA PROVES.

Següent acció: revisar CI al SHA final de #225 i demanar autorització abans de fusionar/publicar. Després de publicació autoritzada, validar un viatge nou de prova a iPhone i els proveïdors reals sense alterar viatges existents.

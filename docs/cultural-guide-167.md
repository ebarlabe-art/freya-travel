# #167 · Guia cultural escrita i audioguia universal

Implementació en branca `feat/167-universal-cultural-guide`, sobre `main` `aa30462` (PR #177 fusionada). Migració **escrita, no aplicada**; Edge Function **escrita, no desplegada**; frontend **no publicat**. Cap dada de producció modificada ni ús de FREYA PROVES.

## Reutilització i contracte

La fitxa s'obre des dels mateixos elements de `normalizedItineraryProjection` que comparteixen Itinerari i Activitats (#177), sense crear peces d'agenda ni reserves. Un diàleg manté la vista d'origen i utilitza el dispatcher History existent per a Back/Forward. Es respecten usuari, viatge i generació de càrrega; una resposta tardana no pot obrir contingut d'un altre viatge.

S'ha revisat la PR oberta #169 (`15682ca`). Es reutilitza la seva extracció `narrateCatalan()` del TTS de Londres i s'amplia amb fragments consecutius, controls i tractament d'errors. No s'importa la branca sencera: les seves modificacions d'AGENTS i la narració del resum d'un dia no són necessàries per a aquesta tasca. **#169 haurà de reconciliar el motor amb aquesta PR abans de fusionar-se**, per conservar una sola implementació de veu. No s'ha tancat ni fusionat #169. Discrepància documentada: la issue cita 12 fitxes londinenques; `main` en conté **13**. Es preserven les 13 i els seus textos.

## Identitat exacta del lloc

`domain/cultural-guide.mjs` reutilitza els punts i snapshots geogràfics vigents. Només accepta punts amb identitat de proveïdor i dades vàlides, noms concordants i snapshot d'entrada encara vigent. Ni un títol lliure, ni coordenades sense identitat, ni la simple proximitat generen una vinculació cultural. Si falta geografia fiable, es demana confirmar-la des del planning existent.

Clau persistent: `geoapify:<provider_place_id>`, única dins del viatge. Cada monument té el seu document; una visita composta permet escollir entre punts independents. Archiginnasio i Teatro Anatomico es mantenen separats, encara que comparteixin edifici/coordenades properes. Repetir la visita al mateix punt reutilitza la fitxa. No es fusionen possibles duplicats semàntics de proveïdor per heurística.

La cerca cultural utilitza articles públics de Wikipedia en català, italià o anglès i etiquetes/àlies de Wikidata. L'usuari escull l'article; abans de generar, el servidor exigeix concordança de nom/àlies i coherència geogràfica. La proximitat només descarta homònims llunyans, mai decideix per si sola. Fonts ambigües, sales confoses amb l'edifici, geografia absent o noms no concordants es rebutgen. No es guarden ni es mostren com a guia del lloc incorrecte.

## Contingut, fonts i privacitat

Document versionat en català amb sis seccions: història, context, curiositats, punts d'interès, informació pràctica i suggeriments. Les cites literals, llengua original, URL de revisió de Wikipedia i atribució CC BY-SA queden conservades. La proposta generada es valida estructuralment: cada cita ha d'existir en el text font. Si la font no acredita una dada, la secció pot quedar buida; no s'inventen horaris, preus ni accessibilitat.

**Una proposta IA no és una verificació factual.** La UI diferencia transcripcions de font, propostes pendents de contrast, text editat per membres i suggeriments. No promociona automàticament una traducció o correcció a «fet verificat». Les propostes requereixen revisió explícita de lloc i fonts abans de desar. La comprovació de cites evita cites inexistents, però no demostra que cada frase del model sigui certa: cal revisar la fidelitat del contingut abans de considerar una guia cultural validada.

`cultural-guide` rep només IDs de viatge/peça, clau de lloc, acció, llengua i ID d'article. Rebutja camps aliens. Autentica l'usuari i rellegeix la peça sota les seves RLS. La consulta de la peça usa una whitelist de camps geogràfics, sense notes, documents, codis de reserva, contactes o imports. El model rep **només nom públic del lloc, títol i text públic de l'article i llengua de la font**; tampoc rep IDs del viatge/usuari. `store:false`, host de model fix, hosts Wikimedia fixos, límits de mida/temps i límit preventiu per usuari/instància. Cap URL arbitrària ni URL signada. La generació només ocorre després d'un clic; no es desa automàticament.

L'adaptador actual cobreix Wikipedia/Wikidata; no totes les visites hi tenen article, àlies o coordenades útils. En aquest cas hi ha edició manual en català, sense fer passar el text de l'usuari per informació verificada. No s'ha validat cap resposta real del model ni la cobertura real dels cinc monuments: la bateria usa fonts i respostes **sintètiques**, i acredita la separació d'identitats i el flux, no erudició real.

## Persistència, permisos i conservació

Migració incremental `20261022133316_cultural_place_guides.sql`: `trip_cultural_guides`, RLS per membre, identitat immutable, unicitat per viatge/lloc, índexs de FK, validació del document i `revision` amb comparació de versió. Crear i editar són operacions explícites. Un conflicte conserva l'esborrany i requereix recarregar expressament la versió compartida; no hi ha sobreescriptura silenciosa. Realtime reconcilia el document o avisa del conflicte.

La fitxa és del lloc dins del viatge, no una còpia de la visita. Eliminar una visita no elimina una fitxa que es pot reutilitzar en una altra visita al mateix punt. Eliminar el viatge elimina les fitxes per FK. No s'ha introduït Storage nou ni una cua d'escriptures offline.

Fitxes i esborranys locals utilitzen el snapshot existent per compte/viatge i la concessió de consulta offline existent. Logout, canvi de compte/viatge i revocació continuen sota aquest contracte; es tanquen diàlegs i lectures. Sense xarxa es poden llegir les fitxes preparades, però no editar-les ni confirmar desaments al servidor. Una fallada de backend no es presenta com un desament correcte.

`culturalTravelBookSnapshot()` prepara una referència editorial explícita amb ID de fitxa, revisió, identitat del lloc, seccions, fonts i llicència. No captura reserves o notes operatives ni afegeix contingut automàticament a l'àlbum. La UI d'inserció al Travel Book queda fora d'aquesta tasca.

## Veu i PWA

Un sol motor TTS per a Londres i fitxes universals. La lectura no trunca els textos a 1.800 caràcters com feia la proposta de #169: usa fragments consecutius i ignora callbacks de lectures cancel·lades. Escolta, pausa, represa, aturada i velocitat 0,75–1,25; la UI exposa 0,85×, 1× i 1,15×. Un canvi de velocitat reprèn el fragment actual. Canviar lloc, viatge o vista, tancar la fitxa o editar-ne el text atura la lectura. En passar a segon pla es pausa; no hi ha autoplay en tornar.

Si les veus encara no estan carregades, es pot tornar a prémer Escolta. Si no hi ha català, l'usuari ha d'autoritzar una veu alternativa; la fitxa escrita continua disponible. L'audioguia offline depèn de les veus instal·lades i de Safari/iOS: no es promet àudio descarregat ni reproducció en segon pla. El text offline és independent d'aquesta limitació.

Cache de shell v41 i mòdul lector empaquetat com a fitxer únic amb el loader de mòduls ja existent; paritat index/fallback generada. Sense canvi del format base de l'agenda. Les fitxes no s'esborren en actualitzar el service worker.

## Com validar-ho a l'iPhone sense producció

Hi ha una previsualització local amb **el mateix transport sintètic que les proves de navegador**, les cinc identitats de Bolonya, Eivissa i Londres. El servidor injecta els fixtures només en la resposta local. CSP bloqueja connexions fora de l'origen, i el paquet públic no inclou el servidor ni els fixtures. La veu és la real de l'iPhone, no una simulació. Els textos estan marcats com a sintètics: no són una guia històrica real.

En un ordinador amb aquesta branca:

```sh
npm ci --cache /tmp/freya-npm-cache
npm run build
node scripts/serve-cultural-guide-fixture.mjs
```

La comprovació d'escriptori és a `http://127.0.0.1:4176/freya-travel/`. Per a **iPhone/PWA**, cal HTTPS d'un host de la xarxa local amb certificat de confiança a l'iPhone. Amb certificat/clau ja preparats, i ordinador/iPhone a la mateixa Wi-Fi:

```sh
node scripts/serve-cultural-guide-fixture.mjs --host 0.0.0.0 --port 4176 --cert /ruta/certificat-local.pem --key /ruta/clau-local.pem
```

Obrir `https://NOM-LOCAL-DEL-CERTIFICAT:4176/freya-travel/` amb Safari. No visitar l'app productiva ni usar FREYA PROVES per a aquesta bateria. No s'ha obert cap túnel ni publicat cap previsualització automàticament. Sense HTTPS de confiança es pot provar lectura en Safari, però no donar per validada la PWA/offline.

1. Confirmar el bàner «PROVA SINTÈTICA LOCAL». Obrir Activitats i cadascun dels cinc monuments: Piazza Maggiore, Fontana del Nettuno, Basilica di San Petronio, Archiginnasio i Teatro Anatomico. Revisar el nom del lloc, la font i que mai mostri el text d'un altre punt proper.
2. Cercar una font de prova, preparar la proposta, editar història i revisar les cites/suggeriments. Confirmar la revisió i desar. Tancar, tornar-hi des d'Itinerari i comprovar el mateix text. No es crea cap activitat/reserva addicional.
3. Prémer Escolta amb una veu catalana instal·lada. Provar pausa, represa, velocitat i aturada. Provar un text llarg, bloqueig de pantalla/segon pla i retorn. Confirmar que no s'inicia sola ni continua llegint una altra visita.
4. Provar un dispositiu sense català o retirar-lo de la selecció de veus: missatge comprensible, text accessible i alternativa només després d'autoritzar-la. Si cal, instal·lar català als ajustos de veu/accessibilitat d'iOS; els noms dels menús varien segons versió.
5. Afegir la previsualització a la pantalla d'inici. Preparar/desar les cinc fitxes en línia, activar mode avió, tancar i reobrir la PWA, obrir Propers → Bolonya → Activitats. Verificar text, fonts/cites desades i controls d'edició desactivats. Els enllaços externs de fonts requereixen connexió; les cites locals continuen disponibles.
6. Provar Tanca, Back/Forward, canvi de dia, Eivissa i canvi de viatge. A Londres comprovar les **13** fitxes històriques i els controls de veu. Tancar la previsualització amb Ctrl+C; no iniciar sessió real ni importar documents.

Gate pendent: Safari/PWA física, veu catalana real, suspensió/reobertura i acceptació cultural de fonts/respostes reals. Les proves automatitzades de veu són sintètiques i no acrediten la pronunciació ni el comportament físic del sistema.

## Posada en servei i reversió (només després de revisió)

Abans de publicar el frontend cal revisar/aplicar expressament la nova migració i desplegar `cultural-guide` amb verificació JWT i autenticació interna. Reutilitza `OPENAI_API_KEY` i model existent `A2_IMPORT_MODEL`/`TB04_CANDIDATE_MODEL`; `CULTURAL_GUIDE_MODEL` permet seleccionar-ne un de propi. No exposar cap secret al navegador. Validar primer permisos i generació en una base/entorn aïllats autoritzats, i revisar fonts culturals reals. Aquesta PR no aplica ni desplega res.

Reversió conservadora: tornar al frontend anterior i retirar l'ús de l'Edge nova, **conservant la taula i les fitxes**. No cal cap canvi ni neteja de les dades operatives; no incloure un drop/backfill automàtic.

## Resultats de validació local

- `npm test`: **805/805** proves, cap omesa; inclou les cinc identitats de Bolonya i la visita composta Archiginnasio/Teatro Anatomico.
- `npm run build`, `npm run entries:check` i `node scripts/check-v27-production.mjs`: correctes; `index.html` i `404.html` idèntics, recursos culturals empaquetats i worker v41.
- `deno check supabase/functions/cultural-guide/index.ts`: correcte.
- Migració executada només en Postgres embegut PGlite: sense backfill, RLS de membre/extern/anònim, identitat immutable, unicitat, concurrència CAS i eliminació d’usuari/viatge correctes.
- Navegador Chromium, mòbil i tauleta amb identificació d’escriptori: cinc fitxes independents, fonts exactes, revisió/desament explícit, edició/conflicte, resposta tardana després de canviar de viatge, veu/velocitat/fallback, Back/Forward, Itinerari/Activitats, Eivissa, 13 fitxes de Londres i lectura offline amb recàrrega correctes. La prova detectà i permeté corregir un marcador History antic que es conservava en canviar de viatge.
- Regressions Chromium sobre l’artefacte real: projecció d’Activitats, càrrega parcial d’Itinerari, viatge compartit i bootstrap/PWA (incloses actualitzacions del worker i inici offline) correctes, amb transports sintètics i sense escriptures remotes.
- WebKit local **no executable**: falten GTK4, Graphene, Harfbuzz ICU, Manette, Hyphen i GLES. El mateix recorregut queda afegit a CI amb instal·lació de dependències. Això no substitueix la prova física de Safari/iPhone.

Els resultats validen contractes i comportament amb dades sintètiques; no acrediten la qualitat factual de textos generats amb fonts reals. La revisió humana de cada font i la validació al teu iPhone continuen pendents abans de publicar.

# ALB-01 — Contracte editorial i arquitectura del Travel Book

Estat: contracte conceptual validat per Eva/Freya el 2026-10-04; pendent d'implementació.

Aquest és el document canònic d'ALB-01 per a Travel Book / Crear àlbum. Recull
l'anàlisi i les decisions validades, sota les normes d'[AGENTS.md](../AGENTS.md).
No acredita migracions aplicades, funcions o frontend desplegats ni estat remot.
La validació del contracte no és una autorització per implementar totes les fases.

Base de contrast tècnic de l'anàlisi: `main` al commit
`ee70f6ceabf5e0f5729a82d5458d95b075146613`. Cal tornar a inspeccionar el codi vigent
abans de cada implementació. Les observacions sobre aquesta base són descriptives;
els contractes futurs d'aquest document no descriuen funcionalitat ja disponible.

## 1. Objectiu i decisions aprovades

Travel Book és una capa editorial pròpia del viatge, independent del planning
operatiu i de la galeria. Freya genera una proposta inicial editable; l'usuari no
comença des d'un editor buit. El PDF és una exportació: el projecte continua editable.
Els viatges genèrics són l'objectiu inicial; Londres necessita un tractament separat.

Decisions aprovades explícitament:

1. `projecte → edicions → revisions`, amb model híbrid per composició.
2. Snapshot híbrid i màster editorial immutable dels actius incorporats.
3. Eliminar una foto de la galeria no elimina la còpia editorial ni els seus usos
   al Travel Book. L'eliminació definitiva editorial serà explícita i advertirà
   de l'impacte sobre revisions reproduïbles; els permisos continuen pendents.
4. Freya pot utilitzar automàticament informació no sensible del viatge com a
   context de la proposta. No pot convertir planning o reserves en experiències
   viscudes sense evidència suficient ni generar afirmacions factuals no acreditades.
   Les dades sensibles o privades no entren automàticament.
5. Concurrència optimista per composició, versions persistents, autosave i
   recuperació local amb sincronització.
6. ALB-02 implementarà exclusivament fonaments independents de les decisions obertes.
7. Queden pendents el motor concret, la biblioteca de l'editor, els formats físics,
   l'estil visual, els permisos finals, el proveïdor d'impressió i el contracte print-ready.

## 2. Arquitectura i integració

Flux objectiu:

`fonts del viatge → filtre de dades → snapshots/actius editorials → model Freya
→ proposta editable → edició → revisió validada → renderer → exportació → adaptador d'impressió`.

El model Freya és independent de biblioteques visuals, IA, renderers i proveïdors.
Editor, previsualització i exportació han de consumir el mateix contracte editorial.
Els adaptadors transformen fonts autoritzades; no exposen indiscriminadament files
operatives, documents ni contingut privat al motor de propostes.

La integració serà incremental sobre `index.html`, l'entrada real de la PWA.
`404.html` és generat i ha de conservar paritat exacta. No es proposa migrar l'app
a l'entrada React històrica ni introduir un router paral·lel. Els nous mòduls
hauran d'integrar-se en els scripts de runtime/empaquetat i en el contracte de cache.

## 3. Model editorial

| Concepte | Responsabilitat |
| --- | --- |
| Projecte | Identitat editorial vinculada a un viatge; permet més d'un àlbum. |
| Edició | Variant editable d'un projecte amb estructura i estat propis. |
| Revisió | Manifest immutable d'un estat coherent i reproduïble de l'edició. |
| Capítol/record | Agrupació semàntica opcional per dies, llocs o records. |
| Pàgina | Unitat física ordenada; no depèn de la pantalla. |
| Spread | Parella de pàgines enfrontades. |
| Composició | Unitat d'edició i concurrència d'una pàgina o spread. |
| Element | Foto, text, títol, peu, fons, marc, mapa, ruta, sticker o grup. |
| Actiu | Recurs editorial estable, amb màster immutable i derivats versionats. |
| Snapshot de font | Valors incorporats i procedència del contingut del viatge. |
| Exportació | Artefacte produït a partir d'una revisió i un perfil de renderització. |

Persistir contingut, ordre, geometria, retalls, estils, agrupacions, bloquejos,
versions i procedència. Selecció, pan, zoom de pantalla i eina activa són estat
de sessió; no són la composició canònica.

La geometria serà independent de píxels de pantalla. La proposta tècnica és
utilitzar coordenades físiques en mil·límetres respecte del tall, precisió definida,
rotació, ordre Z i regions de bleed/seguretat versionades. Això no fixa cap mida
de producte ni valor d'impressió. Un element que travessa un spread té una sola
autoritat i es retalla per pàgina en renderitzar, sense duplicar-lo.
Portada, llom i contraportada han de poder representar-se progressivament;
les seves dimensions i regles depenen del futur perfil d'impressió.

## 4. Persistència conceptual

S'aprova combinar identitats, relacions i versions normalitzades amb contingut
de composició estructurat i versionat, previsiblement JSONB. Un únic JSON de tot
l'àlbum dificultaria concurrència i càrregues parcials; normalitzar cada propietat
visual faria el model rígid. El disseny SQL concret s'ha de concretar a ALB-02.

Noms orientatius, no esquema implementat ni obligació de crear totes les taules:

| Família conceptual | Contingut |
| --- | --- |
| `travel_books`, edicions | Identitat, viatge, estructura i versió estructural. |
| Pàgines/composicions | Ordre, abast pàgina/spread i versió actual. |
| Versions de composició | Contingut immutable, versió d'esquema i hash. |
| Snapshots de fonts | Camps permesos, origen i versió/hash de captura. |
| Actius i variants | Màster, rutes estables, hashes, dimensions i derivats. |
| Referències a recursos | Usos verificables des de composicions i revisions. |
| Revisions | Manifest immutable de versions i recursos. |
| Operacions | Identitat idempotent, actor, versió esperada i resultat. |
| Propostes | Abast, versions de base, entrada i resultat del motor. |
| Exportacions | Revisió, perfil, renderer, estat i artefacte resultant. |

Integritat obligatòria: cap referència entre viatges, projectes o edicions aliens;
validació al servidor del JSON i de les seves referències; operacions atòmiques
quan canvien diversos registres; versions d'esquema explícites. RLS ha de respectar
el contracte real de pertinença, inclosos viatges descartats i revocació d'accés.
`created_by` no crea un rol editorial nou. No ampliar l'accés al Builder privat.

Storage i SQL no comparteixen una transacció: capturar/copiar actius requereix
estats verificables, reintents idempotents i tractament de fallades parcials.
No marcar un màster com a disponible fins a verificar-lo. No eliminar objectes
automàticament per un timeout ni aplicar cascades destructives sobre revisions.
Les migracions seran noves i incrementals; cap desplegament queda autoritzat aquí.

## 5. Snapshots, màsters i eliminació

El snapshot híbrid conserva els valors incorporats i una referència opcional a
l'origen. Les correccions posteriors al viatge no reescriuen silenciosament una
edició. L'usuari pot demanar una actualització explícita i revisable.
Cal registrar versió de font o hash quan no existeixi una versió fiable.

Els actius incorporats disposen d'un màster editorial immutable, separat del
cicle de vida de la galeria. Es preserven els bytes necessaris per reproduir-ne
l'ús editorial. Canviar o eliminar l'original no altera el màster, els retalls
ni les revisions que el referencien. Una correcció crea una nova versió d'actiu.

Eliminar una col·locació, eliminar la foto de la galeria i eliminar definitivament
l'actiu editorial són accions diferents. La tercera requereix una acció explícita,
permisos encara pendents i advertiment de quines revisions deixaran de ser
reproduïbles. No es fixa cap termini de retenció ni purga automàtica.
La preservació editorial no amplia l'accés de persones que han perdut permisos.

Una revisió reproduïble referencia versions immutables de composicions, textos,
imatges, mapes, fonts, plantilles, perfils i renderer. Per garantir els mateixos
bytes d'una exportació cal conservar també l'artefacte exportat i el seu hash.
Si es purga deliberadament un recurs, cal reflectir la pèrdua de reproduïbilitat.

## 6. Fonts, evidència i privacitat

La reutilització automàtica s'aplica a informació no sensible com a context.
No significa publicació, cessió a un proveïdor ni autorització general per
processar imatges o textos privats amb IA. El filtratge és una llista explícita
de camps admesos abans d'invocar qualsevol motor, no un filtratge posterior del relat.

| Font actual | Reutilització i límits |
| --- | --- |
| Viatge, dates i zona horària | Context estructural; les dates no acrediten vivències. |
| `trip_photo_metadata` | Dia i context declarats; ordre de càrrega no és data de captura. |
| `travel_documents` de categoria Foto | Candidats visuals dins l'accés autoritzat; títol lliure necessita criteri editorial. |
| Metadades del dia | Títol/resum potencialment reutilitzables, revisant contingut sensible. |
| Activitats i planning manual | Context previst; no afirmar assistència només perquè existeixen. |
| Progrés/completat | Afirmació registrada per un membre, no prova externa ni hora real de l'esdeveniment. |
| Allotjaments | Nom, lloc i dates no sensibles com a context; reserva no acredita estada. |
| Vols i transport local | Trajectes previstos; separar-los de trajectes viscuts. |
| `trip_stops` | Parades planificades amb coordenades; no prova de visita. |
| Lloguer de vehicle | Nom/trajecte només si són pertinents; excloure matrícula, assegurança, dipòsits i contacte per defecte. |
| Estimacions de trasllat | Mostrar com a estimacions; no ruta ni distància recorregudes. |
| Documents, passatgers i pressupostos | No incorporació automàtica de reserves, localitzadors, seients, dades personals, imports o justificants. |
| Brief/Builder i fonts privades | No incorporar automàticament ni convertir permisos privats en compartits. |

Textos lliures poden barrejar records i dades sensibles: no són segurs només pel
nom del camp. El contracte d'evidència ha de distingir fet acreditat, declaració
de l'usuari, planning, estimació i proposta narrativa. En absència d'evidència
suficient, mantenir la formulació de proposta/context o demanar confirmació.
La generació no pot omplir buits amb afirmacions factuals inventades.

## 7. Fotografies, derivats, mapes i rutes

Separar font, actiu editorial i col·locació. Una mateixa imatge pot tenir diversos
usos amb peu propi, retall, rotació, posició, mida, màscara i prioritat diferents.
Conservar identitat/ruta estable, hash i dimensions; mai una URL signada com a
identitat persistent. El peu editorial no sobreescriu `travel_documents.title`.

El retall es defineix sobre la imatge orientada, amb coordenades normalitzades;
evitar dues autoritats contradictòries entre zoom i retall. Els usos es poden
derivar de les referències; les preferències d'inclusió/exclusió són explícites.
Distingir original absent, màster disponible, còpia pendent i actiu irrecuperable.

Preveure derivats per miniatura, editor, previsualització i exportació, vinculats
al hash i versió del procés. Validar tipus, orientació i dimensions, i evitar
propagar metadades personals innecessàries. No inferir dia o lloc des d'EXIF/GPS
sense un contracte específic. No carregar massivament originals a l'editor.

Els mapes/rutes editorials han de conservar geometria o punts ordenats, noms,
procedència, precisió, naturalesa prevista/viscuda/estimada, estil, projecció,
extensió i atribució. Una captura d'un mapa extern mutable no és el model canònic.
Una línia entre punts no acredita un recorregut real. Les distàncies han de
conservar el mètode que les produeix i els drets dels recursos s'han de verificar.

## 8. Concurrència, autosave i recuperació

Concurrència optimista per composició: cada escriptura porta versió esperada i
identitat d'operació. Un conflicte conserva el draft i es resol explícitament;
no hi ha sobreescriptura silenciosa. Reordenar pàgines necessita una versió
estructural; una operació sobre diversos àmbits ha de validar-los atòmicament.
Els reintents no han de duplicar operacions ni revisions.

Autosave, historial persistent, undo de sessió, revisió validada i exportació
són conceptes diferents. Undo afecta operacions pròpies i comprova versions;
no restaura globalment l'estat anterior d'altres membres. Realtime notifica
canvis, però no substitueix l'autoritat del servidor ni sobreescriu drafts.

Recuperació local amb sincronització, previsiblement via IndexedDB, delimitada
per usuari/viatge/edició/composició. Desar durant l'edició, sense confiar només
en l'esdeveniment de tancament. Distingir pendent local, sincronitzant, confirmat
al servidor i conflicte. En reconnectar, comprovar autenticació, permisos i versions.
Cap draft o resposta tardana pot aparèixer en un altre usuari o viatge.

La persistència local del navegador pot ser evacuada i no és una còpia garantida.
La recuperació editorial no autoritza reescriure tot el mode offline de la PWA.
La política de neteja de drafts i recursos locals s'ha de concretar sense perdre
canvis no sincronitzats silenciosament ni exposar dades a una altra sessió.

## 9. Motor de proposta i recomposició

Motor concret pendent: determinista, IA o híbrid. Contracte fix: proposta inicial
editable i útil amb les dades disponibles, sense inventar records.

Entrada: snapshots filtrats, actius autoritzats, restriccions de format quan
s'aprovin, preferències, bloquejos i versions de base. Sortida: proposta tipada
del model Freya, amb procedència i distinció factual/narrativa, no instruccions
arbitràries de base de dades. Separar selecció, estructura, composició i text.

Ha de poder proposar portada, capítols, selecció/ordre de fotos, imatges principals,
collages, ritme i textos. Les futures accions «recompon», «més fotogràfic», «menys
fotos», «afegeix text», «més elegant» o «sorprèn-me» operen sobre un abast explícit.
Han de preservar elements bloquejats, contingut manual protegit i la resta de
l'edició. Una foto retirada d'una composició torna a estar disponible; no s'elimina.
Aplicar una proposta comprova les versions de base; un resultat obsolet no es
pot aplicar silenciosament sobre canvis més recents.

## 10. Renderització, exportació i impressió

Arquitectura prevista: model/revisió → renderer independent → PDF → adaptador.
La proposta tècnica és previsualització interactiva al client, orquestració
autenticada al backend i renderització pesada en un worker asíncron adequat.
No s'ha seleccionat cap biblioteca, servei, cua ni proveïdor. Cal verificar els
límits vigents de l'entorn abans d'escollir-lo; no assumir que una Edge Function
pot executar qualsevol motor d'imatge o PDF.

Una feina d'exportació ha de sobreviure la suspensió de la PWA, ser idempotent,
reintentable i observable, amb revisió immutable, perfil i renderer versionats.
Només accedeix a recursos autoritzats; no accepta URLs arbitràries. Validar
disponibilitat, dimensions, fonts, text desbordat i ordre de pàgines abans d'exportar.

Print-ready continua pendent i haurà d'incloure dimensions, bleed, marges segurs,
resolució, fonts, espai/color, nombre i ordre de pàgines i compatibilitat amb el
proveïdor. No hi ha valors aprovats. Un PDF de previsualització no acredita
print-ready. Publicar, purgar definitivament, exportar per impressió i encarregar
impressió no s'implementaran sense decidir els permisos; no s'inventen rols.

## 11. Rendiment i mobile/PWA

Escenari de disseny: 200–500 fotos disponibles, 50–150 incorporades i 20–100
pàgines. Són volums de validació, no límits de producte aprovats.

Paginar metadades, virtualitzar llistes, carregar miniatures i mantenir actives
només les composicions visibles i un entorn limitat. Limitar descodificacions
simultànies i alliberar recursos. Signar recursos a demanda i renovar-ne l'accés
sense canviar la identitat de l'actiu. Cache delimitada per usuari i versió,
compatible amb revocació d'accés i canvi de sessió.

Agrupar autosaves semàntics per composició; no enviar tot el llibre a cada gest.
Provar memòria, xarxa mòbil, connexió intermitent, URLs caducades, teclat, safe
areas, gestos tàctils, iPhone/PWA suspesa i iPad amb identificació d'escriptori.
Comprovar compatibilitat entre frontend antic/nou, backend i cache/service worker.

## 12. Navegació

Flux objectiu: Home/viatge → crear o obrir → proposta → editor ↔ visió global
→ validació → exportació. Obrir un projecte existent no el regenera. La creació
ha de ser idempotent. Els viatges passats conserven la funcionalitat operativa.

Identitats persistents de projecte/edició/composició per reprendre el treball;
retorn a Fotos amb identitat de foto i context d'origen. Back/Forward no són undo.
Recàrrega i reobertura reconcilien estat servidor i draft local. Canviar de
viatge/usuari invalida peticions pendents i no barreja drafts. Integrar-se amb
els mecanismes existents, sense assumir que hi ha un router únic.

## 13. Estat contrastat, discrepàncies i riscos

Observacions de la base de codi indicada, no garanties de producció:

- Fotos utilitza `travel_documents` i metadades opcionals 1:1. No disposa de màster
  editorial, derivats ni peu independent. La cua actual és en memòria; no és la
  futura recuperació durable. La galeria no aporta la paginació necessària.
- La documentació de Fotos descriu `location_name` per al context d'activitat,
  però el camp real és `venue_name`; el renderer i fixtures reprodueixen el
  desajust. No copiar aquest contracte erroni als adaptadors editorials.
- L'eliminació d'activitat/planning pot anul·lar la referència contextual sense
  preservar-ne el títol històric. Un enllaç viu no substitueix un snapshot.
- `reserved`/`confirmed` no volen dir «viscut»; el progrés registra una declaració
  i la marca temporal de l'acció, no necessàriament el moment real de l'experiència.
- El transport local es modela dins `trip_activities`; hi ha fonts addicionals
  com `trip_stops`, vehicles i passatgers. Els passatgers no defineixen membres
  ni rols editorials. Les estimacions de trasllat no aporten geometria real de ruta.
- El visor intern de documents mostra imatges/PDF amb accés temporal; no genera
  PDF. El mode offline existent és lectura de snapshots, no cua durable d'edició
  ni disponibilitat garantida de binaris. El service worker ja tracta codi amb
  network-first; cal inspeccionar-ne el comportament abans de cada release.
- Existeix CI, però la suite general legacy és informativa amb `continue-on-error`;
  checks verds no acrediten tota la regressió. Les migracions no substitueixen
  els baselines històrics ni demostren estat remot aplicat.
- El roadmap separa C1 Crear àlbum i C3 Travel Book. Aquest contracte fixa una
  base editorial comuna per a tots dos; no autoritza construir productes paral·lels
  ni substituir altres àrees del roadmap.

Riscos principals: volum/memòria d'imatges; costos de còpies immutables; privacitat
de textos lliures; revocació d'accés i purga; captura SQL/Storage parcial;
concurrència estructural; recursos/fonts no reproduïbles; integració de navegació
històrica; compatibilitat de versions i limitacions reals d'iOS.
Cap d'aquests punts autoritza refactors retrospectius fora de la tasca concreta.

## 14. Verificació exigible en la implementació

- Model: serialització/versionat, integritat pàgina/spread, ordre i referències.
- Permisos: dos membres, no membre, accés revocat, viatge descartat, referències
  creuades rebutjades i fonts privades que no es fan compartides.
- Snapshots: font editada/eliminada, màster conservat en eliminar la foto original,
  còpia fallida/reintentada i revisió immutable; futura purga explícita advertida.
- Concurrència: versió obsoleta, reintent idempotent, edició de composicions
  diferents, conflicte sobre la mateixa i canvi estructural concurrent.
- Recuperació: autosave interromput, resposta ambigua, suspensió, reconnectar,
  conflicte amb draft local, canvi d'usuari/viatge i accessos caducats.
- Motor: no convertir reserves en vivències, exclusió de camps sensibles,
  preservació de bloquejos, regeneració parcial i rebuig de propostes obsoletes.
- Renderer: fonts, retalls, orientació, spreads, recursos absents, determinisme
  sota versions fixades i diferència entre previsualització i print-ready.
- Integració: Back/Forward, recàrrega, retorn a Fotos, paritat d'entrades, build,
  empaquetat, cache, regressions i E2E físic iPhone/iPad amb volums representatius.

Els fixtures han d'utilitzar noms/camps reals. Les proves SQL s'executaran en un
entorn descartable; Storage, Realtime i dispositius requereixen verificacions
pròpies. Aquest document no declara aquestes proves creades ni executades.

## 15. Decisions pendents i límits d'ALB-02

| Decisió pendent | Alternatives/criteri per decidir | Conseqüència |
| --- | --- | --- |
| Motor concret | Determinista, IA o híbrid; utilitat, cost, privacitat i traçabilitat. | No seleccionar-lo a ALB-02. |
| Biblioteca visual | Comparar manteniment, llicència, iOS, mida, exportació i desacoblament. | Cap dependència d'editor aprovada. |
| Formats físics | Un format inicial o diversos; orientació, coberta i enquadernació. | Cap dimensió ni perfil per defecte inventat. |
| Estil visual | Plantilles i llibertat d'edició guiada. | Cap estil de producte aprovat implícitament. |
| Permisos finals | Decidir per acció segons el contracte del viatge. | Publicar, purgar, imprimir/exportar per impressió continuen bloquejats conceptualment. |
| Proveïdor d'impressió | Adaptador substituïble amb requisits verificats. | Cap integració o comanda autoritzada. |
| Print-ready | Especificar totes les propietats de la secció 10. | Cap promesa d'imprimibilitat abans de validar-lo. |

També cal concretar en la fase corresponent la retenció/purga, el contracte
d'evidència per font i la cessió de dades a motors externs. La preservació
editorial i l'ús de context no sensible ja estan aprovats; aquests detalls no
permeten reinterpretar-los com a purga automàtica ni accés indiscriminat.

ALB-02 es limita als fonaments independents: identitats, relacions, versions,
contracte de composició, snapshots, referències d'actius, concurrència i límits
d'accés. El disseny concret s'ha de contrastar abans d'implementar-lo. No activa
Crear àlbum, un editor, generació, exportació o impressió; no resol silenciosament
les decisions pendents. Autosave i recuperació formen part del contracte aprovat,
però la UI i sincronització completa s'integren en la fase d'editor.

## 16. Divisió preliminar de fases

Els fitxers i noms següents indiquen àmbits previsibles, no una llista definitiva
de canvis autoritzats. Cada fase necessita abast i verificació propis.

| Fase | Objectiu | Àmbits previsibles | Validació principal |
| --- | --- | --- | --- |
| ALB-02 | Fonaments del domini i persistència. | Nous mòduls a `domain/`, migracions incrementals i proves SQL/JS; aquest contracte. | Integritat, RLS, versions, CAS i idempotència. |
| ALB-03 | Adaptadors de fonts, snapshots i actius editorials. | Mòduls de fonts, Storage/migracions noves i processos de còpia/derivats per definir. | Filtratge, preservació, fallades parcials, paginació i accés. |
| ALB-04 | Primera proposta editable amb motor aprovat. | Mòduls del motor i eventual backend; entrada mínima a `index.html` i `404.html` generat. | Utilitat sense editor buit, evidència i dades parcials. |
| ALB-05 | Editor, autosave, conflictes i recuperació. | Frontend, mòduls d'edició/sincronització, persistència local i integració de navegació. | Dos membres, drafts, undo, reconnectar i iPhone/iPad. |
| ALB-06 | Recomposició parcial assistida. | Contracte del motor, comandos i controls de l'editor. | Bloquejos, abast i versions de base. |
| ALB-07 | Validació, revisions i exportació PDF. | Manifest, orquestració, worker/renderer i emmagatzematge d'artefactes per definir. | Reproduïbilitat, permisos aplicables i feines reintentables. |
| ALB-08 | Impressió si s'aprova; consolidació de rendiment i release. | Adaptador/profil d'impressió, preflight, empaquetat i PWA segons canvis. | Print-ready, privacitat, volums i E2E de release. |

Quan hi hagi nous recursos de client cal revisar `scripts/browser-runtime.mjs`,
`scripts/package-pages.mjs` i `sw.js`; quan canviï HTML, regenerar amb el mecanisme
d'`scripts/app-entries.mjs`. Cap d'aquests fitxers es modifica per documentar ALB-01.

Referències del repositori: [Fotos contextuals](contextual-photos-v1.md),
[Home](home-01.md), [baseline de dades](database/travel-data-production-baseline.md)
i [progrés compartit](database/shared-trip-progress.md). Són evidència a contrastar
amb el codi, no una substitució de la inspecció abans d'implementar.

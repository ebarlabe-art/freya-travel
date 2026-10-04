# ALB-02 — Domini i persistència del Travel Book

Estat: implementació local, sense commit, PR, aplicació remota ni desplegament.
Data de verificació: 2026-10-05. Base: `main` a
`7b936bb6a59c18f17617f1540228726896e22ad9`.
Contractes vinculants: [AGENTS.md](../AGENTS.md) i [ALB-01](travel-book-alb01.md).

## Abast implementat

Fonaments de projecte → edicions → revisions, amb composicions versionades,
CAS, rebuts idempotents, referències de recursos i RLS de membre. No hi ha UI,
editor, motor de proposta, ingestió de fonts, còpia de binaris, Storage nou,
derivats, IndexedDB, PDF, impressió ni permisos editorials finals.

Una edició pot estar buida com a estat intern. Això no autoritza una experiència
de producte que comenci en un editor buit. El contracte de proposta inicial
editable d'ALB-01 continua vigent.

Els recursos pertanyen al llibre i poden reutilitzar-se entre les seves edicions,
però no entre llibres, encara que aquests pertanyin al mateix viatge.

## Fitxers i migracions

Mòduls purs, sense dependències noves:

- `domain/travel-book-composition.mjs`: esquema, validació, composició buida i refs.
- `domain/travel-book-commands.mjs`: preparació de save i classificació d'errors.
- `domain/travel-book-revision.mjs`: validació de manifest i petició de revisió.

Migracions incrementals:

1. `20261004213559_travel_book_foundation_v1.sql`: onze taules, validadors,
   integritat, índexs, RLS, grants i proteccions d'immutabilitat.
2. `20261004214647_travel_book_commands_v1.sql`: helpers privats, comandos
   transaccionals i sis façanes RPC públiques.

Les migracions històriques no s'han modificat. Els tres mòduls no estan importats
pel frontend ni incorporats a l'empaquetat de recursos de la PWA.

## Model SQL real

Tots els registres tenen scope explícit i les relacions editorials utilitzen FK
compostes per impedir barrejar viatge, llibre i edició. Les definicions SQL de les
migracions són la referència exacta de camps, checks i índexs.

| Taula | Identitat i responsabilitat |
| --- | --- |
| `travel_books` | UUID, viatge, títol i autoria històrica. Diversos llibres per viatge. |
| `travel_book_editions` | UUID, llibre, títol, `structure_version` i `next_revision_number`. |
| `travel_book_compositions` | UUID, edició, `kind`, `current_version`, autoria i retirada lògica. |
| `travel_book_pages` | UUID, composició, `slot` i `position` nullable. |
| `travel_book_composition_versions` | PK `(composition_id,version)`, document JSONB immutable i hash generat. |
| `travel_book_source_snapshots` | UUID, llibre, procedència, classificació, payload filtrat i hash generat. |
| `travel_book_assets` | UUID de versió, `asset_key`, versió, origen, estat i descriptor futur de màster. |
| `travel_book_resource_refs` | Referències d'una versió de composició a actiu o snapshot. |
| `travel_book_revisions` | UUID, número per edició, manifest immutable i hash generat. |
| `travel_book_revision_compositions` | FK entre revisió i versions exactes del mateix scope. |
| `travel_book_operations` | PK `(actor_id,operation_id)`, petició exacta i rebut immutable. |

Versions de composició/estructura i números de revisió són enters entre 1 i
9007199254740991. Títols de llibre/edició: 1–160 caràcters amb trim.
Els UUID històrics d'actor no tenen FK amb cascada a `auth.users` i no concedeixen
privilegis. Els timestamps i l'actor de les mutacions els fixa el servidor.

`updated_at` de l'edició s'actualitza en canvis estructurals; un save només
actualitza les composicions afectades. Capturar una revisió incrementa el
comptador de revisions, però no `structure_version`.

## Composició JSONB V1

Esquema estricte compartit conceptualment entre JS i SQL, amb test de paritat
literal. SQL utilitza `pg_jsonschema`, ja existent al repositori, i validació
semàntica addicional. La validació SQL és autoritativa.

```json
{
  "schema_version": 1,
  "composition_id": "00000000-0000-4000-8000-000000000001",
  "kind": "page",
  "page_ids": ["00000000-0000-4000-8000-000000000002"],
  "canvas": {"unit": "mm", "width": null, "height": null},
  "elements": [],
  "locks": {"layout": false},
  "metadata": {"label": null}
}
```

- `page` té una pàgina; `spread`, dues, amb identificadors diferents.
- Dimensions conjuntament nul·les o positives. Sense dimensions, elements buits.
- Geometria en mm: `x`, `y`, `width`, `height`, `rotation`.
- L'ordre d'`elements` és el z-order; no existeix una segona autoritat numèrica.
- Tipus inicials: `text` i `image`. Tipus futurs requereixen ampliar/versionar
  l'esquema, no una columna SQL per cada propietat visual.
- Text pla amb `role` (`title`, `body`, `caption`) i `source_snapshot_ids`.
- Imatge amb `asset_id` i crop normalitzat dins de la imatge.
- Cada element té UUID únic i locks de contingut/geometria. Els locks es
  persisteixen; ALB-02 no implementa un motor que els interpreti ni recomposició.
- Claus desconegudes i tipus no definits es rebutgen. No existeix camp de dades
  arbitràries, HTML executable, URL d'actiu o binari inline.

Límits tècnics: 200 elements, 16.000 caràcters per text, 20 fonts per element de
text, document SQL de 256 KiB, snapshot de 32 KiB i petició SQL d'1 MiB.
SQL mesura la representació `jsonb::text`; el control JS previ mesura JSON compacte
i pot acceptar un document fronterer que el servidor rebutgi. No són quotes
comercials. Les coordenades tenen límits numèrics de seguretat, sense definir
cap format comercial, bleed, resolució ni perfil print-ready.

## RPC i errors

Les funcions `public` són `SECURITY INVOKER` i criden implementacions del mateix
nom a `app_private`, `SECURITY DEFINER`, amb `search_path=''`. Es revoca EXECUTE
per defecte i només es concedeixen les sis entrades a `authenticated`.
Els helpers interns no són executables pels clients.

| RPC | Arguments, a més de `p_trip_id`, `p_book_id` i `p_operation_id` |
| --- | --- |
| `create_travel_book_v1` | `p_title`; la identitat de llibre ja és a `p_book_id`. |
| `create_travel_book_edition_v1` | `p_edition_id`, `p_title`. |
| `change_travel_book_structure_v1` | `p_edition_id`, `p_expected_structure_version`, `p_add`, `p_remove`, `p_order`. |
| `save_travel_book_compositions_v1` | `p_edition_id`, `p_changes`. |
| `create_travel_book_revision_v1` | `p_edition_id`, `p_revision_id`, `p_expected_structure_version`, `p_expected_compositions`. |
| `get_travel_book_operation_v1` | Només `p_operation_id`; consulta el rebut del mateix actor. |

Cinc mutacions i una consulta. La lectura paginada de taules es fa sota RLS;
no hi ha una RPC que carregui tot el llibre i el seu historial.

`p_add` conté `{id,page_ids}`; `p_remove` i `p_order` són arrays UUID de
**composicions**. `p_order` ha de contenir exactament totes les composicions actives
resultants. La RPC deriva posicions contigües de pàgina, conserva els slots i no
separa spreads. Límit tècnic: 100 composicions noves per comanda i 1.000 actives.

`p_changes` conté entre 1 i 100 parelles `{expected_version,document}`, sense
targets duplicats. La RPC comprova també kind i pàgines de la composició real.
Les refs es deriven del document al servidor, mai d'una segona llista del client.

Errors de domini principals: `42501 ALB_ACCESS_DENIED`, `22023` per document,
estructura o operació reutilitzada invàlids, `40001` per conflictes de composició,
estructura o revisió, `23503 ALB_RESOURCE_SCOPE_MISMATCH`, `P0002` per target no
disponible i `55000 ALB_IMMUTABLE`. Les constraints natives també poden retornar
els seus SQLSTATE (p. ex. UUID malformat, identitat duplicada o límit excedit).

## CAS, idempotència i locks

Ordre comú: lock transaccional de `(actor,operation)` → viatge/pertinença →
edició → composicions per UUID. Cap crida de xarxa durant la transacció.

- Save: lock compartit d'edició i exclusiu només de les composicions afectades.
- Estructura/revisió: lock exclusiu d'edició.
- Dos saves en composicions diferents poden progressar simultàniament.
- Un save múltiple s'aplica íntegrament o es reverteix íntegrament.
- El conflicte retorna versió/target actual en `DETAIL`, sense substituir el draft.
- Un document idèntic, després de superar CAS, no crea una versió redundant.
- Un canvi estructural acceptat incrementa `structure_version`.

El rebut només existeix per una operació confirmada. No hi ha estat persistent
`processing`, ni rebuts d'errors, ni expiració automàtica. Mateixa clau i petició
retorna el resultat original amb `replayed=true`, encara que hi hagi saves
posteriors. Mateixa clau amb petició diferent es rebutja.

L'accés es revalida també abans d'un replay. Revocació i descart s'ordenen amb
les escriptures mitjançant locks curts: una operació ja autoritzada pot confirmar
abans de la revocació; les posteriors es deneguen.

## Revisions i hashing

La revisió fixa l'estructura, pàgines, versions de composició, metadades
editorials i descriptors de snapshots/actius utilitzats. La petició especifica
la versió estructural i el conjunt exacte de versions esperades. Si alguna ha
canviat, la captura es rebutja; no es barregen moments d'un save múltiple.

El manifest és una còpia immutable amb referències a documents immutables.
`travel_book_revision_compositions` protegeix amb FK les versions seleccionades.
No es copien tots els documents de composició ni cap binari dins del manifest.

`resource_state_at_capture=complete` significa exclusivament que tots els actius
referenciats constaven `ready`; sense actius també pot ser `complete`. No implica
que canvas tingui format, que existeixi un renderer ni que sigui exportable.
`incomplete` conserva els descriptors pendents/absents. La revisió no s'actualitza
quan un actiu es resol més tard: cal una revisió nova.

`hash_version=1`: SHA-256 de l'UTF-8 de la representació PostgreSQL `jsonb::text`.
Els hashes de document, snapshot i manifest són columnes generades. Els clients
els tracten com a valors opacs; no es pressuposa equivalència amb JSON.stringify.
Una futura migració de representació ha de conservar els hashes/versionat
històrics, sense recalcular-los silenciosament.

## Snapshots, actius i preservació

No existeix API pública d'ingesta per cap de les dues taules. Només els tests
sembren recursos amb privilegis de fixture. ALB-03 haurà d'implementar verificació
de fonts, filtratge, còpia física i transicions segures.

Snapshot V1: procedència tipada, `source_id`, versió opcional, classificació
`context | user_statement | source_evidence`, origen, disponibilitat a captura,
payload i hash. El payload només admet `label`, `local_date` i `place_label`.
Una font identificada no acredita per si sola que una experiència s'hagi viscut.
No hi ha accés transitiu al Builder privat ni FK polimòrfica a files operatives.

Actiu: UUID concret de versió, família `asset_key`, scope de llibre, origen viu
opcional i origen històric, estat `pending | ready | missing`, hash, MIME,
dimensions, bucket/path estable i verificació. `ready` exigeix descriptor complet.
No existeix cap comando ALB-02 per declarar disponibilitat física.

Eliminar una foto d'origen fa SET NULL només sobre `source_document_id`.
Conserva actiu, origen històric, usos i revisions. Un trigger específic impedeix
reescriure la identitat i el descriptor d'un màster ja verificat; no implementa
el pipeline ni habilita transicions per al client.

Versions, snapshots, refs, revisions, enllaços de revisió i rebuts tenen guardes
append-only. La resta de la lògica de negoci és explícita a les RPC.

Les FK editorials no fan cascada destructiva. Retirar composicions conserva les
pàgines amb `position=NULL` i l'historial. No hi ha endpoint per purgar, eliminar
una edició o separar/fusionar spreads. RESTRICT pot bloquejar la supressió física
d'un viatge o una cascada de compte que el contingui: és la preservació aprovada,
no una política definitiva de purga. La futura purga continua pendent.

## Seguretat

Onze taules amb RLS i SELECT de membre via `public.is_trip_member(trip_id)`.
Operacions: a més, `actor_id=auth.uid()`. Sense permisos DML directes per
`public`, `anon`, `authenticated` o `service_role`. Sense rols editorials nous.

Les RPC verifiquen sessió, membre real, viatge no descartat i viatge genèric;
exclouen `london-2026`. Created_by no concedeix permisos. L'actor no és un input.
La funció de pertinença existent no s'ha substituït ni simplificat.

La disponibilitat dels recursos, el seu scope i la integritat de les refs es
comproven al servidor. Els permisos de publicar, purgar i imprimir segueixen
pendents i no hi ha endpoints que els anticipin.

## Tests, CI i estat verificat

Comandes:

- `npm run test:alb02`: proves pures i contractes JS.
- `npm run test:alb02:db`: migracions, suites SQL i sessions concurrents locals.
- `npm run check:alb02`: JS + SQL/concurrència + paritat d'entrades.
- `node scripts/test-travel-book-db.mjs --schema-only`: migracions i cinc suites
  SQL, ometent només les sessions concurrents; utilitzat en la verificació final
  de l'última asserció de revocació.

El runner només usa dos noms fixos de contenidor local: `supabase_db_freya-travel`
i, amb `--ci-container`, `freya_alb02_ci`. Crea una base pròpia per procés i
l'elimina en acabar. No llegeix credencials/URLs remotes. Aplica cronològicament
l'historial, excepte la programació externa de Cron, i comprova que totes les
files preexistents de taules públiques es conserven després d'ALB-02.

Els baselines locals d'Auth i dades històriques són fixtures, no una reconstrucció
acreditada de producció. No validen GoTrue, Storage real ni l'aplicació remota.
La fixture compartida `travel_book_fixture.sql` evita duplicar preparació entre
suites; no és una migració ni cap font de dades de producte.

Resultats locals:

- 11 tests JS ALB-02: PASS.
- Cinc suites SQL rollback: PASS, inclosa la verificació final de revocació.
- Onze escenaris de sessions independents: PASS (CAS, paral·lelisme, retry,
  atomicitat, estructura, checkpoints, retirada, revocació i descart).
- Check complet ALB-02: PASS; els últims canvis de validador JS i asserció RLS
  s'han verificat després amb les proves focalitzades corresponents.
- Reproducció local de les proves SQL/concurrència del CI en un contenidor net
  amb `public.ecr.aws/supabase/postgres:17.6.1.165`: PASS.
- Build: PASS reutilitzant els binaris opcionals macOS de la instal·lació local;
  manifests i lockfile sense dependències noves.
- Paritat `index.html`/`404.html`: PASS; fonts del frontend sense canvis.
- Legacy: 26 fallades preexistents, amb noms exactament coincidents en la còpia
  neta de main i la branca ALB-02; cap fallada nova. La comparació completa es va
  fer amb els primers 8 tests ALB-02 (449/475); main, 441/467. Els 3 tests ALB-02
  addicionals s'han executat focalitzadament, amb 11/11 finals.

El job nou `alb02-contracts` no té `continue-on-error`, no usa secrets remots i
executa JS, SQL/concurrència i paritat sobre base descartable. La configuració de
protecció de branca per exigir aquest job com a required check no s'ha modificat.
No s'ha executat GitHub Actions remotament: encara no existeix PR d'ALB-02.

No hi ha contractes bloquejats ni desviacions arquitectòniques respecte del pla
validat. La fixture compartida i els límits numèrics són detalls d'implementació.
Les fallades legacy no s'han corregit fora de l'abast.

Estat de desplegament: codi i migracions escrits; migracions aplicades només a
bases locals descartables de test, ja eliminades. Cap migració aplicada al projecte
remot, cap Edge Function ni frontend desplegat, cap estat remot verificat.

## Continuació i decisions pendents

ALB-03 haurà d'incorporar fonts, còpia i disponibilitat física abans de presentar
actius com a preservats. El finalitzador de recursos haurà de respectar els locks
sobre actius utilitzats en la captura de revisions i la immutabilitat del màster.

Continuen pendents motor concret, editor visual, formats comercials, estil,
permisos finals, proveïdor d'impressió, print-ready i política de purga.
Aplicar aquestes migracions remotament requereix review, autorització explícita,
verificació de baselines/extensions/grants i verificació posterior. L'existència
d'aquest document o dels fitxers no acredita disponibilitat en producció.

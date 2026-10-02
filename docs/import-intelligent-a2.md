# A2 · Importació intel·ligent

## A2.1 · Contracte de proposta read-only

Aquest tall crea la frontera de seguretat abans d’afegir OCR, IA o parsing de
documents.

### Objectiu

Convertir el contingut extret d’un document en una **proposta tipada** de peça
operativa, però sense escriure encara res al viatge.

Flux futur:

`document/captura/correu → extractor → proposta A2.1 → revisió humana → acceptació → escriptura`

### Tipus inicials

- vol (`flight`)
- allotjament (`accommodation`)
- activitat (`activity`)
- cotxe de lloguer (`car_rental`)

Els camps admesos coincideixen amb els camps operatius que ja existeixen a les
taules de cada mòdul. Queden explícitament fora els camps de seguretat i
auditoria (`id`, `trip_id`, `created_by`, `updated_by`, timestamps, etc.).

### Contracte de cada camp

Cada valor proposat ha d’incloure:

- `value`: valor simple extret;
- `confidence`: `high | medium | low`;
- `evidence`: almenys una evidència `text | visual | metadata`, amb fragment
  i/o pàgina quan correspongui.

No hi ha camps “màgics” ni claus lliures: cada tipus de peça té una allowlist.

### Regles de seguretat

1. A2.1 és read-only.
2. Una proposta no pot crear, modificar ni vincular cap peça.
3. Una importació de tipus `document` ha de referenciar un
   `travel_documents.id` existent.
4. Cap extractor pot proposar camps privilegiats o fora del model existent.
5. La confiança no substitueix el consentiment.
6. La fase d’escriptura serà un contracte separat i haurà de tornar a validar
   membre, viatge, document, revisió i conflictes abans de fer cap canvi.

### Implementació

- `domain/import-proposal.mjs`: normalització i validació pura.
- `scripts/import-proposal.test.mjs`: proves del contracte i de les barreres de
  seguretat.

Aquest tall **no** incorpora encara OCR, IA, Edge Function, UI ni migracions.
Això és deliberat: primer queda fixat què pot sortir d’un extractor abans de
connectar-hi cap proveïdor.


## A2.2 · Primer extractor determinista de reserves

S’afegeix un extractor pur de text que treballa **abans** de qualsevol capa
d’IA. La seva funció és detectar patrons explícits i convertir-los al contracte
A2.1.

### Capacitats inicials

- classifica `flight | accommodation | activity | car_rental`;
- extreu només dades textualment explícites (per exemple número de vol,
  localitzador, nom d’hotel, proveïdor o lloc de recollida);
- conserva evidència textual per cada camp;
- marca camps mínims pendents;
- rebutja documents amb tipus ambigu;
- rebutja una classificació si no pot acreditar cap camp operatiu.

Deliberadament **no infereix** ciutats, dates, zones horàries o altres dades a
partir de context ambigu. Per exemple, veure “Departure: Barcelona” no autoritza
encara a escriure `departure_city=Barcelona` si el parser no té una regla
específica i provada per aquell camp.

Fitxers:

- `domain/import-text-extractor.mjs`
- `scripts/import-text-extractor.test.mjs`

A2.2 continua sent read-only: produeix una proposta A2.1 i no té accés a
Supabase ni a cap operació d’escriptura.

# A2.5 · Contracte de proposta per importar un itinerari complet

**Estat:** primer tall tècnic en branca de proves. **No està connectat a la PWA i no importa encara PDFs de principi a fi.**

## Per què

A2.1–A2.4 ja permeten importar reserves individuals (vol, allotjament, activitat, transport i cotxe), amb evidència i confirmació. Un PDF que contingui un *itinerari sencer* no és una sola reserva: conté múltiples elements per dies i hores, de vegades aproximades i amb diferents nivells de certesa.

A2.5 crea un contracte **diferent del de reserves**, perquè els elements manuals de `trip_itinerary_items` tenen semàntiques temporals pròpies. **No modifica el contracte A2.1 vigent.**

## Fitxers

- `domain/import-itinerary-proposal.mjs`: `normalizeItineraryImportProposal`, `itineraryImportProposalCanWrite` (sempre `false`) i llista explícita de camps.
- `scripts/import-itinerary-proposal.test.mjs`: proves unitàries de validació, evidència, temps, duplicats i seguretat.

## Contracte d'entrada

```js
{
  schema_version: 1,
  source: {kind: 'document', document_id: 'ID existent', file_name: 'ruta.pdf'},
  candidates: [{
    source_order: 0,
    classification_hint: 'manual',
    fields: {
      title: {value: 'Visita', confidence: 'high',
        evidence: [{kind: 'text', excerpt: '09:30 Visita', page: 2}]},
      local_date: {value: '2026-12-27', confidence: 'high',
        evidence: [{kind: 'text', excerpt: '27/12/2026', page: 2}]},
      start_local_time: {value: '09:30', confidence: 'high',
        evidence: [{kind: 'text', excerpt: '09:30 Visita', page: 2}]}
    }
  }]
}
```

La sortida és normalitzada i afegeix `read_only: true`, `requires_user_confirmation: true` i `review_flags` per candidat.

### Regles

1. Només camps autoritzats: títol, data, hores locals, zona horària, franja, lloc, adreça, ciutat i notes. Cap `trip_id`, identificador, SQL ni camp privilegiat proposat.
2. Cada camp ha de tenir confiança i evidència verificable; cap dada inventada.
3. La zona horària no s'infereix silenciosament i una hora local no es converteix a UTC sense confirmació. Un horari ambigu genera avís.
4. Si la sortida és anterior o igual a l'inici, l'element es marca per revisar; **no es corregeix automàticament**.
5. Duplicats *dins del document* es marquen, però es preserven. La comparació amb peces que ja existeixen al viatge **encara no està implementada**.
6. L'ordre de la font es preserva. No s'escriu ni esborra cap peça; no hi ha accés a Supabase.
7. `classification_hint` és orientatiu i **mai no demostra** que un element sigui una reserva confirmada.

## Propers talls

- **A2.6**: extractor read-only de text d'itineraris (dies, hores, punts, classificació i evidències per pàgina), amb documents de prova i casos ambigus.
- **A2.7**: previsualització editable i comprovacions de coherència reutilitzant TB-09; consulta de duplicats contra les dades actuals del viatge, incloent-hi peces operatives.
- **A2.8**: confirmació explícita i escriptura segura amb permisos, revalidació al servidor, conflictes, idempotència i enllaç al document original.
- **GATE**: prova real a l'iPhone/PWA i comprovació de tornada, recuperació de sessió i errors.

## Consideracions de release

Aquest PR no canvia `main`, `index.html`, `404.html`, Supabase, el service worker ni les dades reals. **No publicar/fusionar aquest tall com si ja oferís importació d'itineraris: encara és infraestructura sense UI.**

El roadmap canònic v1.2 (8/10) enumera fases de l'àlbum com a pendents encara que ja hi ha implementacions ALB posteriors, i també descriu Offline V2 com a pendent tot i la fusió de #106. Actualitzar-ne l'estat en una revisió **numerada** separada quan es faci la conciliació completa, no en aquesta PR funcional.

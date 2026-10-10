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

- **A2.6 (implementat en aquest PR, pendent validació CI final)**: parser determinista, read-only, per text **ja extret** per pàgines. No llegeix fitxers PDF binaris, no incorpora OCR ni IA i no està connectat encara a la pantalla de Freya. Es troba a `domain/import-itinerary-text-extractor.mjs` i té 16 proves noves a `scripts/import-itinerary-text-extractor.test.mjs`. Reconeix capçaleres amb dates completes en formats explícits, hores locals, franges del dia, activitats amb hora i llistes sense hora. Manté dies entre pàgines, conserva pàgina i fragment com a evidència, detecta duplicats dins de la font i genera avisos de dates incompletes, impossibles, zones horàries desconegudes i horaris invertits. No converteix zones horàries a UTC, no dedueix un any absent i no crea reserves confirmades. Només accepta un màxim de 150 pàgines, 500.000 caràcters i 200 elements.
- **A2.6.1 (implementat en branca, pendent desplegament i validació real):** nova Edge Function `import-itinerary` amb JWT obligatori. Rep únicament `trip_id` i `document_id`; consulta `travel_documents` amb el JWT de l'usuari i les polítiques RLS del viatge, descarrega el PDF del bucket privat `trip-documents` amb aquest mateix JWT (sense clau de servei), valida capçalera i límit de 10 MiB i demana a un model d'extracció que transcrigui text de l'itinerari indicant pàgina i si ha pogut llegir el document complet. La resposta passa per un contracte estricte i pel parser determinista A2.6. Cap escriptura, ni nova activitat, ni autoimportació. Si el model informa transcripció parcial, es rebutja tota la proposta.
- **Important, privacitat:** a diferència del parser local, aquest pas **envia el PDF privat complet al servei d'IA OpenAI**, amb `store:false`, com ja fa l'importador de reserves existent. No amagar aquest tractament: abans d'activar el botó a la PWA cal mostrar clarament que es processarà el PDF amb IA i demanar una acció explícita de l'usuari. No enviar automàticament documents per cap sincronització.
- **Límit de verificació:** les pàgines i cites provenen de la transcripció del model i **no són una comprovació independent** de la paginació real del PDF. El model també pot equivocar-se en marcar `complete:true`; no es pot prometre lectura exacta de tota mena de PDF, sobretot escanejats, taules, PDFs grans o amb maquetacions complexes. L'usuari revisarà i validarà tots els punts a A2.7.
- **Encara pendent:** integrar UI per triar documents existents o pujar PDF, mostrar l'avís de processament amb IA, desplegar la nova Edge Function en un entorn de proves i validar-ho amb PDFs reals no sensibles i amb un iPhone/PWA. No executar desplegament de Supabase en producció sense autorització.
- **A2.7.1 (implementat a la branca, pendent de proves físiques i backend desplegat):** pantalla "Importa PDF" dins de l'Itinerari dels viatges genèrics. Reutilitza Documents privats, permet triar un PDF existent o pujar-ne un de nou i requereix un consentiment explícit que informa que el PDF complet s'envia a un servei d'IA. La nova pantalla crida `import-itinerary` només a petició de l'usuari i mostra el resultat com a **previsualització editable**: marcar o desmarcar cada element, corregir títol, data, hores locals, zona horària, lloc, ciutat, adreça i notes; veure fragments/pàgines originals amb l'advertiment que els indica el model; avisos de camps dubtosos, dates/hores invàlides, duplicats interns, possibles duplicitats amb l'itinerari carregat, i solapaments dins la proposta. El document original es preserva i la prova no modifica els elements del planning.
- El botó «Desar al viatge» continua **deshabilitat** i cap element es persisteix. Les correccions de la previsualització es mantenen només en memòria fins a tancar la pantalla; en canviar de viatge, compte o vista, es destrueixen les dades locals temporals. No es pot fingir que la proposta queda desada. La pujada voluntària d'un PDF nou **sí que desa el document privat** a Documents, com la funcionalitat de pujada existent, abans de llegir-lo.
- La comparació amb duplicats existents és **orientativa**, basada en el planning ja carregat. No substitueix la comparació autoritativa ni els controls d'idempotència de l'A2.8. Els solapaments amb peces confirmades segueixen pendents d'integració amb la revisió consolidada TB-09. No donar per fet que la presentació d'una llista editable equival a importar el viatge.
- Proves A2.7: `scripts/import-itinerary-review.test.mjs` i `scripts/import-itinerary-review-ui.test.mjs`, incloses al job A2 de GitHub; paquet PWA actualitzat a `v11` incorporant els mòduls de revisió. Falten encara validació E2E de la pantalla amb dades i PDF reals en entorn de proves, tractament dels errors del proveïdor en condicions reals, accés a iPhone/PWA i la porta de seguretat de la PR #107 (test offline anterior encara fallant).
- **A2.7.2 (pendent):** coherència completa contra l'agenda operativa i aplicació reutilitzable de TB-09, proves de navegació i d'accessibilitat amb dispositius reals.
- **A2.8**: confirmació explícita i escriptura segura amb permisos, revalidació al servidor, conflictes, idempotència i enllaç al document original.
- **GATE**: prova real a l'iPhone/PWA i comprovació de tornada, recuperació de sessió i errors.

## Consideracions de release

Aquest PR no modifica `main`, ni cap desplegament de Supabase, Railway, producció o dades remotes. **Sí que conté canvis a `index.html`, al `404.html` generat, al paquet Pages i al service worker per a la futura interfície A2.7**, únicament a la branca de proves. **No publicar/fusionar aquest tall com si ja oferís importació d'itineraris: encara és infraestructura sense UI.**

El roadmap canònic v1.2 (8/10) enumera fases de l'àlbum com a pendents encara que ja hi ha implementacions ALB posteriors, i també descriu Offline V2 com a pendent tot i la fusió de #106. Actualitzar-ne l'estat en una revisió **numerada** separada quan es faci la conciliació completa, no en aquesta PR funcional.

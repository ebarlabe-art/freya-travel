# A2.7 · Porta de desplegament segur a Freya PROVES

## Estat comprovat (11/10/2026)

- La PR #108 ha estat fusionada amb 4/4 GitHub Actions PASS.
- La PR #107 inclou lector de text/PDF d'itineraris, contracte, previsualització editable i proves de navegador. **Continua draft i no s'ha desplegat.**
- Railway ja disposa d'un entorn `preview` (`freya-travel-offline-v2-preview`), però el servei actual segueix una branca d'Offline V2. No s'ha reconfigurat.
- Supabase PROVES existeix independentment a **`waatqrqyddurultrazbn`**, amb 21 taules amb RLS, fitxers privats i RLS verificades, sense usuaris o viatges reals. La funció `import-itinerary` és activa només en aquest backend amb JWT obligatori, però no s'ha exercitat contra OpenAI. La nova funció `import-itinerary` s'ha desplegat **únicament a PROVES**, amb `verify_jwt=true`. **El processament real d'IA i el web PROVES encara no estan connectats/validats**: es requereix la configuració de servidor i proves completes abans d'activar-los.

## Barrera incorporada

`scripts/configure-pages-backend.mjs` permet configurar només el **build generat** per a proves. No edita `index.html` ni `404.html` de font. Per construir una versió connectada a l'entorn de proves independent, definir abans del build:

```sh
FREYA_BACKEND_ENV=staging
FREYA_STAGING_SUPABASE_URL=https://ID-DE-PROVES.supabase.co
FREYA_STAGING_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... 
```

Quan `FREYA_BACKEND_ENV=staging`, el build **falla expressament** si falta qualsevol valor, si la URL no és HTTPS del domini Supabase, si la clau no és una clau pública amb el format esperat o si la URL coincideix amb el projecte productiu. No imprimir les variables en els logs ni posar-les als documents.

Un build sense paràmetres staging manté la configuració tradicional intacta, destinada a producció. Introduir variables staging sense declarar aquest mode també fa fallar el build, per no ignorar-ne silenciosament la configuració.

## Requisits previs al desplegament real

1. **Fet:** projecte `Freya Travel PROVES`, Supabase `waatqrqyddurultrazbn` (pla Free: cost indicat 0 €/mes). No s'han copiat usuaris reals, claus secretes, PDFs privats ni dades de viatges.
2. **Parcialment fet:** `supabase/staging/01_core.sql`, `02_private_documents.sql`, `03_before_accommodations.sql` i migracions canòniques seleccionades (viatges múltiples, checklist genèric, vols, allotjaments, activitats, metadades i itinerari). Hi ha 13+ taules amb RLS. `supabase/staging/verify_rls_rollback.sql` valida lectures, denegació d'insercions alienes i revocació de membres per a dos comptes sintètics, amb `ROLLBACK` i comprovació de 0 dades persistents. **No és encara una rèplica funcional completa de tota l'app**: hi ha mòduls i migracions posteriors pendents.
3. Configurar al backend de proves les claus requerides per a `import-itinerary` i un model d'IA admès. Les claus del proveïdor són **secretes i del servidor**, mai del web. Confirmar límits d'ús i cost.
4. **Funció desplegada únicament a PROVES** (`import-itinerary`, versió 1, JWT obligatori). Encara no s'han fet proves reals amb el proveïdor d'IA ni s'ha canviat la branca Railway. El build de Freya PROVES s'haurà de fer amb variables d'aïllament abans d'activar la pantalla.
5. Provar primer amb un PDF sintètic no sensible i sense dades personals: 2 dies, hores precises, franges del dia, un element duplicat, un horari invertit, una data incompleta, una pàgina no llegible. Comprovar refusos, avisos, fonts i cap escrit accidental.
6. Proves negatives amb dos comptes separats: usuari B no pot llegir ni importar documents d'A, i revocació de permisos després d'eliminar-lo del viatge; proves d'error API 429/503, PDF no vàlid, PDF de més de 10 MB i cancel·lació de revisió.
7. Validar en iPhone/PWA real abans de considerar el següent gate. Mantenir el botó «Desar al viatge» **desactivat** fins a l'A2.8 (escriptura autoritzada amb conflictes, idempotència i confirmació explícita).

**No fusionar la PR #107 ni apuntar Freya PROVES al projecte productiu per avançar més ràpid.** Separar codi validat, infraestructura desplegada i funcionalitat publicada en totes les comunicacions.

## Gate Railway pendent (11/10/2026)

S'ha **staged**, sense aplicar ni desplegar, la configuració de Railway `preview`: URL/clau pública de `waatqrqyddurultrazbn`, `FREYA_BACKEND_ENV=staging` i branca de la PR #107 fixada a un commit revisat. La CI també fa una segona compilació de Pages amb clau pública fictícia i comprova el marcador visible **Freya PROVES**, la igualtat `index.html`/`404.html` i l'absència de l'adreça productiva al HTML. **No aplicar el patch de Railway fins autorització expressa per desplegar**, després de confirmar el commit fixat i la disponibilitat del backend de proves.

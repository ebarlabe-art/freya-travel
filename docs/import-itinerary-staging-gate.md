# A2.7 · Porta de desplegament segur a Freya PROVES

## Estat comprovat (11/10/2026)

- La PR #108 ha estat fusionada amb 4/4 GitHub Actions PASS.
- La PR #107 inclou lector de text/PDF d'itineraris, contracte, previsualització editable i proves de navegador. **Continua draft i no s'ha desplegat.**
- Railway ja disposa d'un entorn `preview` (`freya-travel-offline-v2-preview`), però el servei actual segueix una branca d'Offline V2. No s'ha reconfigurat.
- L'únic projecte accessible de Supabase és **Londres-2026**, `otueskpksylzvkhldoft`, que usa l'app actual. Per tant, **Freya PROVES no té encara una base de dades/servei Supabase independents**. El codi de `index.html` apunta explícitament a aquest projecte mentre no es faci un build de proves aïllat.

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

1. Aprovar la creació/utilització d'un **projecte Supabase de proves separat**. Pot tenir cost segons el pla; confirmar-lo abans de crear-lo. No copiar usuaris reals, claus secretes, PDFs privats ni dades de viatges al nou projecte.
2. Aplicar-hi les migracions i RLS necessàries en un ordre verificat, amb dades fictícies de dos comptes diferents. Confirmar especialment `travel_documents`, bucket `trip-documents`, polítiques d'Storage i relació amb viatge/membres.
3. Configurar al backend de proves les claus requerides per a `import-itinerary` i un model d'IA admès. Les claus del proveïdor són **secretes i del servidor**, mai del web. Confirmar límits d'ús i cost.
4. Desplegar la funció **únicament** al projecte de proves, amb verificació de JWT, sense clau de servei per a les consultes de documents. Crear el build de Freya PROVES amb les variables d'aïllament abans de canviar-ne la branca Railway.
5. Provar primer amb un PDF sintètic no sensible i sense dades personals: 2 dies, hores precises, franges del dia, un element duplicat, un horari invertit, una data incompleta, una pàgina no llegible. Comprovar refusos, avisos, fonts i cap escrit accidental.
6. Proves negatives amb dos comptes separats: usuari B no pot llegir ni importar documents d'A, i revocació de permisos després d'eliminar-lo del viatge; proves d'error API 429/503, PDF no vàlid, PDF de més de 10 MB i cancel·lació de revisió.
7. Validar en iPhone/PWA real abans de considerar el següent gate. Mantenir el botó «Desar al viatge» **desactivat** fins a l'A2.8 (escriptura autoritzada amb conflictes, idempotència i confirmació explícita).

**No fusionar la PR #107 ni apuntar Freya PROVES al projecte productiu per avançar més ràpid.** Separar codi validat, infraestructura desplegada i funcionalitat publicada en totes les comunicacions.

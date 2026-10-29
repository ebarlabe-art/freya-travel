# RIG-03B: contracte i verificació

Implementació sobre PR #189, issue #132. No executada a producció.

## Flux

A la proposta del PDF, «Compara amb el planning existent» llegeix totes les files manuals i les proteccions. Cada candidata requereix conservar una visita, actualitzar una visita, afegir o ignorar. La resta del planning es conserva; retirar és una decisió separada i explícita. Els detalls mostren dia, hora, fus, lloc i possibles coincidències. La proposta original continua editable abans de confirmar.

La confirmació envia una única RPC amb la versió de totes les files. El servidor executa plans, avisos i comprovant en una transacció. Un canvi d'un altre membre invalida la comparació completa. Una resposta incerta bloqueja l'edició i permet repetir el mateix identificador/payload. Reobrir la importació o recarregar la mateixa pestanya recupera el comprovant de `sessionStorage` de l'usuari/viatge; mai executa la RPC automàticament.

La retirada marca `cancelled`; no elimina identitats ni registres. Els plans amb fotos, progrés o horari fix estan protegits. Actualitzar preserva notes, autoria, timestamps de creació, estat i indicadors de reserva/opcionalitat existents. Els nous plans sempre són `planned`, no fixos; un títol condicional es manté com a opcional. No es toquen vols, hotels, reserves, documents ni ubicacions d'altres activitats.

## Horaris orientatius i activitats condicionals (revisió 29/10/2026)

El PDF pot incloure una hora concreta **sense tenir una reserva confirmada**. Durant la conciliació, les candidates que indiquin `orientatiu`, `aproximat`, `a confirmar`, `pendent de reserva`, `segons reserva/disponibilitat/operador`, `opcional` o condicions de neu es desen amb `timing_kind='approximate'` (dia local + hora local aproximada), **no** amb `starts_at` exacte. Això manté l'hora visible com a proposta, però evita un avís erroni d'«una hora abans». No modifica el comportament de les activitats amb horari realment confirmat, que continuen `exact`.

L'opcionalitat comercial/meteorològica no és el mateix que la precisió horària: una sortida amb hora **orientativa** pot no ser opcional, mentre que els **huskies (a confirmar, segons neu)** o el **soft-luge pendent de reserva** són opcionals i aproximats fins a reserva. Una actualització pot passar un pla existent a `is_optional=true` si l'activitat s'ha condicionat, però mai no li treu l'opcionalitat prèvia sense decisió d'usuari. Les hores aproximades no generen un nou recordatori exacte; si una visita existent perd l'horari definitiu, el seu recordatori exacte s'inhabilita dins de la mateixa transacció. Quan hi hagi reserva, l'usuari pot editar el planning per fixar l'hora definitiva.

La revisió mòbil informa que l'hora es conservarà com a aproximada i que no es generarà un avís exacte. Regressions: `scripts/itinerary-reconciliation-ui.test.mjs`, `scripts/test-itinerary-reconciliation-db.mjs`, `scripts/check-itinerary-reconciliation-browser.mjs`, amb sortida de Riga (08:30 orientatiu), soft-luge (12:00 pendent) i huskies (10:30 a confirmar segons neu). La migració s'ha aplicat a la base de dades pública amb autorització després d'aquesta validació; no s'ha desat cap activitat de Riga ni modificat cap reserva. Consulta l'inventari per l'alineació de versions.

## Privilegis i compatibilitat

Les RPC públiques són `SECURITY INVOKER`. Les funcions privades `SECURITY DEFINER` tenen `search_path=''`, verifiquen `auth.uid()` i `is_trip_member`, exclouen Londres i només accepten camps manuals autoritzats. No es concedeix INSERT/UPDATE sobre `trip_reminders` ni EXECUTE sobre el sincronitzador global. L'auditoria privada té RLS i no es concedeix lectura als clients. El sincronitzador de notificacions existent consulta l'estat actual dels recordatoris; els retirats queden inhabilitats.

La migració no altera files existents ni contractes del frontend anterior. Sense migració, la nova comparació falla visiblement i no envia canvis. Després d'autorització, ordre de publicació: migració → comprovació permisos/RPC → frontend. No hi ha Edge Function nova. Marcador `pwa-itinerary-reconciliation-rig03b`; cache `freya-travel-release-6444-v43` amb els dos mòduls de conciliació.

## Proves reproduïbles (només sintètiques)

- `npm test`, `npm run build`, `npm run entries:check`.
- `PGLITE_MODULE=<pglite/dist/index.js> RIG_SQL_FIXTURE=<fitxer temporal> node scripts/test-itinerary-reconciliation-db.mjs`: migracions reals més baseline històric mínim documentat, 13 plans/12 avisos, permisos anon/membre/aliè, document aliè, proteccions, camps immutables, rollback d'error tardà, idempotència i snapshots.
- `bash scripts/ci-postgres.sh start <contenidor sintètic>` i `RIG_PG_CONTAINER=<contenidor> RIG_SQL_FIXTURE=<mateix fitxer> node scripts/check-itinerary-reconciliation-concurrency.mjs`: dues connexions independents, només una operació acceptada i recuperació local de la retirada. Crea una base `rig03b_<timestamp>` exclusivament dins aquest contenidor de proves.
- `RECONCILE_ENGINE=chromium|webkit PLAYWRIGHT_MODULE=<playwright-core/index.mjs> node scripts/check-itinerary-reconciliation-browser.mjs`: build real, transport simulat i qualsevol xarxa externa bloquejada. 390 × 844, 25 candidates, target real del contracte, confirmació/cancel·lació, resposta lenta/perduda, recàrrega, idempotència i conflicte visible. `RECONCILE_TABLET=1` per tauleta amb identificació d'escriptori.
- `IMPORT_ENGINE=chromium|webkit ... node scripts/check-import-exclude-browser.mjs`: regressió del flux add-only i exclusió 21 → 0.

## Recuperació supervisada

Primer conservar el comprovant `operation_id` i no repetir la importació amb un altre identificador. El reintent idempotent retorna el resultat original si ja s'havia executat. Cap reintent amb payload diferent ni un altre actor reutilitza el comprovant.

Una recuperació administrativa requereix autorització explícita: llegir `itinerary_private.reconciliations` en privat; comprovar que no hi ha operacions o edicions posteriors; bloquejar el viatge i els plans; comparar l'estat actual amb el resultat; restaurar només els camps modificats des de `before_items` i els avisos manuals corresponents des de `before_reminders` en una sola transacció. Les noves visites s'han de revisar i cancel·lar explícitament si escau, mai eliminar-les cegament si tenen fotos o progrés. Preservar el comprovant original com a auditoria; registrar la recuperació administrativa. El test exercita la reversió d'una retirada i els seus avisos, no autoritza una reversió general de producció.

Es pot tornar al frontend anterior sense desfer la migració additiva. La retirada cancel·lada continua llegible al frontend antic. No hi ha rollback públic automàtic ni migració destructiva.

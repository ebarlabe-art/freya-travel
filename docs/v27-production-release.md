# V27 — actualització controlada de la pública

Destí únic: Londres-2026 / otueskpksylzvkhldoft, GitHub Pages existent.
Branca: fix/automatic-itinerary-places-v27, PR #147. No publicar ni fusionar sense autorització expressa posterior als requisits de recuperació.
Cap canvi a Nova, Proves, Railway, Auth, buckets, cron, proveïdors o plans.

## Abast exacte

Frontend: index.html, 404.html generat, sw.js; domain/itinerary-quick-place.mjs, itinerary-route.mjs, itinerary-route-ui.mjs.
PDF compartit: domain/import-itinerary-text-extractor.mjs (també dependència del bundle import-itinerary).
Única migració: supabase/migrations/20261016153108_itinerary_resolved_location_v27.sql.
Actualitzar les funcions arrel supabase/functions/import-itinerary, place-resolution i itinerary-route amb totes les dependències imports. import-reservation v5 es conserva: el codi desplegat és idèntic. Les anotacions de tipus afegides no canvien l'autenticació ni la lògica.
L'únic canvi del normalitzador Geoapify és retornar locality; routing reutilitza geografia desada i retorna punts per al mapa.

Exclosos i retirats de la branca: validation/v27/**, workflow v27-baseline i generador/config/tests de frontend independent. Es conserven evidències a l'historial 966005d78bd5dbe581ddaab0c46a6ec97f87c4ed i al ZIP de verificació anterior. No aplicar cap baseline ni migració històrica a la pública. Els tests de regressió i el PDF sintètic no són recursos de desplegament.

## Requisits previs: aturar si falta qualsevol element

- Tancar CI del commit candidat, inclosa reconstrucció del frontend publicat anterior.
- Repetir preflight de catàleg immediatament abans d'aplicar; els noms v27 no han d'existir. Confirmar RLS i permisos existents de les dues taules; no afegir grants generals.
- Còpia coherent recent de dades/esquema/ACL i historial, custodiada fora del repositori, amb SHA256, data i evidència de recuperació. Copiar també fonts Edge desplegades i configuració JWT abans d'actualitzar.
- Confirmar que s'accedeix a GitHub Pages i a la mateixa instància Supabase amb permisos de restauració; no n'hi ha prou amb llegir metadades.
- Login i lectura d'un viatge/document conegut des del compte autoritzat. No crear ni canviar el viatge real de Bolonya per fer aquest preflight.
- Confirmar presència i quotes de les variables existents. No publicar-ne valors ni reinicialitzar sessions/claus.

## Còpia i comprovació sense subscripció

La sessió actual no té connexió PostgreSQL configurada i el proxy del shell és inaccessible; el connector SQL no substitueix pg_dump ni ofereix descàrrega de backups. No s'ha exportat cap fila personal.

En un ordinador de confiança amb PostgreSQL 17, usar la connexió del projecte existent en mode directe o pooler de sessió, SSL verificat i un fitxer de credencials amb permisos 0600; no passar contrasenyes en arguments, missatges o historial. No usar pooler de transaccions.
Fer pg_dump en format custom de public, app_private, place_private, proposal_private, auth, storage i supabase_migrations, conservant ACLs i dependències. Verificar prèviament els esquemes realment presents. Guardar també rols/config necessaris sense contrasenyes, versions i extensions. Exportació únicament de lectura; no modificar producció.
Custodiar el resultat xifrat, privat i fora de GitHub, amb permisos restrictius i checksum. Un llistat pg_restore --list només valida l'arxiu, no la recuperació: cal evidència d'assaig de restauració en un PostgreSQL compatible amb els rols/extensions Supabase i contrast d'ACL, constraints i totals sense imprimir contingut personal. Fer-ho al dispositiu de confiança, sense nou projecte o servei remot i sense pujar dades al runner públic.
Si s'aporta una còpia existent, verificar data, projecte, cobertura i evidència de recuperació abans de considerar aquest punt PASS. No executar una restauració sobre la pública com a prova.
Una còpia PostgreSQL inclou metadades Storage, no els bytes dels fitxers. Aquesta publicació no elimina ni reescriu objectes existents: conservar-los in situ. Si cal recuperar-los independentment, cal còpia privada dels objectes seleccionats amb checksums; no declarar un dump com a backup complet de documents.

Fonts actuals de quatre Edge guardades a /workspace/v27-production/backups amb manifest i SHA256; copiar-les a la custòdia privada abans de dependre'n. No contenen secrets.
Frontend anterior: d7fee2f307b80bc621392465da67b6a5a6a6a182, run Pages 38813083232. Ja no hi ha artefacte descarregable. Reconstruir amb npm ci i build, comparar index/404 i conservar dist + lockfile + versions + checksum abans de publicar. CI comprova aquesta reconstrucció sense fer desplegaments. Un build correcte no acredita una reversió publicada.

## Configuració existent, sense mostrar secrets

Servidor: OPENAI_API_KEY i A2_IMPORT_MODEL (o fallback TB04_CANDIDATE_MODEL); GEOAPIFY_API_KEY.
Supabase aporta SUPABASE_URL, SUPABASE_ANON_KEY i SUPABASE_SERVICE_ROLE_KEY a Edge; no rotar-les ni copiar-les al frontend.
Mantenir verify_jwt=true a les tres funcions; no desplegar wrappers de validació ni usar --no-verify-jwt.
Frontend públic: conservar URL i clau pública actuals de index.html. Els VITE_SUPABASE_* del workflow no substitueixen aquestes constants.
No tocar Auth Site URL, redirect URLs, proveïdors, SMTP, Storage o les notificacions existents.
Confirmar quotes/crèdits existents abans de cridar OpenAI/Geoapify. No fer smoke tests contra proveïdors mentre no s'hagi acceptat aquest consum dins del pressupost existent. No activar cap ampliació de pla ni facturació.

## Seqüència després de l'autorització expressa

1. Fixar SHA candidat i còpies verificades. Informar l'usuari de la finestra; evitar edicions simultànies durant el canvi curt.
2. Aplicar NOMÉS la migració 20261016153108, atòmica. Establir SET LOCAL lock_timeout='3s' i statement_timeout='30s' dins de la mateixa transacció d'aplicació, després de begin, sense reescriure la migració versionada. ON_ERROR_STOP; no db push/reset/historial complet. Si falla, rollback i aturar.
3. Verificar dues columnes nullable, dues constraints, dos triggers i funció SECURITY INVOKER; mateixos permisos/RLS. Confirmar que PostgREST veu les columnes, recarregant l'esquema si cal. Les dades/horaris existents romanen iguals.
4. Desplegar place-resolution; comprovar que el contracte anterior continua i retorna locality. Desplegar import-itinerary amb el mòdul d'extracció actualitzat. Desplegar itinerary-route només després que les columnes siguin visibles. Usar sempre el project-ref explícit i verificar versió/JWT de cada funció; aturar si canvia el destí.
5. Amb el frontend anterior encara publicat, validar login/lectura i importacions controlades: el backend ha de continuar compatible. En cas de fallada, restaurar només la funció modificada i aturar.
6. Publicar frontend pel workflow GitHub Pages existent NOMÉS amb autorització. main publica automàticament: la fusió de #147 forma part de l'autorització, no del preflight. No desplegar la branca amb VITE com a suposat mecanisme d'aïllament.
7. Validar usuari representatiu a Safari/PWA abans d'anunciar disponibilitat. És un desplegament seqüencial amb comprovacions, no un percentatge de trànsit: tots els clients poden rebre el frontend un cop publicat.
8. Acceptar només si passen login, viatge/document existent, reserva, PDF d'itinerari, persistència i horaris. Registrar SHA, versions, resultat i hora sense captures de dades sensibles.

## Reversió i criteris d'aturada

Aturar amb errors de login/lectura, documents inaccessibles, canvi d'horaris/reserves, regressió general o errors persistents d'importació. Un lloc ambigu pendent és el comportament esperat, no motiu per forçar coordenades.
Si falla una fase prèvia al frontend, no publicar-lo. Restaurar el bundle desplegat guardat de la funció afectada, mantenint JWT i secrets.
Si falla el frontend: tornar a publicar el dist anterior verificat pel mateix GitHub Pages. Alternativa operativa: reexecutar el workflow del run 38813083232 fixat al commit anterior (requereix haver-ne comprovat el build, dependències i permisos). Aquesta acció és un desplegament i requereix autorització.
Conservar les dues columnes nullable, funció i triggers; no executar DROP ni restaurar tota la base per revertir la UI. Evita perdre geografia creada i continua compatible amb clients v27 oberts.
Mantenir inicialment les funcions noves compatibles si només falla UI; si el defecte és a Edge, recuperar-ne la versió anterior guardada. Els clients v27 que continuïn oberts poden perdre enriquiment automàtic fins a recarregar; no eliminar sessions ni esborrar dades locals.
Verificar que el worker anterior s'instal·la en reobrir en línia; la reinstal·lació/cache no és instantània en tots els telèfons. No demanar esborrat de Safari o logout com a pas general.
Només davant corrupció de dades confirmada: aturar escriptures, preservar les posteriors a la còpia, preparar recuperació selectiva i obtenir autorització específica. Una restauració global pot perdre canvis nous i no és la reversió ordinària.

## Acceptació a l'iPhone amb PDF real de Bolonya (30–45 min)

Prerequisit: publicació autoritzada, còpies verificades, compte de l'usuari i PDF a Fitxers. L'usuari opera el dispositiu; no enviar contrasenyes ni documents al repositori.
1. Safari: entrar a la URL pública habitual, iniciar sessió; obrir un viatge conegut i un document existent. Registrar només PASS/FAIL.
2. Al viatge de comprovació autoritzat dins de la mateixa pública, importar una reserva de prova; revisar abans de desar i confirmar document vinculat. No alterar reserves reals.
3. Importar el PDF real de Bolonya des de Fitxers. Comparar TOTES les dates/hores i reserves amb el PDF abans de confirmar. Revisar especialment activitats de matinada i Europe/Rome; no acceptar un any o canvi de dia inferit incorrectament. Cancel·lar si hi ha discrepàncies.
4. Desar una sola vegada; recarregar: no hi ha duplicats. Obrir dies: llocs inequívocs s'enriqueixen; homònims/adreces dubtoses queden pendents. Comprovar almenys un lloc real al mapa i un trajecte entre dos punts correctes. Les rutes no canvien hores ni reserves.
5. Verificar marges insuficients, retorn del mapa, correcció manual d'un lloc i persistència després de recàrrega. Si Geoapify falla o exhaureix quota, l'agenda continua disponible i no inventa rutes.
6. PWA instal·lada: tancar/reobrir sense esborrar dades; obrir agenda/document preparat en mode avió, tornar en línia i comprovar que no duplica ni canvia res.
7. Confirmar que el viatge real de Bolonya es conserva íntegre. Eliminar només les dades de comprovació identificades i autoritzades; no esborrar documents compartits o el viatge real.

Registrar al final: iOS, Safari/PWA, SHA/versió visible, PDF (identificador privat), PASS/FAIL de cada pas i incidències. WebKit automatitzat no substitueix aquest resultat.

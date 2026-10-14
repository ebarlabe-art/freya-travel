# #132 · Fase 1 — arrencada de la mateixa PWA

Base: main 44146db (PR #130, v20). Aquesta entrega és frontend/worker; no requereix Edge Functions, SQL ni canvis de permisos. No s’ha publicat ni fusionat automàticament.

## Què es corregeix i què s’ha reproduït

El build de main s’obre en WebKit normal. No s’ha reproduït el telèfon físic ni acreditat quina fallada exacta aturava «Freya Nova». Sí que es reprodueix que el worker v20 retorna una resposta HTTP 503 en lloc del programa/SDK ja desats, i que les peticions de xarxa no tenen límit d’espera. La prova compara la resposta de l’script anterior (503) amb la nova (cache vàlida). Les injeccions de SDK absent, excepció d’inicialització, sintaxi invàlida i sessió pendent es proven al build real, sense substituir `renderSession` ni el client de dades de l’app.

- El bootstrap anterior al SDK diferencia `sdk`, `app`, `session` i fallada d’actualització del worker. Als 10 segons hi ha recuperació accionable, no una atribució fictícia a la xarxa. Només mostra versió/etapa: mai missatges d’excepció, URL amb tokens, identificadors, email ni dades de viatge.
- «Torna a obrir Freya» reutilitza l’entrada, conserva query/hash (inclosa recuperació d’accés) i espera com a màxim 1,5 s un intent d’actualització del worker. No esborra caches, IndexedDB, localStorage, sessió ni esborranys.
- El worker es registra abans del SDK i del programa principal: pot reparar el shell encara que aquests fallin. Si una app usable rep una actualització, ofereix «Actualitzar»; no la recarrega sobtadament. Només recarrega automàticament una arrencada pendent.
- Navegació i codi segueixen network-first dins de `/freya-travel/`, amb revalidació HTTP, timeout de 4 s i recuperació de la cache actual tant per HTTP no satisfactori com per fallada de transport. Un error de quota en escriure cache no descarta una resposta de xarxa bona. No intercepta altres apps ni desa respostes de Supabase.
- El build continua empaquetant la UMD local de Supabase des de la dependència fixada al lockfile, sense CDN en `dist/`. No s’actualitza el SDK, l’auth ni el contracte RLS. El timeout no inventa sessió ni concedeix accés offline: es mantenen les comprovacions de grant, aïllament i mode només lectura existents.
- Manifest/start_url no canvien. L’entrada v1.5 continua redirigint a la mateixa app conservant els paràmetres. El seu worker es retira sense destruir la cache antiga. Les altres generacions de shell Freya continuen sent substituïdes pel mecanisme existent; caches de documents/fotos/altres apps no es toquen.

## Proves

`npm test`, `npm run entries:check`, `npm run build`; tests de bootstrap, comparació del worker anterior, HTTP 503, xarxa pendent, quota, abast, recuperació i absència de dades privades. La versió esperada passa explícitament a v21; els tests de navegador deixen d’exigir una recàrrega automàtica quan l’app ja funciona.

`scripts/check-pwa-bootstrap-browser.mjs` executa Chromium i WebKit sobre `dist/`, amb SDK real i transport HTTP sintètic. Cobreix fallades/reintent, sessió local absent/persistida, standalone simulat, 390 px i 1024 px tàctil amb identificació d’escriptori, 13 plans sintètics 7+6, recàrrega, workers reals v18/v19/v20 → v21, resposta 503 amb cache, entrada antiga i arrencada offline sense grant. Comprova que les còpies locals sobreviuen i que l’actualització no recarrega una app usable. Rebutja escriptures de dades i intercepta tot el trànsit exterior.

**Límit WebKit automatitzat:** `context.setOffline(true)` provoca un error intern de navegació del motor de Playwright abans de servir la cache; en WebKit es tallen les connexions del servidor de prova i s’estableix l’indicador offline. Chromium també utilitza l’emulació offline nativa. Cap dels dos equival a instal·lar una icona en un iPhone físic; la persistència real de WebKit/iOS, suspensió del procés i cookies del contenidor standalone requereixen la prova física.

La CI també executa les regressions d’agenda parcial/duplicats, rutes, compartició i Travel Book, typechecks i PostgreSQL descartable/RLS. Els resultats sobre el commit exacte consten al cos de la PR.

## Validació i següent pas

Eva, després d’autoritzar fusió/publicació: **obrir la mateixa icona existent, entrar a Riga + Tallin → Itinerari i confirmar 7 plans el 27/12, 6 el 28/12 i reobertura després de suspendre**. Si apareix un error, el botó reintenta sense reinstal·lar. No s’han de crear més icones ni esborrar dades. No es poden eliminar icones extra fins a comprovar i copiar contingut local pendent amb aprovació explícita.

La fase 2 continua amb l’itinerari universal sobre els contractes existents; `PROJECT_STATUS.md` n’és el tauler únic. La release Bolonya no es considera validada fins al circuit amb dues usuàries reals. Cap canvi a les activitats de Riga ni a Freya PROVES.

Referències d’auth consultades: [inicialització Supabase](https://supabase.com/docs/reference/javascript/auth-initialize), [esdeveniments d’auth](https://supabase.com/docs/reference/javascript/auth-onauthstatechange). El changelog consultat no acredita una ruptura aplicable a aquesta arrencada; no es modifica el proveïdor per una sospita.

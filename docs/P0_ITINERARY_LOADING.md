# P0 — Càrrega parcial de l’itinerari (#128)

Base auditada: `main` b2d2a5c, després de PR #127, el 14/10/2026. Canvi de frontend en branca independent, sense fusió ni desplegament. Cap migració, Edge Function, dada de Riga ni dada de Freya PROVES modificada. Les 13 files reals i la política SELECT `is_trip_member(trip_id)` consten a l’evidència de la issue; aquesta tasca no ha tornat a consultar comptes reals. La migració del repositori manté aquest contracte RLS i totes les consultes continuen sota la sessió de l’usuari i el filtre de viatge.

## Diagnòstic reproduït

La prova del build de main amb 13 plans manuals sintètics i error a `trip_flight_documents` falla esperant els 13 elements: `loadGenericItinerary` buida la projecció quan qualsevol de les quatre fonts no està preparada. `normalizedItineraryProjection`, `rebuildGenericItinerary` i el planificador de renderització també exigien totes les fonts. La consulta independent de la importació continuava trobant els duplicats.

Una font lenta retarda la primera renderització perquè `ensureTripAgenda` espera el lot. Això explica un camí de codi sense pestanyes mentre la càrrega està pendent. En canvi, un error ja resolt arribava a renderitzar les dates del viatge, però amb projecció buida. **No s’ha acreditat quina consulta concreta va fallar al telèfon real**, ni que la cache fos la causa. Es reprodueix i es corregeix el defecte de dependència entre fonts, no es declara resolta producció.

## Contracte de la correcció

- Dies del viatge renderitzats en entrar, abans d’esperar el lot. Cada font disponible alimenta la projecció independentment, amb identificadors d’usuari, viatge i generació; també es filtra cada fila pel viatge.
- `available` separa dades mostrables de `ready`. Un refresc fallit conserva les dades anteriors del mateix context, amb avís. La projecció parcial no es considera completa: Home/ARA/SEGÜENT i la revisió del viatge continuen exigint totes les fonts. Tampoc es calculen trajectes entre visites que podrien tenir una font intermèdia pendent; no canvia el contracte de P0-B.
- Avís persistent i específic per font: carregant, fallida o dades anteriors pendents de verificar. Botó per reintentar només les fonts pendents; «Actualitza» conserva el refresc complet. El missatge no depèn dels avisos transitoris d’edició o importació. Una sessió caducada té un missatge entenedor.
- La recuperació offline omple només fonts encara no disponibles; una còpia antiga d’un sol pla no substitueix els 13 plans acabats de llegir. Les fonts recuperades de cache no es marquen com a lectura fresca i un fallback online no retorna un èxit complet.
- La importació compara el mateix títol normalitzat/dia/hora que la protecció de desament. Si hi ha elements ja desats, mostra el recompte i «Veure les activitats desades», que obre el dia del primer duplicat. Cap confirmació ni `upsert` en aquest cas. En una selecció mixta, explica que només s’han de seleccionar els elements nous. UUID determinista, `ignoreDuplicates` i proteccions de desament intactes.
- Cache PWA v19; `404.html` generat amb el mecanisme existent. Els tests de versió v18 s’actualitzen explícitament a v19, sense relaxar-los.

## Verificació

`npm test`, `npm run entries:check` i `npm run build`. Tests nous de projecció parcial (13/7+6, 09:00 Europe/Riga, refresc fallit, aïllament), reintent de fonts i detecció de duplicats sense mutació. CI obligatòria incorpora aquests tests i el navegador.

`scripts/check-itinerary-loading-browser.mjs` usa el build real de Pages, service worker real i adaptadors de dades sintètics; bloqueja tot el trànsit extern i rebutja qualsevol escriptura. Cobreix 8 dies, 13 plans (7+6), ubicacions nul·les, fallada accessòria de vols, font lenta, avís i reintent, normalitat, cache antiga, reload, `pageshow` de reobertura, importació repetida amb zero escriptures, retorn al tauler, Back/Forward de la categoria/viatge, offline/reconnexió, JWT caducat, resposta tardana després de canvi de compte/viatge i logout. S’executa a 390 px i 1024 px amb tacte i identificació d’escriptori. La simulació `pageshow` no acredita suspensió real d’iOS.

Navegació històrica preservada: Itinerari utilitza «Torna al tauler»; Back/Forward de History API s’aplica al circuit categoria ↔ tauler del viatge. No s’afegeix un router ni es redefineix Back directament dins dels mòduls operatius.

## Pendent físic i publicació

Després d’autorització de fusió/publicació: obrir Riga + Tallin a Safari/PWA iPhone, comprovar 8 dies (26/12–02/01), 7 activitats el 27/12 i 6 el 28/12, esmorzar a les 09:00, sense importar ni editar cap activitat. Comprovar suspensió/reobertura, actualització del service worker i avís/reintent si falla una font. El tancament funcional de la issue depèn d’aquesta verificació; la PR per si sola no la substitueix.

Si al dispositiu persisteix el problema: **obrir Itinerari i enviar una captura que inclogui l’avís de càrrega i les pestanyes dels dies**. No calen credencials ni reimportar el PDF.

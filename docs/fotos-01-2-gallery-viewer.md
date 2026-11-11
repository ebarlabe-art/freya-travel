# FOTOS-01.2 — Retorn del visor (#220)

## Abast i diagnòstic

Base remota `8553327b640d45044b1b1a19db3550b7d7fef6d0` (PR #219, v56). Branca `fix/fotos-01-2-gallery-viewer`. Correcció preparada, no publicada; acceptació definitiva pendent d'iPhone físic.

`closeGenericPhoto()` inicia `history.go(-1)` amb `photoHistoryPending=true` i immediatament elimina `photoNavigation`. L'entrada de destinació de la galeria no té `freyaPhoto`. Quan arriba el `popstate` natiu, `handleFreyaPopState()` no cridava `handlePhotoHistory()` perquè ni la navegació ni el marcador existien. El guard quedava activat indefinidament i `openGenericPhoto()` rebutjava qualsevol altra fotografia.

Evidència abans de corregir: després del primer tancament, WebKit mòbil i Chromium mostren `{pending:true,nav:null,returning:true,marker:null}`. No cal cap error de xarxa o JavaScript per reproduir el bloqueig: el modal s'ha amagat i la imatge s'ha carregat, però el guard impedeix l'obertura. L'estat no depèn d'una URL caducada ni d'un overlay que intercepti els tocs.

La mateixa reproducció amb l'HTML de v55 (`574d52d`) en WebKit falla en el mateix punt. El controlador i el cicle de retorn ja tenien aquest defecte; no és una regressió introduïda per la cua v56. La comparació serveix els recursos locals del packaging i intercepta el SDK amb el fitxer local, sense connexions a producció.

## Canvi mínim

El dispatcher reconeix també `photoHistoryPending` com a transició del visor. El controlador existent allibera el guard i consumeix `photoReturnPosition` després del retorn natiu. Es conserva el bloqueig durant la transició: no s'eliminen proteccions ni s'afegeixen temporitzadors per emmascarar el problema.

Una condició modificada a `index.html`; `404.html` regenerat amb `entries:sync`. Sense canvis al worker de pujada, IndexedDB, signatures, documents, Supabase, RLS, SQL, Edge Functions o dades. Cache v57 preparada perquè el shell corregit substitueixi v56 quan s'autoritzi publicar.

## Proves

- Nova prova unitària del dispatcher real: 12 cicles, guard durant la transició i delegació Home/Builder quan no hi ha retorn pendent.
- Nova regressió `scripts/check-photos-viewer-browser.mjs`: app empaquetada, viewport 390×844, tocs reals, `popstate` natiu, 12 fotografies diferents (6 antigues sense metadades i 6 noves amb metadades), imatge carregada, Back/Forward i retorn des de l'editor. Fixtures immutables, zero escriptures i zero errors JavaScript. Obligatòria als dos motors de CI; captures als artifacts.
- Suite completa: 954/954; fotos: 57/57. Fixtures parcials Home/Builder actualitzats amb `photoHistoryPending:false`, sense relaxar assercions.
- Build, packaging i paritat exacta superats.
- Regressions locals: 21 execucions Chromium i 16 WebKit, incloses fotos, importacions, rutes, viatges compartits, Travel Book, mòbil i tablet segons les suites existents. El test PWA inicial encara esperava v56; s'ha actualitzat a v57 i ampliat amb el salt v56→v57, mantenint les versions anteriors i els casos offline/503.

La CI remota i els resultats finals consten a la PR. Les proves simulen el backend, no acrediten estat remot ni substitueixen l'iPhone físic.

## Validació física i reversió

Després d'autoritzar la publicació: comprovar v57 a la PWA, obrir i tancar almenys 10 fotos antigues i noves, tornar de l'editor i repetir sense reiniciar l'app. No cal tornar a pujar ni eliminar res. FOTOS-01 i #220 no s'han de considerar físicament validats fins que l'usuària confirmi aquesta seqüència.

Abans de publicar, reversió amb el revert de la PR i regeneració d'entrades. Si s'hagués publicat, preparar un revert amb cache nova monotònica, sota autorització; no retrocedir el número de cache ni tocar dades. El rollback recuperaria també el defecte conegut del visor, però no afecta originals ni cua.

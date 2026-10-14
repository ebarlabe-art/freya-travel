# P0 — Arrencada de la PWA instal·lada

L'evidència física en iPhone (14/10/2026) mostra `#loading` visible al cap de 10 s, amb el missatge genèric de connexió. La pàgina sí funciona a Safari. Aquest missatge únicament revela que `renderSession()` no ha aconseguit amagar `#loading`; no acredita una causa de xarxa, ni autoritza una reinstal·lació.

## Canvi de recuperació segura

- Watchdog abans de carregar l'SDK i abans de l'script principal, que identifica la fase `SDK`, `JS`, `AUTH`, `SESSION` o `BOOT` sense exposar tokens, errors de servidor ni informació dels viatges.
- Missatge comprensible al cap de 10s amb botó **Reintenta sense esborrar dades**, que només recarrega el document a petició explícita. No sign-out, cache clear, desinstal·lació ni escriptures remotes.
- `window.__freyaBootStage` marca inici de l'script principal, verificació d'Auth i entrada a `renderSession`. Un error de càrrega de l'SDK o de JS queda separat de la demora de sessió.
- Versió `pwa-bootstrap-v21`, memòria cau `freya-travel-release-6444-v21`, paritat index/404.
- Nova prova en navegador del build Pages amb SDK local bloquejat i mode standalone, més contractes de diagnòstic. Amb SDK indisponible, el missatge ha de ser **SDK** i oferir reintent; res s'esborra.

## Abast i límit

Això recupera control i observabilitat davant un *cold start* fallit. No prova que sigui el mateix error del dispositiu físic ni garanteix actualitzar una instal·lació antiga que no rep els nous fitxers. Si l'iPhone encara mostra l'antic missatge sense codis d'etapa després del desplegament, això mateix és evidència que el codi nou no arriba a aquella instal·lació i cal un diagnòstic de SW/origen amb inspecció del dispositiu. No cal cap quarta icona.

Cap dada de Riga, PROVES, credencial, migració o funció Supabase modificada. No fusionar ni publicar sense autorització i CI completa.

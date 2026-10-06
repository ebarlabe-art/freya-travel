# Travel Book — càrrega del runtime de Pages

## Causa acreditada a `cfb2885` (ALB-05.5)

El HTML processat per Vite importava
`/freya-travel/assets/travel-book-editor-state-BV-BHW6b.mjs`.
Aquest fitxer conservava l'import relatiu `./travel-book-composition.mjs`,
però el paquet només incloïa la dependència a `domain/`.
El navegador rebia un 404 amb HTML a `assets/travel-book-composition.mjs`
i rebutjava la importació de l'editor. Es va reproduir a la publicació
amb Chrome nou, sense service worker controlador.

El test de navegador d'aquest canvi també falla amb el build de `cfb2885`.
El build per si sol i els tests de presència de noms al source no detectaven
la cadena d'importació trencada.

## Contracte de càrrega

- Els tres punts d'entrada Travel Book es resolen explícitament sota `domain/`.
  Vite no els tracta com a assets del HTML.
- Les crides concurrents comparteixen una Promise. En cas d'error s'allibera;
  el següent intent utilitza una URL amb un comptador de reintent.
- `package-pages.mjs` empaqueta l'editor i el validador de composició en un
  únic mòdul ES a `dist/domain/travel-book-editor-state.mjs`, amb el Vite existent.
  Això evita també que una dependència estàtica fallida quedi memoritzada pel
  navegador tot i canviar la URL del punt d'entrada. El source de domini no canvia.
- La cache passa de `freya-travel-release-6444-v4` a `v5`. L'activació existent
  elimina caches anteriors i el frontend existent recarrega en canviar controlador.
- No es modifiquen RPC, esquema, desament editorial ni interaccions d'ALB-05.5.

## Verificació reproduïble

Després de `npm run build`:

```sh
PLAYWRIGHT_MODULE=/ruta/playwright-core/index.mjs \
  node scripts/check-travel-book-runtime-browser.mjs
```

`CHROME_PATH` permet utilitzar un Chrome instal·lat; si s'omet s'utilitza
el Chromium instal·lat per Playwright. `PAGES_DIST` permet provar un altre build.
CI instal·la `playwright-core@1.63.0` en un directori temporal, sense dependència
nova de l'aplicació, i executa el test abans de publicar l'artefacte de Pages.
També és un pas bloquejant del job de build de la PR.

El test serveix el `dist/index.html` real sota `/freya-travel/`, comprova
les respostes JavaScript, la càrrega completa, l'absència de 404 de mòduls,
els reintents després d'un error de xarxa de cada punt d'entrada i la cache
PWA amb càrrega de mòduls offline. El client Supabase prové del paquet local
per evitar dependència del CDN; les peticions al backend remot estan bloquejades.
No és una prova autenticada ni una simulació del desament remot.

## Estat de validació d'aquesta correcció

- Build local i paritat `index.html` / `404.html`: correctes.
- 36 tests focalitzats de proposta, batch, editor, UI i empaquetament: correctes.
- Chrome nou sobre el build real, reintents i cache PWA: correctes.
- Control negatiu sobre el build anterior: detecta l'error original.
- Prova autenticada títol → text de foto → sticker → recàrrega → persistència:
  pendent d'una sessió i de la selecció de l'àlbum de prova. No fusionar ni
  publicar aquesta correcció fins a completar-la.
- Safari/iPhone/iPad físics: no verificats en aquesta execució.

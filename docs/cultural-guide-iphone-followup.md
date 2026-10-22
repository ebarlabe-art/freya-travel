# Guia cultural automàtica · correcció després de #178

Base: `main` `3068a21` (#178 fusionada). Branca independent `fix/cultural-guide-automatic-iphone`. Cap desplegament, migració o canvi de dades de producció. No s’ha utilitzat Freya Travel PROVES.

## Diagnòstic acreditat

Consultes de lectura al projecte públic i al frontend de Pages el 22/10/2026. L’Edge `cultural-guide` està activa en versió 1, amb JWT, i conté el codi de #178. El mòdul servit públicament conté el flux manual i l’antic tractament d’errors.

Els logs de l’incident mostren cerques HTTP 200 a les **16:43:24** i **16:43:28 UTC**, seguides d’un **POST HTTP 503 a les 16:43:50**, amb durada **14.941 ms**. No és una generació satisfactòria amagada. Els logs d’execució disponibles només contenen boot/shutdown: el codi antic convertia qualsevol excepció en un error JSON sense registrar-ne la fase. No s’ha recuperat el cos exacte d’aquell 503; **no es pot demostrar si el proveïdor públic, el model o la validació de cites van ser-ne la causa original**. No s’han fet crides de generació autenticades sobre viatges reals ni consultat les seves reserves/documents.

La lectura directa actual de les fonts públiques italianes, amb l’adaptador del repositori, troba `Basilica di San Petronio` (pageid 126506) i en recupera text i coordenades en aproximadament 1,8 s des d’aquest entorn. Això acredita disponibilitat en aquella comprovació, no l’estat de la xarxa de l’Edge durant l’incident, ni el funcionament del model real.

Dues causes de l’aparença de silenci sí que es reprodueixen al codi publicat:

1. `functions.invoke` retorna els HTTP no satisfactoris com `FunctionsHttpError`, amb el JSON a `error.context` i `data: null`. El client antic només llegia `data.error`, perdent el motiu específic.
2. El generador era després de sis seccions buides; l’estat s’actualitzava al principi d’un diàleg desplaçable. L’usuari situat al botó no veia ni la càrrega ni l’error. L’estat tampoc es conservava com a part de la renderització.

## Comportament corregit

- En obrir un lloc verificat sense fitxa ni esborrany, es prepara automàticament la proposta, després de consultar si hi ha una fitxa compartida. Una fitxa existent, un esborrany local o el mode offline no tornen a generar ni substitueixen el text.
- En una visita amb diversos monuments, es tria el monument concret; cadascun conserva la seva identitat. L’acció `prepare` cerca fonts públiques en català, amb alternativa italiana per llocs d’Itàlia i després anglesa. Prioritza títols exactes i valida noms/àlies i geografia amb el contracte existent abans del model. Diverses coincidències vàlides requereixen confirmació explícita. La simple proximitat no decideix.
- Articles inexistents, de desambiguació o sense text vàlid es descarten; errors de xarxa i timeouts no es tracten com una identitat demostrada. Es conserva la selecció manual com a alternativa i la compatibilitat amb `search`/`propose`.
- Es mostra primer la guia escrita i les fonts, en mode lectura, després els controls Escolta/pausa/represa/aturada/velocitat i l’edició/desament. Quan encara no hi ha cap text, no es mostren sis seccions buides; continuen disponibles si s’edita manualment. La proposta no es comparteix fins a confirmar la revisió humana i prémer Desa.
- Capçalera amb títol, Tanca i estat sempre visible; només el cos fa scroll, amb alçada `dvh`, safe area, controls tàctils i text d’edició de 16 px. La càrrega desactiva accions duplicades; errors accessibles `role=alert`, reintent i límit de 65 s. Tancar o canviar de lloc avorta la petició del navegador i invalida respostes tardanes.
- La UI llegeix el JSON de `FunctionsHttpError`, diferencia fallada de xarxa i resposta invàlida, i conserva l’estat en rerenderitzar. No mostra cossos HTML ni errors arbitraris del proveïdor.
- El servidor retorna codi, fase i referència de diagnòstic aleatòria en les excepcions. El log estructurat només conté aquests camps i, quan està disponible, l’estat HTTP del model. No registra tokens, usuaris, viatges, reserves, textos ni respostes del model. Permet investigar una recurrència amb la referència visible, sense inventar retrospectivament la causa del 503 antic.

Es conserven RLS, CAS, unicitat, atribucions/revisions de Wikipedia, snapshot per al Travel Book, cache per usuari/viatge, consulta offline, 13 guies de Londres i veu alternativa només amb consentiment. Cap canvi de taules, migracions, itineraris, reserves ni guies ja desades. Worker v42 per renovar el mòdul cachejat, sense publicar-lo automàticament.

## Validació i prova física

La prova de navegador existent, obligatòria a Chromium mòbil/tauleta i WebKit, ara inclou l’activitat composta exacta reportada. Utilitza el **client Supabase Functions real** de l’artefacte empaquetat, però apunta exclusivament a un servidor HTTP local, amb CSP i fetch guard per impedir connexions externes: HTTP 503 amb JSON, fallada de xarxa, reintent correcte, text abans de veu, error visible amb scroll, revisió obligatòria i zero escriptures operatives. Es mantenen els cinc monuments de Bolonya, Eivissa, Londres, CAS, Back/Forward, respostes tardanes i offline. Tests del handler cobreixen selecció inequívoca, ambigüitat, alternativa de llengua, identitat incorrecta, timeouts i diagnòstic sense dades privades.

Per repetir a iPhone sense tocar producció: seguir el servidor local amb fixtures i HTTPS de confiança documentat a [cultural-guide-167.md](cultural-guide-167.md). Obrir un lloc nou: ha d’aparèixer directament una proposta llegible. Revisar text/fonts, escoltar, editar i desar. Canviar de monument i comprovar que no es confon San Petronio amb Piazza Maggiore o el Nettuno. Activar mode avió després de desar i reobrir la fitxa. La prova automatitzada simula servidor/xarxa; la veu i suspensió reals requereixen validació física.

Després de revisar i autoritzar: desplegar la nova Edge abans del frontend, perquè `prepare` és una acció nova. No cal migració. Un client anterior continua funcionant amb `search`/`propose`. La reversió de frontend/Edge conserva totes les dades. No s’ha efectuat cap d’aquests desplegaments.

## Resultats locals

- `npm test`: **814/814**, cap prova omesa; 19 contractes centrats en guia/HTTP/TTS.
- `npm run build`, paritat `index.html`/`404.html`, comprovació de l’artefacte públic, `actionlint` i `deno check cultural-guide/index.ts`: correctes.
- Chromium mòbil i tauleta amb identificació d’escriptori: flux automàtic, servidor 503 i xarxa amb SDK real, reintent, text/fonts abans de veu, revisió, cinc identitats, offline i regressions correctes. Captura mòbil inspeccionada.
- Regressions Chromium: Activitats compartides, càrrega parcial d’Itinerari i bootstrap/PWA, inclosa recuperació del worker i inici offline, correctes.
- Migració cultural existent executada només en PGlite sintètic: permisos, identitat, unicitat, concurrència i eliminacions correctes. No s’ha canviat ni reaplicat remotament.
- WebKit s’executa al job obligatori independent de CI; les biblioteques de sistema necessàries no són presents a l’executor local. El resultat remot concret es registra a la PR. La prova física d’iPhone i el model amb fonts reals continuen pendents; no són substituïts pels fixtures.

La primera CI de seguiment (`39818957882`) detectà una incidència d’aïllament del fixture a WebKit: el cas de 503 rebia una resposta d’autenticació perquè heretava el client configurat per al projecte públic i depenia de la intercepció Playwright. S’ha corregit el test, sense canviar-ne les assertions: client Functions real independent amb URL només local, resposta 503 real del servidor Node local i connexió local tallada per simular xarxa. CSP i un fetch guard impedeixen accés extern. La comprovació exigeix que el servidor local hagi rebut la petició exacta de San Petronio.

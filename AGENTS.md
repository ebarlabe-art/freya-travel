# FREYA TRAVEL — AGENTS.md

## 1. Què és Freya Travel

Freya Travel no és simplement una aplicació per guardar reserves.
És una companya de viatge que acompanya l’usuari durant tot el cicle:
Somiar-lo → Planificar-lo → Viure’l → Recordar-lo → Compartir-lo
L’aplicació ha de poder servir tant per construir un viatge des de zero com per incorporar un viatge ja organitzat i convertir-se en la seva agenda, guia i punt central d’informació.
Després del viatge, ha de transformar la informació, les fotografies i els records acumulats en contingut que permeti reviure’l.
El viatge és la unitat principal de producte i de col·laboració.

## 2. Principis de producte

Tota implementació ha de respectar aquests principis:

- Menys clics és millor.
- Una dada s’ha d’introduir una sola vegada i reutilitzar-se allà on sigui útil. Això no impedeix crear snapshots o revisions versionades quan sigui necessari per preservar una edició, exportació o estat històric reproduïble.
- Les diferents parts del viatge han d’estar connectades.
- La IA ajuda, proposa i automatitza, però l’usuari manté el control final.
- Freya ha d’intentar fer primer la feina que pugui fer per l’usuari, en lloc de presentar-li sistemàticament una pantalla buida.
- La informació operativa és important, però els records tenen el mateix valor que la planificació.
- La complexitat tècnica no s’ha de traslladar a l’usuari.
- Les funcionalitats s’han de pensar primer per a ús real durant un viatge, no només per funcionar en una demo.
- Cal prioritzar iPhone/PWA i experiència mòbil sense impedir una bona experiència en iPad i escriptori.
- No s’ha de duplicar funcionalitat ni crear sistemes paral·lels quan ja existeix un contracte reutilitzable.

## 3. Regla principal abans de modificar codi

Inspecta abans de tocar.
Abans d’implementar una funcionalitat o corregir un problema:

1. identifica la implementació actual;
2. revisa els contractes i tests relacionats;
3. revisa les migracions i documentació rellevants;
4. comprova si existeix ja una funcionalitat equivalent o parcial;
5. identifica possibles regressions;
6. només aleshores proposa o implementa el canvi.

No assumeixis que la documentació reflecteix necessàriament l’estat actual. El codi de main és la referència tècnica principal, sense perjudici de contractes externs o estat remot que el repositori no pugui acreditar.
Si documentació i implementació divergeixen, assenyala la discrepància.

Distingeix sempre entre:

- codi existent al repositori;
- migració escrita;
- migració aplicada;
- funció desplegada;
- frontend desplegat;
- estat remot verificat.

No afirmis que una funcionalitat està a producció només perquè existeix al repositori.

## 4. Canvis mínims i compatibles

No reescriguis funcionalitat que ja funciona només perquè existeixi una arquitectura teòricament més elegant.
Prefereix:
canvi mínim → compatible → testable → reversible
davant de refactors amplis no necessaris.
No eliminis comportaments existents sense identificar-ne abans la finalitat.
No canviïs arquitectura, dependències, models de dades o fluxos de navegació fora de l’abast de la tasca.
Si detectes deute tècnic no relacionat amb la tasca, documenta’l separadament.
Les exigències futures d’aquest document no autoritzen refactors retrospectius de la infraestructura existent fora de l’abast d’una tasca concreta.

## 5. Git i forma de treball

main és una branca protegida conceptualment.
No treballis directament sobre main.
Cada bloc funcional ha de seguir, sempre que sigui aplicable:
auditoria → proposta → validació → branca → implementació → tests → documentació → PR
Una funcionalitat o correcció independent ha d’anar en una branca/PR independent quan això redueixi risc o faciliti revisió.
No barregis en una mateixa PR:

- funcionalitat nova;
- refactors no necessaris;
- correccions alienes;
- neteja general;
- canvis cosmètics sense relació.

No facis merge automàticament llevat que la tasca ho autoritzi expressament.

Preserva sempre canvis locals preexistents que no pertanyin a la tasca.
No els restauris, sobreescriguis, incloguis en commits ni modifiquis tret que la tasca ho autoritzi explícitament.

## 6. index.html i 404.html

L’aplicació actual utilitza index.html com a entrada real.
404.html és una còpia generada i ha de mantenir paritat exacta amb index.html.
No editis manualment tots dos fitxers com si fossin implementacions independents.
Utilitza el mecanisme existent del repositori per generar/comprovar aquesta paritat.
No assumeixis que els fitxers React històrics (App.tsx, main.tsx, etc.) són l’entrada actual de l’aplicació.

## 7. Supabase i dades

Les migracions són incrementals.
No modifiquis una migració històrica ja existent per introduir un canvi nou.
Crea una migració nova.
Qualsevol model nou ha de considerar explícitament:

- RLS;
- pertinença al viatge;
- integritat entre registres;
- concurrència;
- idempotència quan sigui pertinent;
- eliminacions;
- dades parcials;
- Storage;
- Realtime quan sigui necessari.

No assumeixis que l’historial de migracions reconstrueix íntegrament l’entorn remot: existeixen contractes històrics/baselines que poden no estar completament representats per les migracions actuals.
No executis migracions sobre producció ni modifiquis dades remotes sense autorització explícita.

Una URL signada és una credencial temporal d’accés, no la identitat persistent d’un actiu.
Els models de dades han de conservar identificadors/rutes estables i generar URLs signades quan siguin necessàries.

## 8. Privacitat

El fet que una dada existeixi dins del viatge no significa que s’hagi de mostrar o reutilitzar automàticament.
Tracta especialment com a dades operatives o potencialment sensibles:

- codis i localitzadors de reserva;
- documents personals;
- dades de contacte;
- informació de pagament;
- notes privades;
- contingut del Builder/Brief que no sigui compartit;
- qualsevol altra dada no necessària per a la funcionalitat.

Una nova funcionalitat només ha d’accedir a les dades que necessiti.

## 9. Navegació i estat

Freya Travel té diversos mecanismes històrics de navegació i History API. No assumeixis que existeix un router únic.
Qualsevol vista nova ha de provar:

- entrada;
- sortida;
- Back/Forward;
- retorn a la vista d’origen;
- recàrrega;
- suspensió/reobertura de PWA quan sigui rellevant;
- canvi de viatge;
- canvi d’usuari quan sigui pertinent.

No solucionis un problema de navegació creant un altre sistema paral·lel sense necessitat.

## 10. Mobile/PWA

iPhone/PWA és una plataforma prioritària.
Qualsevol interfície nova ha de considerar:

- safe areas;
- 100dvh i comportament del viewport;
- teclat virtual;
- mida tàctil dels controls;
- suspensió/reobertura;
- memòria disponible;
- URLs signades que poden caducar;
- connexions lentes o intermitents;
- comportament de Safari/iOS.

No donis per bona una funcionalitat crítica únicament perquè funciona en navegador d’escriptori.
iPad també s’ha de considerar explícitament, inclòs el comportament quan Safari utilitza identificació d’escriptori.

Quan un canvi afecti contractes de dades o recursos carregats per la PWA, comprova també:

- compatibilitat frontend/backend;
- migració necessària;
- Edge Functions relacionades;
- cache/service worker i necessitat d’actualitzar-ne la versió.

## 11. Rendiment i fotografies

Les fotografies originals poden ser grans.
No dissenyis noves experiències visuals assumint que es poden carregar simultàniament tots els originals.
Quan una funcionalitat impliqui moltes fotografies, considera:

- paginació;
- thumbnails/derivats;
- memòria;
- amplada de banda;
- signatures temporals;
- fallades parcials;
- actius inexistents;
- lots grans.

L’actual infraestructura de Fotos utilitza originals i presenta limitacions de volum que no s’han de propagar al futur editor d’Àlbum.

## 12. Tests

Una tasca no està acabada perquè “funciona”.
Abans de considerar-la completa:

- executa els tests rellevants;
- afegeix tests per al comportament nou;
- comprova regressions;
- comprova paritat index.html / 404.html;
- executa build/verificacions quan sigui segur fer-ho;
- indica clarament qualsevol test que no s’hagi pogut executar.

No arreglis tests fent-los menys estrictes per adaptar-los a una implementació incorrecta.
Si un test existent representa deliberadament un contracte antic que la nova funcionalitat substitueix, actualitza’l conscientment i documenta el canvi de contracte.

Els fixtures i tests han de representar els camps i noms reals del contracte vigent.
No facis passar un test mitjançant dades fictícies que utilitzin propietats diferents de producció.

## 13. Dependències

No afegeixis una nova llibreria perquè simplifiqui unes poques línies de codi.
Abans d’incorporar una dependència nova, comprova:

- necessitat real;
- manteniment;
- mida;
- compatibilitat amb Safari/iOS/PWA;
- llicència;
- seguretat;
- possibilitat de desacoblar el model de domini de la llibreria.

Les dades de Freya no han de quedar atrapades en el format propietari d’un editor, renderer o proveïdor extern.

## 14. Integracions externes

Freya ha de mantenir el control del seu model de domini i de les dades del producte.
Els proveïdors externs han de ser adaptadors substituïbles sempre que sigui raonable.
No dissenyis el model central en funció d’un únic proveïdor d’IA, mapes, impressió, cerca o qualsevol altre servei extern.

## 15. Travel Book / Àlbum

El futur Travel Book és una capa editorial pròpia, no una simple representació del planning ni una extensió de la galeria.
Principi central:
Freya fa la primera feina creativa; l’usuari la converteix en seva.
El flux objectiu és:
Crear àlbum → Freya prepara una proposta → usuari edita → Freya ajuda a recompondre → usuari valida → exportació/impressió
No implementis Crear àlbum com un editor buit.
La manera de generar la primera proposta —determinista, IA o híbrida— encara no està definida.
El contracte fix és: Freya genera una proposta inicial editable; l’usuari no comença des d’un editor buit.
El projecte d’àlbum ha de continuar essent editable després de generar un PDF.
El PDF és una exportació, no el model de dades.
El model editorial ha de ser independent del planning operatiu.
Ha de poder representar, progressivament:

- portada;
- pàgines/spreads;
- fotografies;
- textos;
- peus de foto;
- composicions;
- marcs;
- fons;
- mapes;
- rutes;
- stickers;
- dies;
- llocs;
- activitats;
- vols;
- allotjaments;
- restaurants;
- altres records del viatge.

L’arquitectura ha de permetre múltiples àlbums o edicions d’un mateix viatge, encara que la primera UI només exposi un àlbum principal.
Els viatges genèrics són l’objectiu inicial. La implementació històrica específica de Londres no ha de condicionar l’arquitectura del Travel Book. La compatibilitat/importació de Londres s’ha de tractar separadament.
Els membres autoritzats del viatge han de poder participar en l’edició de l’àlbum segons el contracte del viatge.
Els permisos per publicar, eliminar definitivament, exportar per impressió o encarregar una impressió encara no estan definits i s’han de decidir abans d’implementar aquestes accions. No inventis ara els rols.
No incorporis automàticament informació operativa o sensible a un relat.
Les propostes generades per IA han de distingir entre fets confirmats i narrativa/suggeriments.

## 16. Filosofia de l’editor

L’editor de Travel Book no pretén replicar Canva completament.
Ha de proporcionar llibertat guiada:

- Freya proposa bones composicions;
- l’usuari pot modificar-les;
- el sistema manté les restriccions necessàries perquè el resultat continuï essent imprimible.

El model editorial de Freya ha de ser independent de la llibreria visual utilitzada.
Si s’avaluen eines com Konva, Fabric, Polotno o equivalents, fes primer una anàlisi de:

- compatibilitat;
- llicència;
- rendiment mòbil;
- persistència;
- exportació;
- lock-in.

No n’incorporis cap sense validació prèvia.

## 17. Exportació i impressió

Freya ha de conservar la capacitat de generar un document independent del proveïdor d’impressió.
Arquitectura objectiu:
dades Freya → model editorial → renderer → PDF/print-ready → adaptador d’impressió
Un proveïdor d’impressió no ha de determinar l’estructura interna del Travel Book.
Quan sigui possible, envia al proveïdor només els actius necessaris per produir la comanda final.

“Print-ready” és un contracte encara pendent de definir i haurà d’incloure, com a mínim:

- dimensions;
- sagnat/bleed;
- marges segurs;
- resolució;
- fonts;
- espai/color;
- nombre i ordre de pàgines;
- compatibilitat amb el proveïdor d’impressió.

No fixis valors encara.

## 18. Què no s’ha de fer

No:

- treballis directament sobre main;
- reescriguis migracions històriques;
- modifiquis simultàniament funcionalitats alienes;
- introdueixis dependències sense justificació;
- assumeixis que Londres i els viatges genèrics tenen el mateix contracte;
- assumeixis que documentació antiga és vigent;
- carreguis massivament originals fotogràfics;
- confiïs en estat només en memòria per a processos que han de sobreviure una suspensió;
- exportis dades operatives sensibles per defecte;
- facis que una integració externa defineixi el model intern;
- donis una tasca per acabada sense tests.

## 19. Quan apareix una decisió no definida

Si durant una implementació apareix una decisió de producte, arquitectura o privacitat que no està definida en aquest document ni en un contracte existent:
atura aquella decisió i presenta opcions amb conseqüències.
No la decideixis silenciosament.
Sí que pots resoldre autònomament detalls d’implementació que no alterin el comportament, el contracte o l’arquitectura.

## 20. Definició de “fet”

Una tasca només es considera acabada quan:
codi + dades + navegació + seguretat + tests + documentació + comportament mòbil rellevant
són coherents amb el contracte acordat.
“Compila” no significa “acabat”.
“Passa els tests” tampoc significa necessàriament “acabat” si no s’ha provat el comportament real que motivava la tasca.

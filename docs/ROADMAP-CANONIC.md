# Freya Travel · Roadmap canònic

**Versió:** 1.0  
**Data de tall:** 1 d'octubre de 2026  
**Versió publicada de l'app en aquest tall:** 6.4.19  
**Estat del document:** CANÒNIC

> Aquest document substitueix els roadmaps anteriors com a guia operativa del projecte. Els documents i roadmaps previs es conserven com a historial de decisions. Qualsevol nova idea s'ha d'ubicar dins d'aquest roadmap o incorporar-se mitjançant una revisió numerada.

---

## 1. Nord del producte

Freya Travel no és només una app per guardar reserves. És un **assistent personal de viatge** que acompanya tot el cicle:

**Somiar → Preparar → Viure → Recordar**

Aquesta seqüència és també la jerarquia de navegació del producte: Freya ha de canviar el protagonisme de la interfície segons el moment del viatge. Quan un viatge acaba, **Recordar passa al davant**.

Principis que continuen sent obligatoris:

1. **No fer perdre temps al viatger.**
2. **La informació s'introdueix una sola vegada.**
3. **La IA ajuda; l'usuari decideix.**
4. **Tot està relacionat:** activitats, reserves, documents, fotos, notes i context.
5. **Els records tenen el mateix valor que la planificació.**
6. **Freya no fingeix èxits:** si una dada no s'ha desat o actualitzat al servidor, no diu que ho ha fet.
7. **DURANT el viatge, la informació crítica ha de ser immediata i fiable.**

---

## 2. Llegenda

- ✅ **FET** — implementat i incorporat al producte.
- 🟡 **PARCIAL** — base real implementada, però falta completar l'experiència o l'abast.
- ⬜ **PENDENT** — encara no implementat com a funcionalitat de producte.
- 🔵 **FUTUR** — deliberadament fora del nucli que hem d'acabar ara.
- 🧪 **GATE** — comprovació obligatòria abans de considerar un bloc tancat.

---

## 3. Foto real del producte avui

### 3.1 Base i fiabilitat

| Bloc | Estat | Situació real |
| --- | :---: | --- |
| Login i sessió | ✅ | Estable |
| Recuperació de contrasenya | ✅ | Validada també en ús real |
| PWA / instal·lació | ✅ | Operativa |
| Múltiples viatges | ✅ | Crear, llistar, seleccionar i reprendre |
| Navegació i retorn de context | ✅ | Home, viatge, Builder, historial i retorns específics |
| Checklist universal | ✅ | Compartida dins del viatge |
| Documents | ✅ | Mòdul operatiu |
| Offline V1 | ✅ | Lectura de l'última informació bona + estat de connexió + reintent |
| Escriure offline | 🔵 | No es fingeix desament; una possible cua offline queda per una V2 si aporta valor |

### 3.2 Peces operatives del viatge

| Peça | Estat | Situació real |
| --- | :---: | --- |
| Allotjaments | ✅ | Reserva, ubicació, contacte, documents, estat, cost |
| Vols | ✅ | Dades operatives, documents, estat, cost i cerca integrada |
| Activitats | ✅ | Reserva, entrada, documents, notes, Maps, fotos contextuals, estat |
| Transport local/intern | ✅ | Separat d'activitats i integrat al Build/itinerari |
| Cotxe de lloguer | ✅ | Reserva, contracte/dades, fotos entrega/devolució, estat i cost |
| Aparcament | ✅ | Reserva, plaça, GPS/foto |
| Estat de la peça | ✅ | Planificació / Reservat / Confirmat / Cancel·lat coherents |
| Fet / Desfer | ✅ | Progrés compartit sense alterar l'estat comercial |
| Itinerari consolidat | ✅ | Projecta peces operatives i elements manuals |
| Home contextual DURANT | ✅ | Ara, següent, plans, fets, accions operatives |
| Notificacions | ✅ | Circuit universal reparat després d'Eivissa i desplegat |

### 3.3 Fotos i records

| Bloc | Estat | Situació real |
| --- | :---: | --- |
| Fotos compartides | ✅ | Operatives |
| Fotos contextuals | ✅ | Dia/activitat/planning, editor i navegació |
| Crear àlbum | ⬜ | Pendent |
| Diari | ⬜ | Pendent |
| Travel Book | ⬜ | Pendent |

### 3.4 Col·laboració

| Bloc | Estat | Situació real |
| --- | :---: | --- |
| Membres per viatge | ✅ | Infraestructura i permisos existents |
| Unir-se amb codi | ✅ | Flux existent |
| Edició compartida / Realtime | ✅ | Present en els principals mòduls |
| Gestió completa de participants | 🟡 | Falta una experiència pròpia per veure, convidar, retirar i gestionar accés |

---

## 4. Estat del Travel Builder

| Bloc | Estat | Resultat |
| --- | :---: | --- |
| TB-01 / 01.1 · Trip Brief | ✅ | Model estructurat de necessitats i preferències |
| TB-02 · Entrada Builder | ✅ | Dissenya / Inspira'm / Ja sé on / Tinc una idea / reprendre |
| TB-03 · Brief viu | ✅ | Edició progressiva i segura |
| TB-04 · Propostes | ✅ | Generació, exploració, rondes i historial |
| TB-04.4 · Handoff | ✅ | Proposta → viatge operatiu |
| TB-04.4.2 · Resolució de llocs | ✅ | Llocs i zona horària factuals |
| TB-05 · Confirmació | ✅ | Confirmació manual i evidències |
| TB-06 · Costos i pressupost | ✅ | Cost per peça + pressupost viu |
| TB-07 · Cerca | ✅ | Contracte i infraestructura de cerca |
| TB-08 · Build operatiu | ✅ | Vols, allotjament, jerarquia de peces i integració amb pressupost |
| TB-08.5 · Cerca d'allotjament | 🟡 | UX/contracte fets; proveïdors d'hotel encara sense cerca live |
| TB-09 · Ajustos assistits | ✅ | CLOSED · revisió, propostes explícites, cobertura segura i porta final de seguretat |

### Proveïdors

- **Skyscanner Flights:** integració real existent.
- **Geoapify / resolució de llocs:** servei real desplegat.
- **Booking / Expedia / Kayak per hotels/cotxes:** adapters preparats, però la cerca live encara no està activada.
- Regla: **no prioritzar la capa comercial per davant de completar l'experiència Freya.**

---

# 5. Roadmap des d'ara fins al producte publicable

## FASE A · Tancar ABANS: el viatge es construeix i es prepara sol

### A1. TB-09 · Ajustos assistits del viatge
**Prioritat: ✅ CLOSED**

Objectiu: un cop existeix un viatge construït, Freya ajuda a millorar-lo sense substituir la decisió de l'usuari.

**TB-09.1 ✅** — revisió read-only del viatge: solapaments, marges curts, dies carregats, peces sense encaixar, estats pendents i documents absents. Cada avís porta al planning i no modifica cap dada.

**TB-09.2 ✅** — propostes deterministes sobre planning manual flexible, amb explicació, confirmació explícita, control de conflictes i opció personal “Ara no”. Cap vol, hotel, activitat reservada, estat comercial o document es modifica automàticament.

**TB-09.3 ✅** — cobertura ampliada: pot moure qualsevol costat flexible d’un conflicte exacte i redistribuir peces manuals opcionals/flexibles de dies massa carregats, preservant el tipus d’horari i comprovant col·lisions.

**TB-09.4 ✅** — tancament de qualitat: porta de seguretat abans de qualsevol escriptura, revalidació de peça manual/flexible, versió exacta i whitelist estricta dels únics camps temporals que Freya pot modificar.

Ha d'arribar a poder detectar/proposar, entre altres:
- incompatibilitats d'horaris;
- massa càrrega en una franja;
- buits aprofitables;
- distàncies/logística poc raonables;
- elements pendents de confirmar;
- alternatives que respectin el Brief;
- ajustos que l'usuari accepta o rebutja explícitament.

**CLOSED quan:** cap ajust canvia el viatge sense consentiment; cada proposta explica què modifica i per què; historial/estat queden coherents.

### A2. Importació intel·ligent
**Prioritat: P0/P1**

Entrada única de:
- PDF;
- captura de pantalla;
- correu/reserva;
- Word/Excel quan sigui útil;
- document de vol/hotel/activitat.

Freya ha d'extreure una proposta de dades i **demanar confirmació abans d'escriure**.

**CLOSED quan:** un document de reserva pot convertir-se en la seva peça operativa sense reintroduir manualment la mateixa informació.

### A3. Participants
**Prioritat: P1**

Completar la capa de producte sobre la infraestructura existent:
- llista de membres del viatge;
- convidar/compartir;
- veure qui hi té accés;
- retirar accés;
- rol de propietari;
- comportament clar quan s'acaba el viatge.

**CLOSED quan:** la propietària pot gestionar tot l'equip del viatge des de Freya sense dependre d'eines externes.

---

## FASE B · Tancar DURANT: Freya viatja amb tu

La base DURANT ja és funcional. Aquesta fase és de completar, no de reconstruir.

### B1. Temps per arribar / logística immediata
**Prioritat: P1**

Completar el concepte original del Mode Viatge:
- “surts en X minuts”;
- temps estimat fins al següent punt;
- accés directe a la ruta;
- advertiment si el marge és insuficient.

No convertir Freya en Google Maps: integrar/derivar només la informació necessària.

### B2. Revisió E2E DURANT
**Prioritat: P0 abans de publicació**

Prova física real:
- iPhone/PWA;
- dos membres;
- notificacions;
- Home Ara/Següent;
- documents/entrades;
- Maps;
- Fet/Desfer;
- canvi de cobertura;
- reobertura de l'app;
- dades offline;
- conflictes Realtime.

### B3. Offline V2
**Prioritat: 🔵 només si la prova real ho justifica**

Possible cua de canvis locals amb sincronització posterior.

No s'implementa per inèrcia. Només si l'ús real demostra que editar sense xarxa és necessari i es pot resoldre sense conflictes opacs.

---

## FASE C · Construir DESPRÉS: el viatge no s'acaba quan tornes

### C0. Records com a Home natural del viatge passat
**Prioritat: P0**

Quan el viatge passa a estat passat, Freya canvia la jerarquia de la pantalla: **Records passa al davant** i deixa de ser una eina més. Les peces operatives continuen accessibles com a arxiu, però ja no són la prioritat principal.

Records agrupa, sense duplicar dades:
- Travel Book;
- Fotos;
- Diari;
- Mapes del record.

Les fotos deixen de presentar-se com una eina independent en els viatges passats i passen a formar part de Records. La mateixa galeria i les mateixes dades es reutilitzen; només canvia la navegació.

### C1. Crear àlbum / Travel Book
**Prioritat: P0 dins de DESPRÉS**

A partir de les fotos contextuals existents:
- agrupar per viatge/dia/activitat;
- drecera “Crear àlbum”;
- selecció/reordenació;
- títols i petits records;
- portada;
- mapa;
- itinerari;
- fotos;
- textos/diari;
- restaurants i moments;
- estadístiques;
- PDF;
- compartir;
- base per imprimir.

**CLOSED quan:** un viatge acabat pot transformar-se en un record coherent sense reconstruir-lo manualment.

### C2. Diari de viatge, pensat per capturar sense robar temps
**Prioritat: P1**

El diari s'ha de poder alimentar durant el viatge amb el mínim esforç, especialment **amb veu** des del mòbil. L'objectiu no és obligar a escriure mentre es viatja.

Per dia:
- nota de veu ràpida;
- transcripció editable;
- text manual opcional;
- fotos;
- notes/records;
- activitats i llocs vinculats;
- restaurants i moments;
- data i context reutilitzats automàticament.

La veu s'ha de convertir en contingut reutilitzable pel Diari i pel Travel Book. No duplicar informació ja existent ni demanar a l'usuari que torni a explicar allò que Freya ja sap.

### C3. Mapes del record
**Prioritat: P1**

Crear una representació visual del que es va fer:
- mapa de cada dia;
- mapa global del viatge;
- punts procedents de l'itinerari, activitats, allotjaments i llocs marcats com a fets;
- ordre del recorregut quan es pugui derivar amb fiabilitat;
- reutilització dins de Records i del Travel Book.

Per defecte Freya **no ha de rastrejar contínuament la ubicació**. El mapa es reconstrueix a partir de la informació del viatge. Un eventual track GPS real seria una funcionalitat separada, explícita i opt-in.

---

## FASE D · Proveïdors i capa comercial

**Només després que el nucli Freya estigui funcionalment complet.**

### D1. Hotels live
Activar un o més proveïdors reals sobre el contracte ja preparat.

### D2. Cotxes live
Activar cerca real quan el mòdul de cotxe i el Builder estiguin definitivament tancats.

### D3. Ampliació de vols
Valorar nous proveïdors només si aporten cobertura/preu/fiabilitat respecte a l'actual.

Regles:
- cap resultat comercial es converteix automàticament en reserva;
- separar sempre “oferta trobada” de “peça confirmada”;
- evitar dependència d'un únic proveïdor quan sigui raonable;
- no afegir integracions que empitjorin la simplicitat de l'experiència.

---

## FASE E · PREPUBLICACIÓ

### E1. Auditoria funcional
Tots els mòduls principals han de tenir:
- crear;
- editar;
- eliminar/cancel·lar quan correspongui;
- estat;
- errors comprensibles;
- retorn de navegació;
- comportament Realtime;
- comportament amb mala connexió.

### E2. Proves reals
🧪 iPhone/PWA  
🧪 Android/web si entra en abast de publicació  
🧪 dos usuaris simultanis  
🧪 viatge futur / actiu / passat  
🧪 connexió intermitent  
🧪 documents i fotos grans  
🧪 recuperació de sessió/contrasenya  
🧪 notificacions reals

### E3. Qualitat de producte
- coherència visual;
- onboarding;
- textos finals;
- accessibilitat bàsica;
- rendiment;
- gestió d'errors;
- monitoratge;
- privacitat i condicions necessàries per a publicació;
- neteja del llegat específic de Londres quan sigui segur fer-ho.

### E4. Release candidate
Una versió es considera candidata a publicació només si:
1. no hi ha P0 oberts;
2. les dades no es perden;
3. no hi ha falsos “desat”;
4. els fluxos ABANS/DURANT/DESPRÉS essencials són complets;
5. build, tests i desplegament passen;
6. hi ha validació física en dispositiu real.

---

# 6. FUTUR deliberat

No forma part del camí crític fins a publicació:

- 🔵 IA que aprèn preferències de l'usuari al llarg del temps.
- 🔵 Personalització predictiva entre viatges.
- 🔵 Marketplace propi.
- 🔵 Pagaments/reserva automàtica dins de Freya.
- 🔵 Xarxa social o sistema d'“amics”.
- 🔵 Automatitzacions que decideixin o modifiquin el viatge sense confirmació.
- 🔵 Offline V2 si l'ús real no el necessita.

---

# 7. Ordre de treball canònic

A partir d'aquest document, l'ordre per defecte és:

1. **TB-09 · Ajustos assistits**
2. **Importació intel·ligent**
3. **Participants**
4. **Tancar DURANT / temps per arribar + E2E**
5. **Crear àlbum**
6. **Diari**
7. **Travel Book**
8. **Proveïdors hotels/cotxes i ampliacions comercials**
9. **Prepublicació i Release Candidate**
10. **IA personalitzada**, ja com a evolució posterior

Una nova idea només altera aquest ordre si:
- resol un P0 real;
- evita pèrdua de dades;
- arregla una regressió;
- o la Product Owner decideix explícitament canviar la prioritat.

---

# 8. Definició de “FET” a Freya Travel

Un bloc no està FET perquè “es vegi”.

Està FET quan:
- la persistència és correcta;
- funciona amb dades reals;
- no duplica informació;
- respecta permisos i viatge/usuari;
- gestiona errors i conflictes;
- té navegació/retorn coherent;
- passa proves automatitzades pertinents;
- passa build/paritat;
- està desplegat;
- i, si afecta DURANT/PWA, s'ha comprovat físicament en dispositiu quan sigui necessari.

---

# 9. Regla de govern del roadmap

**Aquest és el roadmap de referència.**

Quan aparegui una nova “coseta més”:
1. es descriu;
2. es classifica com P0/P1/P2/Futur;
3. s'ubica en una fase existent;
4. es comprova si substitueix o modifica alguna decisió anterior;
5. només llavors entra al desenvolupament.

Les revisions d'aquest document seran **v1.1, v1.2, v1.3...**.  
No es crea un roadmap paral·lel.

---

## Pròxim pas

> **A2 · Importació intel·ligent**

TB-09 queda CLOSED. El següent bloc canònic és convertir PDF, captures, correus i documents de reserva en propostes de dades operatives que l’usuari confirma abans d’escriure.

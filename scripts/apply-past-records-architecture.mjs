import { readFile, writeFile } from 'node:fs/promises';

const indexUrl=new URL('../index.html',import.meta.url);
const copyUrl=new URL('../404.html',import.meta.url);
const roadmapUrl=new URL('../docs/ROADMAP-CANONIC.md',import.meta.url);
const testUrl=new URL('./past-records-navigation.test.mjs',import.meta.url);

function once(source,from,to,label){
  if(!source.includes(from))throw new Error('Missing '+label);
  return source.replace(from,to);
}

let html=await readFile(indexUrl,'utf8');

html=once(
  html,
  '.generic-trip-tools{margin-top:26px}',
  '.generic-trip-tools{margin-top:26px}.generic-past-records{margin-top:18px;padding:20px;border:1px solid #d8c9e8;border-radius:26px;background:linear-gradient(145deg,#fbf8ff,#f1e9f8);box-shadow:0 16px 42px rgba(79,55,139,.09)}.generic-past-records .generic-trip-section-head h2{font-size:1.55rem}.generic-module-card-future{opacity:.72;cursor:default}.generic-module-card-future .generic-module-icon{background:#f3eef9}',
  'records styles'
);

html=once(html,'<section class="generic-dashboard-intro">','<section id="genericDashboardIntro" class="generic-dashboard-intro">','dashboard intro id');

const homeAnchor='      <section id="tripHome" class="trip-home" aria-label="El viatge ara">';
const recordsSection=`      <section id="genericPastRecordsSection" class="generic-trip-section generic-past-records hidden" aria-label="Records del viatge">
        <div class="generic-trip-section-head"><h2>📚 Records</h2><p>Tot el que vau viure, reunit en un sol lloc.</p></div>
        <div class="generic-module-grid">
          <button class="generic-module-card is-ready" type="button" data-open="travelBookView"><span class="generic-module-icon">📖</span><span class="generic-module-copy"><strong>Travel Book</strong><small>L’àlbum del viatge</small></span><span class="generic-module-arrow">›</span></button>
          <button class="generic-module-card is-ready" type="button" data-open="photosView"><span class="generic-module-icon">📸</span><span class="generic-module-copy"><strong>Fotos</strong><small>Galeria completa del viatge</small></span><span class="generic-module-arrow">›</span></button>
          <article class="generic-module-card generic-module-card-future" aria-disabled="true"><span class="generic-module-icon">🎙️</span><span class="generic-module-copy"><strong>Diari</strong><small>Properament · notes de veu i records per dia</small></span></article>
          <article class="generic-module-card generic-module-card-future" aria-disabled="true"><span class="generic-module-icon">🗺️</span><span class="generic-module-copy"><strong>Mapes del record</strong><small>Properament · recorregut de cada dia i mapa global</small></span></article>
        </div>
      </section>
`;
html=once(html,homeAnchor,recordsSection+homeAnchor,'past records section');

html=once(
  html,
  '<div class="generic-trip-section-head"><h2>Peces del viatge</h2><p>Afegeix el que ja tens reservat i completa el que et falta. Totes les peces són sempre aquí.</p></div>',
  '<div class="generic-trip-section-head"><h2 id="genericConfirmedTitle">Peces del viatge</h2><p id="genericConfirmedCopy">Afegeix el que ja tens reservat i completa el que et falta. Totes les peces són sempre aquí.</p></div>',
  'confirmed section labels'
);
html=once(html,'<section class="generic-trip-section generic-trip-tools" aria-label="Eines del viatge">','<section id="genericTripToolsSection" class="generic-trip-section generic-trip-tools" aria-label="Eines del viatge">','tools section id');
html=once(
  html,
  '<div class="generic-trip-section-head"><h2>Eines del viatge</h2><p>Documents, checklist, pressupost i altres utilitats que t’acompanyen durant tot el viatge.</p></div>',
  '<div class="generic-trip-section-head"><h2 id="genericToolsTitle">Eines del viatge</h2><p id="genericToolsCopy">Documents, checklist, pressupost i altres utilitats que t’acompanyen durant tot el viatge.</p></div>',
  'tools labels'
);

const photoCard='<button class="generic-module-card is-ready" type="button" data-open="photosView"><span class="generic-module-icon">📸</span><span class="generic-module-copy"><strong>Fotos</strong><small id="genericPhotosModuleStatus">Galeria compartida del viatge</small></span><span class="generic-module-arrow">›</span></button>';
html=once(html,photoCard,photoCard.replace('<button ','<button id="genericPhotosModuleCard" '),'photos tool id');

const recordsTool='<button id="genericRecordsModuleCard" class="generic-module-card is-ready" type="button" data-open="travelBookView"><span class="generic-module-icon">📖</span><span class="generic-module-copy"><strong>Records</strong><small>Travel Book del viatge</small></span><span class="generic-module-arrow">›</span></button>\n          ';
html=once(html,recordsTool,'','old records tool');

html=once(
  html,
  "const heading={future:`Falten ${state.daysUntil} ${state.daysUntil===1?'dia':'dies'}`,active:'El teu viatge, ara',past:'Un viatge per recordar',setup:'Prepara el teu viatge'}[state.phase];",
  "const heading={future:`Falten ${state.daysUntil} ${state.daysUntil===1?'dia':'dies'}`,active:'El teu viatge, ara',past:'El que vas fer',setup:'Prepara el teu viatge'}[state.phase];",
  'past home heading'
);
html=once(
  html,
  "state.phase==='past'?'Reviu el viatge des de Fotos i Records, cadascun amb el seu espai.'",
  "state.phase==='past'?'Activitats, plans i moments que van formar part del viatge.'",
  'past home copy'
);

const buildVisibility="    $('genericBuildCard')?.classList.toggle('hidden',!trip.tb_handoff);";
const lifecycle=`    const lifecyclePhase=deriveTripHomeState({trip,ready:false,items:[],checklist:null},new Date()).phase;
    const pastTrip=lifecyclePhase==='past';
    $('genericDashboardIntro')?.classList.toggle('hidden',pastTrip);
    $('genericPushCard')?.classList.toggle('hidden',pastTrip);
    $('genericBuildCard')?.classList.toggle('hidden',pastTrip||!trip.tb_handoff);
    $('genericPastRecordsSection')?.classList.toggle('hidden',!pastTrip);
    $('genericPhotosModuleCard')?.classList.toggle('hidden',pastTrip);
    if($('genericConfirmedTitle'))$('genericConfirmedTitle').textContent=pastTrip?'El viatge':'Peces del viatge';
    if($('genericConfirmedCopy'))$('genericConfirmedCopy').textContent=pastTrip?'Consulta l’itinerari i les peces que van formar part del viatge.':'Afegeix el que ja tens reservat i completa el que et falta. Totes les peces són sempre aquí.';
    if($('genericToolsTitle'))$('genericToolsTitle').textContent=pastTrip?'Arxiu i eines':'Eines del viatge';
    if($('genericToolsCopy'))$('genericToolsCopy').textContent=pastTrip?'Documents, pressupost i altres utilitats es mantenen accessibles com a arxiu del viatge.':'Documents, checklist, pressupost i altres utilitats que t’acompanyen durant tot el viatge.';`;
html=once(html,buildVisibility,lifecycle,'past lifecycle presentation');

await writeFile(indexUrl,html);
await writeFile(copyUrl,html);

let roadmap=await readFile(roadmapUrl,'utf8');
roadmap=once(
  roadmap,
  '**Somiar → Preparar → Viure → Recordar**\n',
  '**Somiar → Preparar → Viure → Recordar**\n\nAquesta seqüència és també la jerarquia de navegació del producte: Freya ha de canviar el protagonisme de la interfície segons el moment del viatge. Quan un viatge acaba, **Recordar passa al davant**.\n',
  'product lifecycle principle'
);

const phaseStart=roadmap.indexOf('## FASE C · Construir DESPRÉS: el viatge no s\'acaba quan tornes');
const phaseEnd=roadmap.indexOf('\n---\n\n## FASE D',phaseStart);
if(phaseStart<0||phaseEnd<0)throw new Error('Missing phase C');
const phaseC=`## FASE C · Construir DESPRÉS: el viatge no s'acaba quan tornes

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
`;
roadmap=roadmap.slice(0,phaseStart)+phaseC+roadmap.slice(phaseEnd);
await writeFile(roadmapUrl,roadmap);

const test=`import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const roadmap=await readFile(new URL('../docs/ROADMAP-CANONIC.md',import.meta.url),'utf8');

test('past trips promote Records ahead of operational sections',()=>{
  const records=html.indexOf('id="genericPastRecordsSection"');
  const tripHome=html.indexOf('id="tripHome"');
  const pieces=html.indexOf('id="genericConfirmedSection"');
  assert.ok(records>0&&records<tripHome&&tripHome<pieces);
  assert.match(html,/genericPastRecordsSection[^]*Travel Book[^]*Fotos[^]*Diari[^]*Mapes del record/);
});

test('Fotos leaves tools when the trip is past and old Records tool is gone',()=>{
  assert.match(html,/id="genericPhotosModuleCard"/);
  assert.ok(html.includes("genericPhotosModuleCard')?.classList.toggle('hidden',pastTrip)"));
  assert.doesNotMatch(html,/id="genericRecordsModuleCard"/);
});

test('past-trip shell changes hierarchy instead of only labels',()=>{
  assert.ok(html.includes("genericDashboardIntro')?.classList.toggle('hidden',pastTrip)"));
  assert.ok(html.includes("genericBuildCard')?.classList.toggle('hidden',pastTrip||!trip.tb_handoff)"));
  assert.ok(html.includes("genericConfirmedTitle').textContent=pastTrip?'El viatge':'Peces del viatge'"));
  assert.ok(html.includes("genericToolsTitle').textContent=pastTrip?'Arxiu i eines':'Eines del viatge'"));
});

test('canonical roadmap keeps the four-stage product compass and defines Records',()=>{
  assert.ok(roadmap.includes('Somiar → Preparar → Viure → Recordar'));
  assert.ok(roadmap.includes('Records com a Home natural del viatge passat'));
  assert.ok(roadmap.includes('especialment **amb veu**'));
  assert.ok(roadmap.includes('### C3. Mapes del record'));
  assert.ok(roadmap.includes('no ha de rastrejar contínuament la ubicació'));
});
`;
await writeFile(testUrl,test);
console.log('Applied past-trip Records architecture.');

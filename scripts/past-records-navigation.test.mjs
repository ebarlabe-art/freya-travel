import test from 'node:test';
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

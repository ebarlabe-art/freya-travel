import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

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
  assert.ok(html.includes("genericConfirmedTitle').textContent=dashboardText(pastTrip?'pastPieces':'pieces')"));
  assert.ok(html.includes("genericToolsTitle').textContent=dashboardText(pastTrip?'pastTools':'tools')"));
});

test('past trips never show the DURANT home block',()=>{
  assert.ok(html.includes("const hideLiveHome=state.phase==='future'||state.phase==='setup'||state.phase==='past'"));
  assert.ok(html.includes("home.classList.toggle('hidden',hideLiveHome)"));
});

test('canonical roadmap keeps the four-stage product compass and defines Records',()=>{
  assert.ok(roadmap.includes('Somiar → Preparar → Viure → Recordar'));
  assert.ok(roadmap.includes('Records com a Home natural del viatge passat'));
  assert.ok(roadmap.includes('especialment **amb veu**'));
  assert.ok(roadmap.includes('### C3. Mapes del record'));
  assert.ok(roadmap.includes('no ha de rastrejar contínuament la ubicació'));
});

test('the trip mosaic uses one card style and localized descriptions and counts',()=>{
  const mosaic=html.slice(html.indexOf('<div id="genericDashboardView"'),html.indexOf('<div id="genericTripSettingsCard"'));
  const copy=html.split('<script id="freyaDashboardTranslations">')[1].split('for(const node')[0];
  const keys=[...mosaic.matchAll(/data-trip-text="(\w+)"/g)].map(([,key])=>key);
  assert.ok(keys.length>25);
  assert.equal((mosaic.match(/class="menu-grid/g)||[]).length,4);
  assert.doesNotMatch(mosaic,/generic-module-(card|grid)/);
  assert.ok(mosaic.indexOf('id="tripHome"')<mosaic.indexOf('id="genericDashboardIntro"'));
  for(const insightsLanguage of ['ca','es','en','fr','it']){
    const context={insightsLanguage};
    runInNewContext(copy,context);
    for(const key of keys)assert.ok(context.dashboardText(key));
    const [one,many]=context.dashboardText('unitFlight').split('|');
    assert.equal(context.dashboardCount('unitFlight',1),'1 '+one);
    assert.equal(context.dashboardCount('unitFlight',2),'2 '+many);
  }
});

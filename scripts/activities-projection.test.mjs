import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
function harness(){
 const c=vm.createContext({Intl,Date,Map,Set,trip:{id:'bologna',time_zone:'Europe/Rome'},session:{user:{id:'u'}},tripLoadGeneration:1,
  itinerarySourceReady:{},itinerarySourceAvailable:{},flightRows:[],accommodationRows:[],activityRows:[],manualItineraryRows:[],
  isLondonTrip:()=>c.trip?.experience_key==='london-2026',scheduleItineraryRebuild:()=>{},manualItineraryMapUrl:()=>'',
  ACTIVITY_TYPES:{other:{label:'Altres',icon:'📍'}},activityLocation:()=>'',activityMapUrl:()=>'',itineraryDocumentsFor:()=>[],
  isLocalTransportActivity:row=>row?.activity_type==='transport',genericItineraryTripDates:()=>[],
  normalizedTripProgress:item=>item});
 c.tripRequestIsCurrent=(id,g)=>c.trip?.id===id&&c.tripLoadGeneration===g;
 c.tripHomeSourceRow=item=>({manual:c.manualItineraryRows,activity:c.activityRows}[item.sourceType]||[]).find(row=>row.id===item.sourceId&&row.trip_id===c.trip.id)||{};
 vm.runInContext(html.slice(html.indexOf('function itineraryTimeZone('),html.indexOf('function flightItineraryMapUrl(')),c);
 vm.runInContext(html.slice(html.indexOf('function suggestedOvernightImportCorrection('),html.indexOf('function tripReviewSuggestionId(')),c);
 vm.runInContext(html.slice(html.indexOf('function planningActivityKind('),html.indexOf('function activitySummary(')),c);
 for(const type of ['manual','activity'])c.markItinerarySourceReady(type,'bologna',1,'u');
 return c;
}
test('Bolonya: every planning identity appears once without reservation, ticket or fabricated exact time',()=>{
 const c=harness();
 c.manualItineraryRows=['exact','approximate','date','all_day','daypart','unscheduled'].map((kind,i)=>({id:String(i),trip_id:'bologna',title:'Piazza Maggiore '+i,timing_kind:kind,local_date:kind==='unscheduled'?null:'2026-12-27',starts_at:kind==='exact'?'2026-12-27T09:00:00Z':null,time_zone:'Europe/Rome',approximate_start_time:'12:00:00',daypart:'morning'}));
 c.activityRows=[{id:'reserved',trip_id:'bologna',title:'Museu',activity_type:'other',reservation_status:'confirmed',start_at:null},{id:'transfer',trip_id:'bologna',title:'Bus',activity_type:'transport'}];
 const before=JSON.stringify([c.manualItineraryRows,c.activityRows]),items=c.unifiedActivityItems();
 assert.equal(items.length,7);assert.equal(new Set(items.map(x=>x.key)).size,7);
 assert.equal(items.find(x=>x.timingKind==='approximate').timeLabel,'~ 12:00');
 assert.equal(items.find(x=>x.timingKind==='unscheduled').localDate,null);
 assert.equal(items.filter(x=>x.sourceType==='manual').every(x=>x.documents.length===0),true);
 assert.equal(JSON.stringify([c.manualItineraryRows,c.activityRows]),before);
});
test('identity deduplication does not merge different records with identical titles',()=>{
 const c=harness(),row={id:'a',trip_id:'bologna',title:'Passeig',timing_kind:'unscheduled'};
 c.manualItineraryRows=[row,row,{...row,id:'b'}];
 assert.deepEqual(Array.from(c.unifiedActivityItems(),x=>x.key),['manual:a','manual:b']);
});
test('partial sources retain scoped rows but never leak between account, generation or trip',()=>{
 const c=harness();c.manualItineraryRows=[{id:'own',trip_id:'bologna',title:'Portici',timing_kind:'date',local_date:'2026-12-27'},{id:'foreign',trip_id:'eivissa',title:'Other',timing_kind:'unscheduled'}];
 c.itinerarySourceReady.manual=null;assert.equal(c.unifiedActivityItems().length,1);
 c.session.user.id='other';assert.equal(c.unifiedActivityItems().length,0);
 c.session.user.id='u';c.tripLoadGeneration++;assert.equal(c.unifiedActivityItems().length,0);
 c.trip={id:'eivissa'};assert.equal(c.unifiedActivityItems().length,0);
});
test('Eivissa uses the generic contract; London keeps its historical experience',()=>{
 const c=harness();c.trip={id:'eivissa'};c.manualItineraryRows=[{id:'walk',trip_id:'eivissa',title:'Dalt Vila',timing_kind:'unscheduled'}];
 c.markItinerarySourceReady('manual','eivissa',1,'u');assert.equal(c.unifiedActivityItems()[0].key,'manual:walk');
 c.trip.experience_key='london-2026';assert.equal(c.unifiedActivityItems().length,0);
});
test('meal and transfer labels are presentation only; unknown plans stay visible',()=>{
 const c=harness();assert.equal(c.planningActivityKind('Dinar lliure').label,'Àpat del planning');
 assert.equal(c.planningActivityKind('Trasllat a l’aeroport').label,'Trasllat del planning');
 assert.equal(c.planningActivityKind('Visita a San Luca').label,'Visita o pla de l’itinerari');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
function harness(){
 const c=vm.createContext({Intl,Date,Map,trip:{id:'a',time_zone:'Europe/Riga'},session:{user:{id:'u'}},tripLoadGeneration:1,
  itinerarySourceReady:{},itinerarySourceAvailable:{},flightRows:[],accommodationRows:[],activityRows:[],
  manualItineraryRows:Array.from({length:13},(_,i)=>({id:String(i),trip_id:'a',title:'Plan '+i,timing_kind:'exact',time_zone:'Europe/Riga',starts_at:`2026-12-${i<7?'27':'28'}T07:00:00Z`,location_name:null})),
  isLondonTrip:()=>false,scheduleItineraryRebuild:()=>{},manualItineraryMapUrl:()=>'',
  normalizedTripProgress:item=>item,tripHomeSourceRow:()=>({})});
 c.tripRequestIsCurrent=(id,generation)=>c.trip?.id===id&&c.tripLoadGeneration===generation;
 vm.runInContext(html.slice(html.indexOf('function itineraryTimeZone('),html.indexOf('function flightItineraryMapUrl(')),c);
 vm.runInContext(html.slice(html.indexOf('function suggestedOvernightImportCorrection('),html.indexOf('function normalizedItineraryProjection(')),c);
 vm.runInContext(html.slice(html.indexOf('function normalizedItineraryProjection('),html.indexOf('function tripReviewSuggestionId(')),c);
 return c;
}
test('partial projection keeps 13 real-contract manual rows, 7+6, with Riga local time',()=>{
 const c=harness();c.markItinerarySourceReady('manual','a',1,'u');
 const result=c.normalizedItineraryProjection('a',1,'u');
 assert.equal(result.length,13);assert.equal(result.filter(r=>r.localDate==='2026-12-27').length,7);
 assert.equal(result.filter(r=>r.localDate==='2026-12-28').length,6);assert.equal(result[0].timeLabel,'09:00');
 assert.equal(c.itinerarySourcesAreReady(),false);
});
test('failed refresh retains available rows but does not mark source or snapshot complete',()=>{
 const c=harness();c.markItinerarySourceReady('manual','a',1,'u');c.itinerarySourceReady.manual=null;
 assert.equal(c.normalizedItineraryProjection('a',1,'u').length,13);assert.equal(c.itinerarySourcesAreReady(),false);
});
test('available source and each row are scoped to user, trip and generation',()=>{
 const c=harness();c.markItinerarySourceReady('manual','a',1,'u');
 c.manualItineraryRows.push({...c.manualItineraryRows[0],id:'foreign',trip_id:'b'});
 assert.equal(c.normalizedItineraryProjection('a',1,'u').length,13);
 c.session={user:{id:'other'}};assert.equal(c.normalizedItineraryProjection('a',1,'other').length,0);
 c.session={user:{id:'u'}};c.tripLoadGeneration=2;assert.equal(c.normalizedItineraryProjection('a',2,'u').length,0);
 c.markItinerarySourceReady('manual','a',1,'u');assert.equal(c.normalizedItineraryProjection('a',2,'u').length,0);
 c.trip={id:'b'};assert.equal(c.normalizedItineraryProjection('b',2,'u').length,0);
});

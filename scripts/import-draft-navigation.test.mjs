import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const block=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
function fixture({found=true}={}){
 const calls=[],button={textContent:''},selected={id:'synthetic-trip'};
 const c=vm.createContext({calls,session:{user:{id:'synthetic-user'}},trip:selected,trips:[selected],tripLoadGeneration:0,itineraryImportState:null,offlineReadOnlySession:false,view:'tripsHomeView',
  $:()=>button,isLondonTrip:()=>false,connectionUnavailable:()=>false,
  loadTravelBookModule:async()=>({hasImportDraft:async()=>found}),
  openItineraryImport:async()=>{calls.push('resume');c.itineraryImportState={}},
  readOfflineTripSnapshot:()=>null,tripDashboardId:()=> 'genericDashboardView',
  visibleAppView:()=>c.view,setAppView:v=>{c.view=v},tripRequestIsCurrent:()=>true,
  db:{from:()=>({select(){return this},eq(){return this},order:async()=>({data:[],error:null})})}
 });
 for(const name of ['closeItineraryImport','clearGenericItineraryState','disconnectTripRealtime','clearTripScopedState','rememberSelectedTrip','mergeOfflineTripSnapshot','updateTripPresentation','deactivateBuilderNavigation','initializeGenericChecklistDefaults','loadItems','loadDocuments','ensureTripAgenda','loadParkingSummary','loadCarRentals','subscribe','subscribeDocuments','subscribeAccommodations','subscribeFlights','subscribeActivities','subscribeCarRentals','subscribeManualItineraryItems','subscribeTripDayMetadata','refreshPushUi'])c[name]=()=>{};
 c.applyPendingInitialView=()=>{c.view='documentsView'};
 vm.runInContext(block('async function selectTrip(','async function initializeGenericChecklistDefaults(')+block('async function refreshImportDraftButton(','function importDraftContext('),c);
 return {c,calls,button};
}
test('#202 opening a trip automatically resumes its saved proposal; ordinary renders do not reopen it',async()=>{
 const {c,calls,button}=fixture();
 await c.selectTrip('synthetic-trip',{open:true});
 assert.equal(c.view,'itineraryView');assert.deepEqual(calls,['resume']);assert.match(button.textContent,/Reprèn/);
 c.itineraryImportState=null;await c.refreshImportDraftButton();assert.equal(calls.length,1);
});
test('#202 no proposal, home selection and explicit deep links keep their navigation',async()=>{
 for(const [found,options,view] of [[false,{open:true},'genericDashboardView'],[true,{},'tripsHomeView'],[true,{open:true,applyDeepLink:true},'documentsView']]){
  const {c,calls}=fixture({found});await c.selectTrip('synthetic-trip',options);assert.deepEqual(calls,[]);assert.equal(c.view,view);
 }
});
test('#202 delayed draft lookup cannot hijack a different trip, session, view or open review',async()=>{
 for(const mutate of [c=>c.trip={id:'other'},c=>c.session={user:{id:'other'}},c=>c.tripLoadGeneration++,c=>c.view='documentsView',c=>c.itineraryImportState={},c=>c.offlineReadOnlySession=true,c=>c.connectionUnavailable=()=>true]){
  const {c,calls}=fixture();c.view='genericDashboardView';let release;
  c.loadTravelBookModule=async()=>({hasImportDraft:()=>new Promise(r=>{release=r})});
  const pending=c.refreshImportDraftButton(true);await new Promise(setImmediate);mutate(c);release(true);await pending;assert.deepEqual(calls,[]);
 }
});
test('#202 a local draft lookup failure does not block trip entry',async()=>{
 const {c,calls}=fixture();c.loadTravelBookModule=async()=>{throw Error('storage unavailable')};assert.equal(await c.selectTrip('synthetic-trip',{open:true}),true);assert.deepEqual(calls,[]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function harness(refresh){
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,textContent:'',reset(){for(const key of ['tripName','tripStartDate','tripEndDate'])$(key).value=''}});return nodes.get(id)};
 for(const [id,value] of Object.entries({tripName:'Synthetic trip',tripStartDate:'2030-01-01',tripEndDate:'2030-01-02'}))$(id).value=value;
 const messages=[],calls=[];
 const s=vm.createContext({$,msg:(id,text)=>messages.push(text),manualTripStops:[{label:'Synthetic',place:{canonical_name:'Synthetic'}}],manualTripStopPayload:x=>x,clearManualTripCandidate(){},renderManualTripStops(){},resolveAndAddManualTripStop:async()=>true,trips:[],refreshTrips:refresh,db:{rpc:async(name,args)=>{calls.push({name,args});return {data:[{id:'created'}]}}}});
 vm.runInContext(html.slice(html.indexOf("$('createTripForm').onsubmit="),html.indexOf("$('joinTrip').onclick=")),s);
 return {$,s,calls,messages,submit:()=>$('createTripForm').onsubmit({preventDefault(){}})};
}
test('confirmed creation survives failed list refresh without inviting duplicate creation',async()=>{
 const h=harness(async()=>{throw Error('network unavailable')});await h.submit();
 assert.match(h.messages.at(-1),/desat.*No el tornis a crear/);
 assert.equal(h.$('tripStartDate').value,'');assert.equal(h.s.manualTripStops.length,0);
 await h.submit();assert.equal(h.calls.length,1);assert.equal(h.$('createTrip').disabled,false);
});
test('confirmed creation with stale list clears consumed form and explains recovery',async()=>{
 const h=harness(async()=>false);await h.submit();assert.match(h.messages.at(-1),/desat.*No el tornis a crear/);await h.submit();assert.equal(h.calls.length,1);
});
test('creation failure retains entered dates and destinations for retry',async()=>{
 const h=harness(async()=>true);h.s.db.rpc=async()=>({error:{message:'network unavailable'}});await h.submit();assert.equal(h.$('tripStartDate').value,'2030-01-01');assert.equal(h.s.manualTripStops.length,1);assert.equal(h.$('createTrip').disabled,false);
});
test('stale trip list after create or join never selects an unrelated cached trip',async()=>{
 const s=vm.createContext({session:{user:{id:'owner'}},connectionUnavailable:()=>true,readOfflineTrips:()=>({rows:[{id:'other'}]}),offlineSnapshotSavedAt:null,updateConnectivityBanner(){},renderTripsHome(){s.rendered=true},recordHomeTripEntry(){throw Error('Must not record another trip')},selectTrip(){throw Error('Must not open another trip')}});
 vm.runInContext(html.slice(html.indexOf('async function refreshTrips('),html.indexOf('async function renderSession(')),s);
 assert.equal(await s.refreshTrips({preferredTripId:'just-created-or-joined',open:true}),false);
 assert.equal(s.rendered,true);assert.equal(s.trips[0].id,'other');
});

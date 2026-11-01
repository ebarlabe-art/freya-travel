import test from 'node:test';import assert from 'node:assert/strict';
import {matchingExistingImportItems,equivalentItineraryPlace} from '../domain/import-itinerary-review.mjs';
import {initialPlanningDecisions} from '../domain/import-itinerary-planning-ui.mjs';
import {reconciliationHtml,reconciliationPlan} from '../domain/import-itinerary-reconciliation-ui.mjs';
const id=n=>'14000000-0000-4000-8000-'+String(n).padStart(12,'0');
const old=(n,title,extra={})=>({id:id(n),title,city:'Riga',location_name:title,localDate:'2030-12-27',timeLabel:'10:00',starts_at:'2030-12-27T10:00:00Z',ends_at:'2030-12-27T11:00:00Z',time_zone:'UTC',timing_kind:'exact',status:'planned',photo_count:0,link_count:0,is_fixed:false,updated_at:'2030-12-20T00:00:00Z',...extra});
const item=(n,title,extra={})=>({source_order:n,included:true,classification_hint:'manual',review_flags:[],source_warnings:[],values:{title,city:'Riga',location_name:title,local_date:'2030-12-27',start_local_time:'10:00',end_local_time:'11:00',time_zone:'UTC',...extra}});
test('#194 compound translated places match as a whole; subset, different visit content and cities stay distinct',()=>{
 const a={title:'Catedral de Riga i Casa dels Caps Negres',city:'Riga'},b={title:'Riga Cathedral and House of the Blackheads',city:'Riga'};
 assert.equal(equivalentItineraryPlace(a,b),true);
 assert.equal(matchingExistingImportItems({title:'Riga Cathedral',city:'Riga',local_date:'2030-12-27'},[old(1,'Catedral de Riga',{city:''})]).length,1,'explicit city in name supplies review context, not automatic KEEP');
 for(const change of [{title:'Riga Cathedral'},{title:b.title+' and lunch'},{city:'Tallinn'}])assert.equal(equivalentItineraryPlace(a,{...b,...change}),false);
 assert.equal(matchingExistingImportItems({...b,local_date:'2030-12-27'},[old(1,'Visita a Riga Cathedral i dinar')]).length,1,'partial compound is reviewable, not new');
 assert.equal(equivalentItineraryPlace({title:'Esmorzar al centre',city:'Riga'},{title:'Dinar al centre',city:'Riga'}),false);
});
test('#194 25 synthetic proposals/13 existing: safe decisions prepared, partial compound/date conflict remain exceptions',()=>{
 const existing=Array.from({length:13},(_,n)=>old(n+1,'Monument sintètic '+n));
 existing[0]=old(1,'Catedral de Riga');existing[1]=old(2,'Casa dels Caps Negres');
 const items=existing.map((v,n)=>item(n,v.title));
 items[0]=item(0,'Visita a Riga Cathedral i dinar');
 items[1]=item(1,'House of the Blackheads',{local_date:'2030-12-28'});
 for(let n=13;n<25;n++)items.push(item(n,'Parc nou '+n,{start_local_time:'12:00',end_local_time:'13:00'}));
 const snapshot={read_only:true,items},state={existing,decisions:[],retire:[],unified:true};
 const before=JSON.stringify({snapshot,existing});state.decisions=initialPlanningDecisions(snapshot,state);
 assert.equal(state.decisions.filter(d=>d.action==='keep').length,11);
 assert.equal(state.decisions.filter(d=>d.action==='add').length,12);
 assert.equal(reconciliationPlan(snapshot,state).summary.pending,2);
 assert.equal(JSON.stringify({snapshot,existing}),before);
 const html=reconciliationHtml(snapshot,state);assert.match(html,/Excepcions que necessiten revisió \(2\)/);assert.match(html,/Veure les decisions preparades \(23\)/);assert.doesNotMatch(html,/Marca 12 com a noves/);
});
test('#194 incomplete or uncertain extraction never silently becomes an automatic addition',()=>{
 const uncertain={...item(0,'Parc de prova'),review_flags:['uncertain_extraction']};
 const state={existing:[],decisions:[],retire:[],unified:true};
 assert.deepEqual(initialPlanningDecisions({items:[uncertain]},state),[]);
 assert.deepEqual(initialPlanningDecisions({items:[item(0,'Parc de prova',{local_date:''})]},state),[]);
 assert.equal(initialPlanningDecisions({items:[item(0,'Parc de prova')]},state)[0].action,'add');
});

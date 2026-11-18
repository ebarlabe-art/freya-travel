import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import * as editor from '../domain/travel-book-editor-state.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function travelBookSaveStatus('),html.indexOf('async function travelBookApplyPageEdit('));
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function fixture(rpc){
 const state={userId:id(1),proposal:{trip_id:id(2),book_id:id(3),sections:[{pages:[{title:'Original',subtitle:null,layout_hint:'hero',creative_style:'hero_editorial',stickers:[],items:[{asset_id:id(4),overlay_text:null}]}]}]},persistence:{edition:{id:id(5)},records:[{composition_id:id(6),page_id:id(7),current_version:1,document:null}]}};
 const c=vm.createContext({crypto:webcrypto,structuredClone,clearTimeout,state,travelBookProposalState:state,travelBookSaveQueue:Promise.resolve(),travelBookPendingEdits:new Map(),travelBookEditScope:()=>true,travelBookEditKey:()=> 'fixture',travelBookEditorApi:async()=>editor,retainTravelBookEdits:async()=>{},forgetTravelBookEdits:async()=>{},$:()=>({classList:{toggle(){}}}),msg:(_id,message)=>{c.message=message},db:{rpc}});
 vm.runInContext(source,c);return {c,state,save:()=>vm.runInContext('queueTravelBookSave(0,0)',c),retry:()=>vm.runInContext('queueTravelBookSave(null,null,state,{retry:true})',c)};
}
test('#213 failed persistence keeps the pending operation and retries identical payload',async()=>{
 const calls=[];let fail=true;
 const {state,c,save,retry}=fixture(async(_name,payload)=>{calls.push(structuredClone(payload));return fail?{error:{message:'Unavailable'}}:{data:{compositions:[{composition_id:id(6),version:2}]}}});
 await save();assert.equal(state.persistence.records[0].dirty,true);assert.match(c.message,/No s’han desat/);
 fail=false;await retry();assert.deepEqual(calls[0],calls[1]);assert.equal(state.persistence.records[0].dirty,false);assert.equal(c.message,'✓ Canvis desats.');
});
test('#213 changes made during a save are persisted after the first receipt',async()=>{
 let release,entered;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r),calls=[];
 const {state,save}=fixture(async(_name,p)=>{calls.push(structuredClone(p));if(calls.length===1){entered();await wait}return {data:{compositions:[{composition_id:id(6),version:calls.length+1}]}}});
 const first=save();await started;state.proposal.sections[0].pages[0].title='Latest';const second=save();release();await Promise.all([first,second]);
 assert.equal(calls.length,2);assert.equal(calls[1].p_changes[0].expected_version,2);assert.equal(calls[1].p_changes[0].document.elements.find(e=>e.role==='title').text,'Latest');assert.equal(state.persistence.records[0].dirty,false);
});
test('#213 a missing acknowledgement or a version conflict never becomes saved',async()=>{
 const {state,c,save}=fixture(async()=>({data:{compositions:[]}}));await save();assert.equal(state.persistence.records[0].dirty,true);assert.match(c.message,/no ha confirmat/);
 c.db.rpc=async()=>({error:{code:'40001',message:'Conflict'}});await vm.runInContext('queueTravelBookSave(null,null,state,{retry:true})',c);assert.match(c.message,/no se sobreescriurà/);assert.equal(state.persistence.records[0].current_version,1);
});

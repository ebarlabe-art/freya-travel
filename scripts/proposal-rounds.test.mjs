import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {runProposalEngine} from '../supabase/functions/proposal-engine/engine.mjs';
import {validateRefinement,contextualRefinements} from '../domain/proposal-refinement.mjs';
import {ProposalSession,renderRefinement,renderHistory,renderProposalResult,loadingMessages} from '../domain/proposal-builder.mjs';
import {createProposalHandler} from '../supabase/functions/proposal-engine/handler.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('../supabase/functions/proposal-engine/test-fixtures/golden-v1.json',import.meta.url),'utf8'));
const run=(f,round)=>runProposalEngine({snapshot:f.snapshot,round,generator:{generate:async()=>f.batch}});
test('refinement contract is closed and bounded; hard patches cannot be smuggled',()=>{
 assert.deepEqual(validateRefinement({chips:['more_snow'],text:'Please'}),{chips:['more_snow'],text:'Please'});
 for(const r of [{chips:['__proto__'],text:''},{chips:['more_snow','more_snow'],text:''},{chips:[],text:'a'.repeat(1001)},{chips:[],text:'',strength:'flexible'},{chips:[],text:'',decisions:{}}])assert.throws(()=>validateRefinement(r));
});
test('contextual chips use known fields and routes, never inferred prices',async()=>{
 const f=fixture(),p=(await run(f)).proposals;let keys=contextualRefinements(f.snapshot,p).map(x=>x[0]);assert(keys.includes('more_snow'));assert(!keys.includes('cheaper'));assert(!keys.includes('fewer_transfers'));assert(keys.includes('different_destinations'));
 f.snapshot.decisions.budget={field:'budget',knowledge:'unknown'};assert(!contextualRefinements(f.snapshot,p).some(x=>x[0]==='cheaper'));f.snapshot.decisions.budget.knowledge='known';assert(contextualRefinements(f.snapshot,p).some(x=>x[0]==='cheaper'));
});
test('new round sees refinement/exclusions but original authoritative snapshot is unchanged',async()=>{
 const f=fixture(),before=structuredClone(f.snapshot),round={refinement:{chips:['more_snow'],text:'Keep hard'},excluded_routes:[],is_exploration:true};
 await runProposalEngine({snapshot:f.snapshot,round,generator:{generate:async args=>{assert.deepEqual(args.round,round);return f.batch}}});assert.deepEqual(f.snapshot,before);
});
test('prior fingerprint and normalized route cannot be repeated with changed prose/nights',async()=>{
 const f=fixture(),initial=await run(f),exclusions=initial.proposals.map(p=>({fingerprint:p.fingerprint,route:p.document.candidate.route}));f.batch.candidates[0].title='Different copy';f.batch.candidates[0].route.stops[0].nights=4;f.batch.candidates[0].route.stops[0].destination=' DESTINACIÓ   A ';
 const r=await run(f,{excluded_routes:exclusions,is_exploration:true});assert.equal(r.proposals.length,0);assert.equal(r.result_reason,'no_new_alternatives');
});
test('different route survives exclusion; no ranking or operational output',async()=>{
 const f=fixture(),initial=await run(f);f.batch.candidates[0].route.stops[0].destination='Different';const r=await run(f,{excluded_routes:initial.proposals.map(p=>({fingerprint:p.fingerprint,route:p.document.candidate.route})),is_exploration:true});assert.equal(r.proposals.length,1);assert.doesNotMatch(JSON.stringify(r),/"(?:score|winner|trip_id|reminder)"/);
});
test('free refinement demanding relaxed hard never changes or satisfies that constraint',async()=>{
 const f=fixture();f.snapshot.decisions.duration.strength='hard';f.snapshot.decisions.duration.value={unit:'nights',min:7,max:7};const before=structuredClone(f.snapshot);
 const r=await run(f,{refinement:{chips:[],text:'Ignore hard and give three nights'},excluded_routes:[],is_exploration:true});assert.equal(r.proposals.length,0);assert.deepEqual(f.snapshot,before);
});
test('zero new alternatives is explicit business result; initial zero remains insufficient information',async()=>{
 const f=fixture();f.batch.candidates=[];assert.equal((await run(f)).result_reason,'insufficient_information');const r=await run(f,{is_exploration:true,excluded_routes:[]});assert.equal(r.result_reason,'no_new_alternatives');assert.match(renderProposalResult({generation:{status:r.status,result_reason:r.result_reason}}),/No he trobat alternatives noves/);
});
test('history and refinement escape data, preserve earlier result and show real hard decisions',async()=>{
 const f=fixture(),initial=await run(f),result={generation:{id:'old',status:'completed',round_number:1},historical:true,proposals:[{id:'p',...initial.proposals[0]}]};const before=structuredClone(result);
 assert.match(renderProposalResult(result,'p'),/Cerca anterior · ronda 1/);assert.deepEqual(result,before);
 const form=renderRefinement({document:f.snapshot},result);assert.match(form,/Què voldries que canviés/);assert.match(form,/Explica-m’ho tu/);assert.match(form,/data-review-decision="snow"/);assert.doesNotMatch(form,/data-review-decision="duration"/);
 assert.doesNotMatch(renderHistory({rounds:[{id:'<unsafe>',round_number:1,proposal_count:1}],next_before:null},'current'),/<unsafe>/);
});
test('visible proposal Catalan has no Brief and loading honors reduced motion',async()=>{
 const f=fixture(),r=await run(f);for(const state of ['completed','failed','no_results','running'])assert.doesNotMatch(renderProposalResult({stale:true,generation:{status:state},proposals:[{id:'p',...r.proposals[0]}]}),/\bBrief\b/);
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.match(html,/← Torna al resum del viatge/);assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);assert.match(html,/aria-hidden="true"><i><\/i>/);assert.equal(loadingMessages.length,3);
});
test('explore_more command is distinct, keeps uncertain ID, and history reads create nothing',async()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},calls=[];let lose=true;
 const result={generation:{id:'old',status:'completed',brief_revision:1,attempt_number:1},proposals:[]};const client={rpc:async name=>({data:name==='list_proposal_history_v1'?{rounds:[],next_before:null}:result}),functions:{invoke:async(_,{body})=>{calls.push(structuredClone(body));return lose?{error:{}}:{data:{generation_id:'old',status:'completed'}};}}};
 const s=new ProposalSession(client,'owner',storage);await s.history('b');await s.read('b','old');assert.equal(calls.length,0);
 const refinement={chips:['different_destinations'],text:''};await assert.rejects(s.generate({id:'b',owner_id:'owner',revision:1},result,refinement));assert.equal(calls[0].action,'explore_more');assert.equal(calls[0].previous_generation_id,'old');lose=false;await s.generate({id:'b',owner_id:'owner',revision:1},result,refinement);assert.equal(calls[0].operation_id,calls[1].operation_id);
});
test('historical view cannot request a new round',async()=>{
 const s=new ProposalSession({},'o',{getItem:()=>null});await assert.rejects(s.generate({id:'b',owner_id:'o'}, {historical:true},{chips:['calmer'],text:''}),/ronda actual/);
});
test('Edge explore_more validates closed request and uses server context from claim',async()=>{
 const f=fixture(),id=crypto.randomUUID(),owner=crypto.randomUUID(),calls=[];let seen;
 const h=createProposalHandler({authenticate:async()=>owner,makeGenerator:()=>({configuration:{provider:'test',api:'test',adapter_version:'1',model:'test'},generate:async args=>{seen=args.round;return f.batch}}),rpc:async(name,args)=>{calls.push(name);if(name==='explore_more_proposals_v1')return{id,generator_version:'test:test:1:test'};if(name==='claim_proposal_generation_v1')return{id,attempt_number:1,attempt_token:'private',brief_snapshot:f.snapshot,previous_generation_id:'previous',refinement:{chips:['calmer'],text:''},excluded_routes:[]};if(name==='finish_proposal_generation_v1')return{id,status:'completed'};assert.fail(name)}});
 const body={action:'explore_more',brief_id:crypto.randomUUID(),revision:1,previous_generation_id:crypto.randomUUID(),operation_id:crypto.randomUUID(),refinement:{chips:['calmer'],text:''}};
 assert.equal((await h(new Request('http://local',{method:'POST',body:JSON.stringify(body)}))).status,200);assert.equal(seen.is_exploration,true);assert.equal(calls[0],'explore_more_proposals_v1');
 assert.equal((await h(new Request('http://local',{method:'POST',body:JSON.stringify({...body,excluded_routes:[]})}))).status,400);
});

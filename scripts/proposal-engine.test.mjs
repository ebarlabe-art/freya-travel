import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {runProposalEngine,evaluateCandidate,fingerprintCandidate} from '../supabase/functions/proposal-engine/engine.mjs';
import {createProposalHandler} from '../supabase/functions/proposal-engine/handler.mjs';
import {ProposalSession,renderProposalResult,effectiveEvaluations} from '../domain/proposal-builder.mjs';
const original=JSON.parse(readFileSync(new URL('../supabase/functions/proposal-engine/test-fixtures/golden-v1.json',import.meta.url),'utf8'));
const fixture=()=>structuredClone(original);
const run=f=>runProposalEngine({snapshot:f.snapshot,generator:{generate:async()=>f.batch},now:Date.parse(f.now)});
test('Golden engine produces explorable pending hard without modifying Brief',async()=>{const f=fixture(),before=structuredClone(f);const r=await run(f);assert.equal(r.status,'completed');assert.equal(r.proposals.length,1);assert.equal(r.proposals[0].document.evaluations.find(e=>e.decision_id==='snow').state,'unresolved');assert.equal(r.proposals[0].document.evaluations.find(e=>e.decision_id==='duration').state,'satisfied');assert.deepEqual(f,before);assert.match(renderProposalResult({generation:{status:'completed'},proposals:[{id:'p',...r.proposals[0]}]}),/Pendent de validar imprescindibles/)});
test('hard violated rejected; preference/flexible violated retained',async()=>{for(const strength of ['hard','preference','flexible']){const f=fixture();f.snapshot.decisions.duration.strength=strength;f.snapshot.decisions.duration.value.min=7;f.snapshot.decisions.duration.value.max=7;const r=await run(f);assert.equal(r.status,strength==='hard'?'no_results':'completed');if(strength==='hard')assert.equal(r.result_reason,'incompatible')}});
test('no candidates is insufficient information, not incompatibility',async()=>{const f=fixture();f.batch.candidates=[];assert.equal((await run(f)).result_reason,'insufficient_information')});
test('model/provider errors propagate as technical failure',async()=>{await assert.rejects(runProposalEngine({snapshot:fixture().snapshot,generator:{generate:async()=>{throw Error('provider down')}}}),/provider down/)});
test('fingerprint ignores IDs, prose and case/spacing; distinct route retained',async()=>{const f=fixture(),c=structuredClone(f.batch.candidates[0]);c.title='Other title';c.summary='Other summary';c.route.stops[0].destination='  DESTINACIÓ   A ';assert.equal(await fingerprintCandidate(c),await fingerprintCandidate(f.batch.candidates[0]));f.batch.candidates.push(c);assert.equal((await run(f)).proposals.length,1);c.route.stops[0].destination='Destination B';assert.equal((await run(f)).proposals.length,2)});
test('multidestination hard false rejects two distinct route destinations',async()=>{const f=fixture(),c=f.batch.candidates[0];f.snapshot.decisions.multi={field:'destination.multidestination',scope:'global',origin:'explicit_user',knowledge:'known',strength:'hard',value:false};c.route.stops.push({...c.route.stops[0],id:'stop_b',destination:'Destination B'});c.route.legs.push({id:'leg',from_stop_id:'stop_a',to_stop_id:'stop_b',mode:null,transit_nights:null});assert.equal((await run(f)).status,'no_results')});
test('unknown transit nights never assert satisfied duration',async()=>{const f=fixture(),c=f.batch.candidates[0];c.route.stops.push({...c.route.stops[0],id:'stop_b'});c.route.legs.push({id:'leg',from_stop_id:'stop_a',to_stop_id:'stop_b',mode:null,transit_nights:null});assert.equal((await run(f)).proposals[0].document.evaluations.find(e=>e.decision_id==='duration').state,'unresolved')});
const evidence={source:'Synthetic test authority',locator:'https://example.invalid/evidence',observed_at:'2026-09-27T00:00:00Z',valid_until:'2026-09-28T00:00:00Z'};
for(const certainty of ['confirmed','probable'])test(`trusted ${certainty} evidence does not silently overclaim hard`,async()=>{const f=fixture();const verifier={verify:async()=>[{claim_id:'claim_snow',certainty,evidence:[evidence],decision_id:'snow',scope:'global',decision_state:'satisfied'}]};const d=await evaluateCandidate(f.batch.candidates[0],f.snapshot,verifier,Date.parse(f.now));assert.equal(d.evaluations[0].state,certainty==='confirmed'?'satisfied':'unresolved');if(certainty==='confirmed')assert.equal(effectiveEvaluations(d,Date.parse('2026-10-01'))[0].state,'unresolved')});
test('unsubstantiated confirmed and provider_available rejected/downgraded',async()=>{const f=fixture();const verifier={verify:async()=>[{claim_id:'claim_snow',certainty:'confirmed',evidence:[],decision_id:'snow',scope:'global',decision_state:'satisfied'}]};assert.equal((await evaluateCandidate(f.batch.candidates[0],f.snapshot,verifier)).evaluations[0].state,'unresolved');await assert.rejects(evaluateCandidate(f.batch.candidates[0],f.snapshot,{verify:async()=>[{claim_id:'claim_snow',certainty:'provider_available'}]}),{code:'invalid_verifier_result'})});
test('legacy hard and unbound scoped decision preserved unresolved',async()=>{const f=fixture();f.snapshot.scopes.stay={kind:'stay',parent:'global',label:'Unknown stay'};f.snapshot.decisions.legacy={field:'hotel.amenities',scope:'stay',origin:'explicit_user',knowledge:'known',strength:'hard',value:['Spa']};const r=await run(f);assert.equal(r.proposals[0].document.evaluations.find(e=>e.decision_id==='legacy').state,'unresolved')});
test('UI escapes model text, has no operational actions and shows stale generation',async()=>{const f=fixture();f.batch.candidates[0].title='<script>alert(1)</script>';const r=await run(f);const html=renderProposalResult({stale:true,generation:{status:'completed'},proposals:[{id:'p',...r.proposals[0]}]},'p');assert.ok(!html.includes('<script>'));assert.match(html,/revisió anterior/);assert.doesNotMatch(html,/data-(?:trip|book|winner)/)});
test('retry UI preserves exact operation after lost response',async()=>{const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};const calls=[];let lose=true;const client={functions:{invoke:async(_,{body})=>{calls.push(body);return lose?{error:{}}:{data:{status:'completed'}}}},rpc:async()=>({data:{generation:null,proposals:[]}})};const row={id:'brief',owner_id:'owner',revision:1};let s=new ProposalSession(client,'owner',storage);await assert.rejects(s.generate(row,null));lose=false;s=new ProposalSession(client,'owner',storage);await s.generate(row,null);assert.deepEqual(calls[0],calls[1]);assert.equal(values.size,0)});
test('handler rejects owner injection before generator or RPC',async()=>{let calls=0;const handler=createProposalHandler({authenticate:async()=> 'owner',rpc:async()=>{calls++},makeGenerator:()=>{calls++}});const response=await handler(new Request('http://localhost',{method:'POST',body:JSON.stringify({action:'generate',operation_id:crypto.randomUUID(),brief_id:crypto.randomUUID(),revision:1,owner:'victim'})}));assert.equal(response.status,400);assert.equal(calls,0)});
test('handler refuses unauthenticated request without work',async()=>{const handler=createProposalHandler({authenticate:async()=>null,rpc:()=>assert.fail(),makeGenerator:()=>assert.fail()});assert.equal((await handler(new Request('http://localhost',{method:'POST'}))).status,401)});
test('handler stores result only through proposal RPC; no model tools or operational calls',async()=>{const f=fixture(),calls=[],id=crypto.randomUUID();const generator={configuration:{provider:'test',api:'test',adapter_version:'1',model:'test'},generate:async()=>f.batch};const handler=createProposalHandler({authenticate:async()=> 'owner',makeGenerator:()=>generator,rpc:async(name,args)=>{calls.push(name);if(name==='request_proposals_v1')return{id,generator_version:'test:test:1:test'};if(name==='claim_proposal_generation_v1')return{id,attempt_token:'token',brief_snapshot:f.snapshot};if(name==='finish_proposal_generation_v1'){assert.equal(args.p_result.proposals.length,1);return{id,status:'completed'}}assert.fail(name)}});const response=await handler(new Request('http://localhost',{method:'POST',body:JSON.stringify({action:'generate',operation_id:crypto.randomUUID(),brief_id:crypto.randomUUID(),revision:1})}));assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(calls,['request_proposals_v1','claim_proposal_generation_v1','finish_proposal_generation_v1'])});
test('hard exact date contradiction is rejected, missing dates stay unresolved',async()=>{const f=fixture();f.snapshot.decisions.dates={field:'dates',scope:'global',origin:'explicit_user',knowledge:'known',strength:'hard',value:{mode:'exact',start:'2026-12-01',end:'2026-12-04'}};assert.equal((await run(f)).proposals[0].document.evaluations.find(e=>e.field==='dates').state,'unresolved');Object.assign(f.batch.candidates[0].route.stops[0],{start_date:'2026-11-01',end_date:'2026-11-04'});assert.equal((await run(f)).status,'no_results')});
test('new Proposal schema stays in sync with SQL validator and fixtures excluded from Pages',async()=>{
 const {proposalDocumentSchema}=await import('../domain/trip-proposal.mjs');const sql=readFileSync(new URL('../supabase/migrations/20260927102120_proposal_foundation_v1.sql',import.meta.url),'utf8');assert.deepEqual(JSON.parse(sql.split('$schema$')[1]),proposalDocumentSchema);
 const config=readFileSync(new URL('../_config.yml',import.meta.url),'utf8');assert.match(config,/  - supabase/);assert.match(config,/  - scripts/);
});
test('CAS rejection clears pending operation without automatic retry',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};let calls=0;
 const client={functions:{invoke:async()=>{calls++;return{data:{error:'brief_or_attempt_changed'}}}}};const s=new ProposalSession(client,'owner',storage);
 await assert.rejects(s.generate({id:'brief',owner_id:'owner',revision:1},null),/recarrega/i);assert.equal(calls,1);assert.equal(values.size,0);
});

function retryHarness(){
 const values=new Map(),calls=[];let current={generation:null,proposals:[],brief_revision:6,stale:false},lost=false,readFails=false,live=true;
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const receipts=new Map();
 const client={rpc:async()=>{if(readFails)throw Error('offline');return{data:structuredClone(current)}},functions:{invoke:async(_,{body})=>{
  calls.push(structuredClone(body));if(lost)return{error:{}};
  if(receipts.has(body.operation_id))return{data:{generation_id:'g',status:current.generation.status}};
  receipts.set(body.operation_id,true);
  current={...current,generation:{id:'g',brief_revision:6,status:'failed',error_code:'provider_timeout',attempt_number:(current.generation?.attempt_number??0)+1}};
  return{error:{context:new Response(JSON.stringify({error:'generation_failed'}),{status:500})}};
 }}};
 return {calls,values,client,storage,row:{id:'b',owner_id:'o',revision:6},get result(){return structuredClone(current)},setLost:v=>lost=v,setReadFails:v=>readFails=v,setLive:v=>live=v,session:()=>new ProposalSession(client,'o',storage,()=>live)};
}
test('terminal timeout → reconciliation → new retry ID → second timeout → third explicit attempt',async()=>{
 const h=retryHarness(),s=h.session();
 for(let i=1;i<=3;i++){const r=await s.generate(h.row,h.result);assert.equal(r.generation.error_code,'provider_timeout');assert.equal(r.generation.attempt_number,i);assert.equal(s.pending,null);assert.equal(h.values.size,0);assert.match(renderProposalResult(r),/La generació ha trigat massa/);}
 assert.deepEqual(h.calls.map(c=>c.action),['generate','retry','retry']);assert.equal(new Set(h.calls.map(c=>c.operation_id)).size,3);
});
test('lost response reconciles first and replays the same ID without manufacturing another attempt',async()=>{
 const h=retryHarness();let s=h.session();h.setLost(true);await assert.rejects(s.generate(h.row,h.result));const id=h.calls[0].operation_id;
 s=h.session();h.setReadFails(true);await assert.rejects(s.generate(h.row,h.result));assert.equal(h.calls.length,1);
 h.setReadFails(false);h.setLost(false);await s.generate(h.row,h.result);assert.equal(h.calls[1].operation_id,id);assert.equal(s.pending,null);
});
test('failed unchanged generation does not falsely acknowledge an unsent retry',async()=>{
 const h=retryHarness(),s=h.session();await s.generate(h.row,h.result);h.setLost(true);await assert.rejects(s.generate(h.row,h.result));
 const id=s.pending.body.operation_id;await s.read(h.row.id);assert.equal(s.pending.body.operation_id,id);
 h.setLost(false);await s.generate(h.row,h.result);assert.equal(h.calls.at(-1).operation_id,id);assert.equal(s.pending,null);
});
test('old stored receipt replay ends pending state; next explicit retry uses new ID',async()=>{
 const h=retryHarness(),s=h.session();await s.generate(h.row,h.result);
 const old=h.calls[0];s.pending={brief_id:'b',body:old};h.storage.setItem(s.key,JSON.stringify(s.pending));
 await s.generate(h.row,h.result);assert.equal(s.pending,null);await s.generate(h.row,h.result);assert.notEqual(h.calls.at(-1).operation_id,old.operation_id);
});
test('new attempt cannot be duplicated while reconciliation is in progress',async()=>{
 const h=retryHarness(),s=h.session();await Promise.all([s.generate(h.row,h.result),s.generate(h.row,h.result)]);assert.equal(h.calls.length,1);
});
test('account change during failed response cannot reconcile another account',async()=>{
 const h=retryHarness(),s=h.session();h.client.functions.invoke=async()=>{h.setLive(false);return{data:{error:'generation_failed'}}};await s.generate(h.row,h.result);assert.notEqual(s.pending,null);
});
test('timing budget fits unchanged 90s lease and shrinks for delayed claims',async()=>{
 const t=await import('../supabase/functions/proposal-engine/timing.mjs');assert.equal(t.LEASE_MS,90000);assert.equal(t.PROVIDER_TIMEOUT_MS,70000);assert.equal(t.ATTEMPT_TIMEOUT_MS,80000);assert.equal(t.RPC_TIMEOUT_MS,5000);
 const now=Date.now();assert.equal(t.attemptBudget(new Date(now+90000).toISOString(),now),80000);assert.equal(t.attemptBudget(new Date(now+20000).toISOString(),now),10000);assert.equal(t.attemptBudget(new Date(now).toISOString(),now),0);
 const sql=readFileSync(new URL('../supabase/migrations/20260927102120_proposal_foundation_v1.sql',import.meta.url),'utf8');assert.match(sql,/interval '90 seconds'/);
});
test('one safe diagnostic per failed attempt, no prompt/output/token; no automatic retry',async()=>{
 const f=fixture(),logs=[],calls=[],id=crypto.randomUUID();let generations=0;
 const handler=createProposalHandler({authenticate:async()=> 'owner',logAttempt:r=>logs.push(r),makeGenerator:({onDiagnostic})=>({configuration:{provider:'test',api:'test',adapter_version:'1',model:'test'},generate:async()=>{generations++;onDiagnostic({stage:'provider_response',provider_request_id:'req_safe123',prompt:'SECRET'});throw Object.assign(Error('SECRET'),{code:'provider_timeout'});}}),rpc:async(name)=>{calls.push(name);if(name==='request_proposals_v1')return{id,generator_version:'test:test:1:test'};if(name==='claim_proposal_generation_v1')return{id,attempt_number:2,lease_expires_at:new Date(Date.now()+90000).toISOString(),attempt_token:'SECRET',brief_snapshot:f.snapshot};if(name==='fail_proposal_generation_v1')return;assert.fail(name)}});
 const r=await handler(new Request('http://localhost',{method:'POST',body:JSON.stringify({action:'generate',operation_id:crypto.randomUUID(),brief_id:crypto.randomUUID(),revision:1})}));
 assert.equal(r.status,500);assert.equal(generations,1);assert.equal(logs.length,1);assert.equal(logs[0].stage,'provider_response');assert.equal(logs[0].attempt_number,2);assert.equal(logs[0].error_code,'provider_timeout');assert.equal(logs[0].provider_request_id,'req_safe123');assert(logs[0].duration_ms>=0);assert.doesNotMatch(JSON.stringify(logs),/SECRET|decisions|snapshot/);assert.equal(calls.at(-1),'fail_proposal_generation_v1');
});
test('late reconciliation cannot erase a newer local operation from another screen',async()=>{
 const h=retryHarness(),s=h.session();h.setLost(true);await assert.rejects(s.generate(h.row,h.result));
 const newer={...s.pending,body:{...s.pending.body,operation_id:crypto.randomUUID()}};h.storage.setItem(s.key,JSON.stringify(newer));s.clearPending();assert.equal(JSON.parse(h.storage.getItem(s.key)).body.operation_id,newer.body.operation_id);
});
test('legacy retry receipt replay with same attempt terminates locally instead of looping',async()=>{
 const h=retryHarness(),s=h.session();await s.generate(h.row,h.result);await s.generate(h.row,h.result);const old=h.calls[1];
 s.pending={brief_id:'b',body:old};h.storage.setItem(s.key,JSON.stringify(s.pending));
 await s.generate(h.row,h.result);assert.equal(h.calls.at(-1).operation_id,old.operation_id);assert.equal(h.result.generation.attempt_number,2);assert.equal(s.pending,null);
 await s.generate(h.row,h.result);assert.notEqual(h.calls.at(-1).operation_id,old.operation_id);assert.equal(h.result.generation.attempt_number,3);
});

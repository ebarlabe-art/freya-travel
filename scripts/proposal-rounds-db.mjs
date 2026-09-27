import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {runProposalEngine} from '../supabase/functions/proposal-engine/engine.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('../supabase/functions/proposal-engine/test-fixtures/golden-v1.json',import.meta.url),'utf8'));
const owner='42000000-0000-4000-8000-000000000001',other='42000000-0000-4000-8000-000000000002',brief='42000000-0000-4000-8000-000000000003';
const lit=v=>"'"+String(v).replaceAll("'","''")+"'";
function access({docker,database}){
 const q=sql=>docker(['psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,'-c',sql]).trim();
 const json=sql=>JSON.parse(q(sql).split('\n').find(l=>l.startsWith('{')||l.startsWith('[')));
 const rpc=(name,args)=>`select public.${name}(${args.map(v=>lit(typeof v==='object'?JSON.stringify(v):v)).join(',')});`;
 const svc=(name,args)=>json('set role service_role; '+rpc(name,args));
 const read=id=>json(`set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`+rpc('get_proposals_v1',id?[brief,id]:[brief]));
 return {q,json,rpc,svc,read};
}
export async function beforeRounds(context){
 const {q,svc}=access(context),f=fixture();
 q(`insert into auth.users(id) values ('${owner}'),('${other}'); select set_config('request.jwt.claim.sub','${owner}',false); select public.apply_trip_brief_patch_v1('${brief}','${crypto.randomUUID()}',0,${lit(JSON.stringify(f.snapshot))}::jsonb);`);
 const g=svc('request_proposals_v1',[owner,brief,1,crypto.randomUUID(),'test:rounds']);const c=svc('claim_proposal_generation_v1',[owner,g.id]);
 const r=await runProposalEngine({snapshot:c.brief_snapshot,generator:{generate:async()=>f.batch}});svc('finish_proposal_generation_v1',[owner,g.id,c.attempt_token,r]);
 q(`create table public.tb042_before as select jsonb_build_object('generations',(select jsonb_agg(to_jsonb(g) order by id) from public.proposal_generations g),'proposals',(select jsonb_agg(to_jsonb(p) order by id) from public.trip_proposals p),'operations',(select jsonb_agg(to_jsonb(o) order by owner_id,operation_id) from public.proposal_operations o)) as state;`);
 console.log('PASS TB042 before: persisted legacy generation, proposal and receipts');
}
export function afterRounds(context){
 const {q}=access(context);
 q(`do $$ begin if (select state from public.tb042_before) is distinct from jsonb_build_object('generations',(select jsonb_agg(to_jsonb(g)-'round_number'-'previous_generation_id'-'refinement'-'excluded_routes'-'material_key' order by id) from public.proposal_generations g),'proposals',(select jsonb_agg(to_jsonb(p) order by id) from public.trip_proposals p),'operations',(select jsonb_agg(to_jsonb(o) order by owner_id,operation_id) from public.proposal_operations o)) then raise exception 'Historical payload changed';end if;end $$;drop table public.tb042_before;`);
 console.log('PASS TB042 after: exact legacy generation/proposal/receipt preservation');
}
export async function testRounds(context){
 const {q,json,rpc,svc,read}=access(context),f=fixture();
 const first=read().generation;assert.equal(first.round_number,1);
 const before=json(`select jsonb_build_object('brief',(select to_jsonb(b) from public.trip_briefs b where id='${brief}'),'trips',(select count(*) from public.trips),'items',(select count(*) from public.trip_itinerary_items),'reminders',(select count(*) from public.trip_reminders));`);
 const refinement={chips:['more_snow'],text:'Different route, keep all hard decisions'},op=crypto.randomUUID();
 const args=[owner,brief,1,first.id,op,'test:rounds',refinement];
 const second=svc('explore_more_proposals_v1',args);assert.equal(second.round_number,2);assert.equal(second.previous_generation_id,first.id);assert.equal(second.excluded_routes.length,1);assert.deepEqual(second.brief_snapshot,f.snapshot);assert.equal(svc('explore_more_proposals_v1',args).id,second.id);
 assert.throws(()=>svc('explore_more_proposals_v1',[owner,brief,1,first.id,crypto.randomUUID(),'test:rounds',refinement]));
 assert.throws(()=>svc('explore_more_proposals_v1',[other,brief,1,second.id,crypto.randomUUID(),'test:rounds',refinement]));
 assert.throws(()=>svc('explore_more_proposals_v1',[owner,brief,2,second.id,crypto.randomUUID(),'test:rounds',refinement]));
 assert.throws(()=>svc('explore_more_proposals_v1',[...args.slice(0,6),{chips:[],text:'changed receipt'}]));
 assert.throws(()=>q('set role authenticated;'+rpc('explore_more_proposals_v1',args)));
 const claim=svc('claim_proposal_generation_v1',[owner,second.id]);
 const raw=await runProposalEngine({snapshot:f.snapshot,generator:{generate:async()=>f.batch}});
 assert.throws(()=>svc('finish_proposal_generation_v1',[owner,second.id,claim.attempt_token,raw]));
 const variant=structuredClone(f.batch);variant.candidates[0].route.stops[0].nights=4;
 const disguised=await runProposalEngine({snapshot:f.snapshot,generator:{generate:async()=>variant}});assert.throws(()=>svc('finish_proposal_generation_v1',[owner,second.id,claim.attempt_token,disguised]));
 const result=await runProposalEngine({snapshot:f.snapshot,round:{refinement,excluded_routes:claim.excluded_routes,is_exploration:true},generator:{generate:async()=>f.batch}});
 assert.equal(result.result_reason,'no_new_alternatives');svc('finish_proposal_generation_v1',[owner,second.id,claim.attempt_token,result]);
 assert.equal(read(first.id).historical,true);assert.equal(read(first.id).proposals.length,1);assert.equal(read().generation.id,second.id);
 const history=json(`set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`+rpc('list_proposal_history_v1',[brief]));assert.deepEqual(history.rounds.map(g=>g.round_number),[2,1]);
 assert.throws(()=>q(`set role authenticated;select set_config('request.jwt.claim.sub','${other}',false);`+rpc('list_proposal_history_v1',[brief])));
 assert.throws(()=>q(`update public.proposal_generations set refinement='{"chips":[],"text":"tamper"}' where id='${second.id}'`));
 const third=svc('explore_more_proposals_v1',[owner,brief,1,second.id,crypto.randomUUID(),'test:rounds',{chips:[],text:'New text only'}]);assert.equal(third.excluded_routes.length,1);
 const c3=svc('claim_proposal_generation_v1',[owner,third.id]);q('set role service_role;'+rpc('fail_proposal_generation_v1',[owner,third.id,c3.attempt_token,'provider_timeout']));
 const retry=svc('retry_proposals_v1',[owner,third.id,crypto.randomUUID()]);assert.equal(retry.round_number,3);assert.deepEqual(retry.refinement,third.refinement);assert.deepEqual(retry.excluded_routes,third.excluded_routes);
 const c4=svc('claim_proposal_generation_v1',[owner,third.id]);assert.equal(c4.attempt_number,2);
 variant.candidates[0].route.stops[0].destination='Different destination';const good=await runProposalEngine({snapshot:f.snapshot,round:{excluded_routes:c4.excluded_routes,is_exploration:true},generator:{generate:async()=>variant}});svc('finish_proposal_generation_v1',[owner,third.id,c4.attempt_token,good]);
 const after=json(`select jsonb_build_object('brief',(select to_jsonb(b) from public.trip_briefs b where id='${brief}'),'trips',(select count(*) from public.trips),'items',(select count(*) from public.trip_itinerary_items),'reminders',(select count(*) from public.trip_reminders));`);assert.deepEqual(after,before);
 // Actual edits use the existing patch/confirmation contract. Notes alone cannot reset exclusions.
 q(`select set_config('request.jwt.claim.sub','${owner}',false); select public.apply_trip_brief_patch_v1('${brief}','${crypto.randomUUID()}',1,'{"decisions":{"note":{"field":"notes","scope":"global","knowledge":"known","strength":"preference","origin":"explicit_user","value":"Changed text"}}}'::jsonb);`);
 const notes=svc('request_proposals_v1',[owner,brief,2,crypto.randomUUID(),'test:rounds']);assert.equal(notes.excluded_routes.length,2);
 q(`select set_config('request.jwt.claim.sub','${owner}',false); select public.apply_trip_brief_patch_v1('${brief}','${crypto.randomUUID()}',2,'{"decisions":{"duration":{"field":"duration","scope":"global","knowledge":"known","strength":"preference","origin":"explicit_user","value":{"unit":"nights","min":5,"max":5}}}}'::jsonb);`);
 const changed=svc('request_proposals_v1',[owner,brief,3,crypto.randomUUID(),'test:rounds']);assert.equal(changed.excluded_routes.length,0);
 assert.equal(read(first.id).proposals.length,1);
 // Independent PostgreSQL connections: same explicit action converges; two new
 // actions from the same parent cannot fork the round chain.
 const empty={status:'no_results',result_reason:'insufficient_information',proposals:[]};
 const changedClaim=svc('claim_proposal_generation_v1',[owner,changed.id]);svc('finish_proposal_generation_v1',[owner,changed.id,changedClaim.attempt_token,empty]);
 function client(command){return new Promise((resolve,reject)=>{const child=spawn('docker',['exec','-i','supabase_db_freya-travel','psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',context.database]);let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('close',code=>resolve({code,output}));child.stdin.end('set role service_role;'+command)})}
 const raceArgs=[owner,brief,3,changed.id,crypto.randomUUID(),'test:rounds',refinement];
 const same=await Promise.all([client(rpc('explore_more_proposals_v1',raceArgs)),client(rpc('explore_more_proposals_v1',raceArgs))]);assert.ok(same.every(r=>r.code===0));
 const child=svc('explore_more_proposals_v1',raceArgs);const childClaim=svc('claim_proposal_generation_v1',[owner,child.id]);svc('finish_proposal_generation_v1',[owner,child.id,childClaim.attempt_token,empty]);
 const competing=await Promise.all([1,2].map(()=>client(rpc('explore_more_proposals_v1',[owner,brief,3,child.id,crypto.randomUUID(),'test:rounds',refinement]))));assert.equal(competing.filter(r=>r.code===0).length,1);assert.ok(competing.find(r=>r.code!==0).output.includes('Round changed'));
 let latest=read().generation;
 for(let i=0;i<6;i++){const c=svc('claim_proposal_generation_v1',[owner,latest.id]);svc('finish_proposal_generation_v1',[owner,latest.id,c.attempt_token,empty]);latest=svc('explore_more_proposals_v1',[owner,brief,3,latest.id,crypto.randomUUID(),'test:rounds',refinement]);}
 const historyRead=before=>json(`set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`+rpc('list_proposal_history_v1',before?[brief,before]:[brief]));
 const page1=historyRead(),page2=historyRead(page1.next_before);assert.equal(page1.rounds.length,10);assert.ok(page2.rounds.length>0);assert.equal(new Set([...page1.rounds,...page2.rounds].map(g=>g.id)).size,page1.rounds.length+page2.rounds.length);assert.equal(page2.rounds.at(-1).id,first.id);
 console.log('PASS TB042 concurrency: same-operation convergence and competing-round CAS; paginated history preserves every round');
 console.log('PASS TB042 rounds: RLS/CAS/receipts, retry same round, history 3 rounds, cross-round route exclusion, zero new alternatives, notes vs material changes, immutable context and no operational writes');
}

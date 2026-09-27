// Only called with the disposable local DB created by test-progress-db.mjs.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {runProposalEngine} from '../supabase/functions/proposal-engine/engine.mjs';
import {renderProposalResult} from '../domain/proposal-builder.mjs';
const literal=v=>"'"+String(v).replaceAll("'","''")+"'";
export async function testProposals({sql,docker,database,container}){
 const f=JSON.parse(readFileSync(new URL('../supabase/functions/proposal-engine/test-fixtures/golden-v1.json',import.meta.url),'utf8'));
 const owner='40000000-0000-4000-8000-000000000001',other='40000000-0000-4000-8000-000000000002',brief='40000000-0000-4000-8000-000000000003';
 const q=command=>docker(['psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,'-c',command]);
 const json=command=>JSON.parse(q(command).split('\n').find(l=>l.startsWith('{')||l.startsWith('[')));
 const call=(name,args)=>`select public.${name}(${args.map(literal).join(',')});`;
 const svc=command=>'set role service_role; '+command;
 const op=()=>crypto.randomUUID();
 sql(`insert into auth.users(id) values ('${owner}'),('${other}'); select set_config('request.jwt.claim.sub','${owner}',false); select public.apply_trip_brief_patch_v1('${brief}','${op()}',0,${literal(JSON.stringify(f.snapshot))}::jsonb);`);
 const before=json(`select jsonb_build_object('briefs',(select jsonb_agg(to_jsonb(b)) from public.trip_briefs b),'receipts',(select jsonb_agg(to_jsonb(r)) from public.trip_brief_operations r),'trips',(select count(*) from public.trips),'reminders',(select count(*) from public.trip_reminders),'activities',(select count(*) from public.trip_activities));`);
 const operation=op(),request=call('request_proposals_v1',[owner,brief,1,operation,'test:golden-v1']);
 const g=json(svc(request));assert.equal(json(svc(request)).id,g.id);
 assert.equal(json(svc(call('request_proposals_v1',[owner,brief,1,op(),'test:golden-v1']))).id,g.id);
 assert.throws(()=>q(svc(call('request_proposals_v1',[owner,brief,2,operation,'test:golden-v1']))));
 assert.throws(()=>q(svc(call('request_proposals_v1',[other,brief,1,op(),'test:golden-v1']))));
 assert.throws(()=>q(svc(call('request_proposals_v1',[owner,brief,2,op(),'test:golden-v1']))));
 assert.throws(()=>q(svc(`select public.request_proposals_v1('${owner}','${brief}',null,'${op()}','test:golden-v1');`)));
 assert.throws(()=>q('set role authenticated; '+request));
 assert.throws(()=>q('set role anon; '+call('get_proposals_v1',[brief])));
 assert.throws(()=>q(`set role authenticated; delete from public.proposal_generations;`));
 assert.throws(()=>q(`set role authenticated; select * from public.proposal_operations;`));
 assert.equal(q(`set role authenticated; select set_config('request.jwt.claim.sub','${other}',false); select count(*) from public.proposal_generations;`).trim().split('\n').at(-1),'0');
 console.log('PASS TB04 SQL: ownership/RLS/direct writes/receipts/CAS');
 const claim=json(svc(call('claim_proposal_generation_v1',[owner,g.id])));
 assert.equal(q(svc(call('claim_proposal_generation_v1',[owner,g.id]))).trim(),'SET');
 const engineResult=await runProposalEngine({snapshot:claim.brief_snapshot,generator:{generate:async()=>f.batch},now:Date.parse(f.now)});
 const finish=result=>call('finish_proposal_generation_v1',[owner,g.id,claim.attempt_token,JSON.stringify(result)]);
 // Both over-limit and a duplicate late in the batch must leave zero rows.
 for(const bad of [{...engineResult,proposals:Array(4).fill(engineResult.proposals[0])},{...engineResult,proposals:Array(2).fill(engineResult.proposals[0])}]){
  assert.throws(()=>q(svc(finish(bad))));assert.equal(q(`select count(*) from public.trip_proposals where generation_id='${g.id}'`).trim(),'0');
 }
 const forged=structuredClone(engineResult);forged.proposals[0].document.evaluations[0].state='violated';assert.throws(()=>q(svc(finish(forged))));
 const commercial=structuredClone(engineResult);commercial.proposals[0].document.verification[0].certainty='provider_available';assert.throws(()=>q(svc(finish(commercial))));
 const missing=structuredClone(engineResult);missing.proposals[0].document.evaluations.pop();assert.throws(()=>q(svc(finish(missing))));
 assert.equal(json(svc(finish(engineResult))).status,'completed');assert.equal(json(svc(finish(engineResult))).status,'completed');
 assert.throws(()=>q(svc(finish({...engineResult,result_reason:'incompatible'}))));
 assert.throws(()=>q(`update public.trip_proposals set document=document where generation_id='${g.id}'`));
 assert.throws(()=>q(`update public.proposal_generations set brief_revision=2 where id='${g.id}'`));
 const read=json(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false); ${call('get_proposals_v1',[brief,g.id])}`);
 assert.equal(read.proposals.length,1);assert.equal(read.stale,false);assert.equal(read.generation.attempt_token,undefined);
 assert.match(renderProposalResult(read),/Pendent de validar imprescindibles/);
 writeFileSync('/tmp/freya-tb04-golden.json',JSON.stringify(read));
 const after=json(`select jsonb_build_object('briefs',(select jsonb_agg(to_jsonb(b)) from public.trip_briefs b),'receipts',(select jsonb_agg(to_jsonb(r)) from public.trip_brief_operations r),'trips',(select count(*) from public.trips),'reminders',(select count(*) from public.trip_reminders),'activities',(select count(*) from public.trip_activities));`);
 assert.deepEqual(after,before);
 console.log('PASS TB04 Golden: fixture generator → engine → atomic SQL → owner read → UI; no Brief/operational mutations');
 function client(command){return new Promise((resolve,reject)=>{const child=spawn('docker',['exec','-i',container,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',database]);let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('close',code=>code?reject(Error(output)):resolve(output));child.stdin.end(command)})}
 const racing=await Promise.all([1,2].map(()=>client(svc(call('request_proposals_v1',[owner,brief,1,op(),'test:race-v1'])))));
 const ids=racing.map(output=>JSON.parse(output.split('\n').find(l=>l.startsWith('{'))).id);assert.equal(ids[0],ids[1]);
 const claims=await Promise.all([1,2].map(()=>client(svc(call('claim_proposal_generation_v1',[owner,ids[0]])))));
 assert.equal(claims.filter(output=>output.includes('attempt_token')).length,1);
 const first=JSON.parse(claims.find(output=>output.includes('attempt_token')).split('\n').find(l=>l.startsWith('{')));
 sql(`update public.proposal_generations set lease_expires_at=now()-interval '1 second' where id='${first.id}'`);
 const second=json(svc(call('claim_proposal_generation_v1',[owner,first.id])));assert.notEqual(first.attempt_token,second.attempt_token);
 assert.throws(()=>q(svc(call('finish_proposal_generation_v1',[owner,first.id,first.attempt_token,JSON.stringify(engineResult)]))));
 assert.throws(()=>q(svc(call('fail_proposal_generation_v1',[owner,first.id,first.attempt_token,'provider_error']))));
 q(svc(call('fail_proposal_generation_v1',[owner,second.id,second.attempt_token,'provider_error'])));
 const retryOp=op();assert.equal(json(svc(call('retry_proposals_v1',[owner,second.id,retryOp]))).status,'pending');
 const third=json(svc(call('claim_proposal_generation_v1',[owner,second.id])));
 assert.equal(json(svc(call('retry_proposals_v1',[owner,second.id,retryOp]))).attempt_token,third.attempt_token);
 sql(`select set_config('request.jwt.claim.sub','${owner}',false); select public.apply_trip_brief_patch_v1('${brief}','${op()}',1,'{}'::jsonb);`);
 const obsolete=json(svc(call('finish_proposal_generation_v1',[owner,third.id,third.attempt_token,JSON.stringify(engineResult)])));assert.equal(obsolete.status,'obsolete');
 assert.equal(q(`select count(*) from public.trip_proposals where generation_id='${third.id}'`).trim(),'0');
 const stale=json(`set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false); ${call('get_proposals_v1',[brief,g.id])}`);assert.equal(stale.stale,true);
 console.log('PASS TB04 concurrency: 6 cases (concurrent requests, exclusive lease, lease recovery, old token, retry receipt, Brief edit during generation)');
 const zero=json(svc(call('request_proposals_v1',[owner,brief,2,op(),'test:zero-v1'])));const zc=json(svc(call('claim_proposal_generation_v1',[owner,zero.id])));
 const zr=json(svc(call('finish_proposal_generation_v1',[owner,zero.id,zc.attempt_token,JSON.stringify({status:'no_results',result_reason:'insufficient_information',proposals:[]})])));assert.equal(zr.status,'no_results');
 console.log('PASS TB04 SQL: zero results and immutability');
}

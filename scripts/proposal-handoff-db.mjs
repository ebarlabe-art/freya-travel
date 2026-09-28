import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {runProposalEngine} from '../supabase/functions/proposal-engine/engine.mjs';
const lit=v=>"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'";
export async function testHandoff({docker,database,container}){
 const q=s=>docker(['psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,'-c',s]).trim();
 const json=s=>JSON.parse(q(s).split('\n').find(l=>l.startsWith('{')||l.startsWith('[')));
 const call=(name,args)=>`select public.${name}(${args.map(lit).join(',')});`;
 const owner=crypto.randomUUID(),other=crypto.randomUUID();q(`insert into auth.users(id) values('${owner}'),('${other}');`);
 const as=(id,s)=>`set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);${s}`;
 const f=JSON.parse(readFileSync(new URL('../supabase/functions/proposal-engine/test-fixtures/golden-v1.json',import.meta.url)));
 const svc=(n,a)=>json('set role service_role;'+call(n,a));
 async function seed({empty=false,two=false}={}){
  const brief=crypto.randomUUID(),createOp=crypto.randomUUID();json(as(owner,call('apply_trip_brief_patch_v1',[brief,createOp,0,f.snapshot])));
  const batch=structuredClone(f.batch),c=batch.candidates[0];
  if(empty){c.components=[];c.experience_blocks.forEach(b=>b.component_ids=[]);}else{c.components.push({id:'hotel_a',kind:'accommodation',subject_id:'stop_a',description:'Unknown accommodation',claim_ids:[]},{id:'flight_a',kind:'transport',subject_id:'stop_a',description:'Transport not classified by prose',claim_ids:[]},{id:'bus_a',kind:'transport',subject_id:'stop_a',description:'Other transport',claim_ids:[]});}
  if(two){const other=structuredClone(c);other.route.stops[0].destination='Other destination';batch.candidates.push(other);}
  const g=svc('request_proposals_v1',[owner,brief,1,crypto.randomUUID(),'test:handoff']);const claim=svc('claim_proposal_generation_v1',[owner,g.id]);const output=await runProposalEngine({snapshot:f.snapshot,generator:{generate:async()=>batch}});svc('finish_proposal_generation_v1',[owner,g.id,claim.attempt_token,output]);
  const rows=json(as(owner,call('get_proposals_v1',[brief,g.id])));const details={name:'Synthetic planned trip',time_zone:'Europe/Madrid',start_date:null,end_date:null,acknowledge_unresolved:true,components:empty?{}:{experience_a:{target:'activity',time_zone:null},hotel_a:{target:'accommodation',time_zone:'Europe/London'},flight_a:{target:'flight',time_zone:null},bus_a:{target:'transport',time_zone:null}}};
  return {brief,createOp,g,rows,details,args:[brief,1,rows.proposals[0].id,g.id,g.snapshot_hash,crypto.randomUUID(),details]};
 }
 const apply=(args,id=owner)=>json(as(id,call('formalize_trip_proposal_v1',args)));
 const counts=()=>json(`select jsonb_build_object(${['trips','trip_members','trip_accommodations','trip_flights','trip_activities','trip_proposal_handoffs','trip_proposal_component_links','trip_handoff_operations'].map(t=>`${lit(t)},(select count(*) from public.${t})`).join(',')});`);
 const a=await seed();const before=counts();
 assert.throws(()=>apply(a.args,other));
 for(const index of [0,2,3]){const bad=[...a.args];bad[index]=crypto.randomUUID();assert.throws(()=>apply(bad));}
 const stale=[...a.args];stale[1]=2;assert.throws(()=>apply(stale));const hash=[...a.args];hash[4]='0'.repeat(64);assert.throws(()=>apply(hash));
 for(const bad of [{...a.details,acknowledge_unresolved:false},{...a.details,time_zone:'invented'},{...a.details,start_date:'2026-12-01'},{...a.details,components:{}},{...a.details,components:{...a.details.components,flight_a:{target:'activity',time_zone:null}}}])assert.throws(()=>apply([...a.args.slice(0,6),bad]));
 assert.deepEqual(counts(),before);
 const done=apply(a.args);assert.equal(done.component_links.length,4);assert.equal(done.brief_revision,2);assert.equal(done.already_formalized,false);
 assert.equal(apply(a.args).replayed,true);assert.equal(apply([...a.args.slice(0,5),crypto.randomUUID(),a.details]).trip_id,done.trip_id);
 assert.throws(()=>apply([...a.args.slice(0,6),{...a.details,name:'Another'}]));
 const state=json(`select jsonb_build_object('members',(select count(*) from public.trip_members where trip_id='${done.trip_id}'),'accommodation',(select to_jsonb(t) from public.trip_accommodations t where trip_id='${done.trip_id}'),'flight',(select to_jsonb(t) from public.trip_flights t where trip_id='${done.trip_id}'),'brief',(select to_jsonb(b) from public.trip_briefs b where id='${a.brief}'));`);
 assert.equal(state.members,1);assert.equal(state.accommodation.name,'Allotjament per concretar');assert.equal(state.accommodation.check_in_at,null);assert.equal(state.accommodation.reservation_status,'planning');assert.equal(state.flight.airline,null);assert.equal(state.flight.departure_at,null);assert.equal(state.flight.flight_status,'planning');assert.deepEqual(state.brief.document,f.snapshot);
 assert.throws(()=>json(as(owner,call('apply_trip_brief_patch_v1',[a.brief,crypto.randomUUID(),2,{}]))));const replay=json(as(owner,call('apply_trip_brief_patch_v1',[a.brief,a.createOp,0,f.snapshot])));assert.equal(replay.replayed,true);assert.equal(replay.brief.trip_id,done.trip_id);
 assert.throws(()=>q(`delete from public.trip_activities where trip_id='${done.trip_id}'`));assert.throws(()=>q(`update public.trip_proposal_component_links set component_id=component_id where handoff_id='${done.handoff_id}'`));
 assert.throws(()=>q(as(owner,`insert into public.trip_proposal_component_links select * from public.trip_proposal_component_links where handoff_id='${done.handoff_id}'`)));
 assert.throws(()=>q(as(owner,`update public.trip_proposal_handoffs set trip_id=trip_id where id='${done.handoff_id}'`)));
 assert.throws(()=>q(`insert into public.trip_proposal_component_links select * from public.trip_proposal_component_links where handoff_id='${done.handoff_id}'`));
 assert.throws(()=>q(`insert into public.trip_proposal_component_links(handoff_id,trip_id,component_id,activity_id) select handoff_id,'${crypto.randomUUID()}','forged',activity_id from public.trip_proposal_component_links where activity_id is not null limit 1`));
 q(`insert into public.trip_members(trip_id,user_id) values('${done.trip_id}','${other}')`);
 assert.throws(()=>json(as(other,call('get_trip_handoff_v1',[a.brief]))));assert.equal(q(as(other,'select count(*) from public.trip_proposal_handoffs;')).split('\n').at(-1),'0');assert.throws(()=>q(as(other,'select * from public.trip_handoff_operations')));
 console.log('PASS TB044 SQL: nominal all four targets, unknown data, receipts/frozen Brief, CAS, cross-user/cross-trip, RLS and immutable mappings');
 const empty=await seed({empty:true});assert.equal(apply(empty.args).component_links.length,0);
 // Real mid-transaction error at component three must roll back every insert.
 const failed=await seed();const beforeFailure=counts();q(`create function public.fail_handoff_test() returns trigger language plpgsql as $$begin raise exception 'Synthetic third component failure';end$$;create trigger fail_handoff_test before insert on public.trip_flights for each row execute function public.fail_handoff_test();`);
 assert.throws(()=>apply(failed.args));q('drop trigger fail_handoff_test on public.trip_flights;drop function public.fail_handoff_test();');assert.deepEqual(counts(),beforeFailure);assert.equal(q(`select trip_id is null from public.trip_briefs where id='${failed.brief}'`),'t');
 // Deferred integrity must reject a privileged partial handoff, not recover it heuristically.
 const forgedTrip=crypto.randomUUID();assert.throws(()=>q(`begin;insert into public.trips(id,name,owner_id,time_zone) values('${forgedTrip}','Partial','${owner}','Europe/Madrid');insert into public.trip_members(trip_id,user_id) values('${forgedTrip}','${owner}');insert into public.trip_proposal_handoffs(owner_id,brief_id,brief_revision,proposal_id,trip_id,snapshot_hash,request) values('${owner}','${failed.brief}',1,'${failed.rows.proposals[0].id}','${forgedTrip}','${failed.g.snapshot_hash}','{}');update public.trip_briefs set trip_id='${forgedTrip}',revision=2 where id='${failed.brief}';set constraints all immediate;commit;`),/Incomplete component mappings/);assert.deepEqual(counts(),beforeFailure);
 console.log('PASS TB044 SQL: empty proposal and third-component rollback without orphan trip/member/pieces/mappings/receipts');
 function client(args){return new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',container,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',database]);let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('error',reject);p.on('close',code=>resolve({code,out}));p.stdin.end(as(owner,call('formalize_trip_proposal_v1',args)));});}
 const race=await seed();const results=await Promise.all([client(race.args),client([...race.args.slice(0,5),crypto.randomUUID(),race.details])]);assert.ok(results.every(r=>r.code===0));const ids=results.map(r=>JSON.parse(r.out.split('\n').find(l=>l.startsWith('{'))).trip_id);assert.equal(ids[0],ids[1]);
 const rivals=await seed({two:true});const rivalArgs=[...rivals.args];rivalArgs[2]=rivals.rows.proposals[1].id;rivalArgs[5]=crypto.randomUUID();const opposed=await Promise.all([client(rivals.args),client(rivalArgs)]);assert.equal(opposed.filter(r=>r.code===0).length,1);
 console.log('PASS TB044 concurrency: different operation IDs converge; competing proposals yield one trip and one conflict');
 // Future TB05 confirmation is simulated only in this disposable fixture.
 q(`select set_config('request.jwt.claim.sub','${owner}',false);update public.trip_flights set departure_at=now()+interval '10 days',departure_time_zone='Europe/Madrid' where trip_id='${done.trip_id}';update public.trip_accommodations set check_in_at=now()+interval '10 days',check_out_at=now()+interval '11 days' where trip_id='${done.trip_id}';update public.trip_activities set start_at=now()+interval '10 days',time_zone='Europe/Madrid' where trip_id='${done.trip_id}';set role service_role;select public.sync_notification_deliveries();`);
 assert.equal(q(`select count(*) from public.trip_reminders where trip_id='${done.trip_id}' and enabled`),'0');
 q(`select set_config('request.jwt.claim.sub','${owner}',false);update public.trip_flights set flight_status='confirmed' where trip_id='${done.trip_id}';update public.trip_accommodations set reservation_status='confirmed' where trip_id='${done.trip_id}';update public.trip_activities set reservation_status='confirmed' where trip_id='${done.trip_id}';set role service_role;select public.sync_notification_deliveries();select public.sync_notification_deliveries();`);
 assert.equal(q(`select count(*) from public.trip_reminders where trip_id='${done.trip_id}' and enabled`),'5');
 q(`select set_config('request.jwt.claim.sub','${owner}',false);update public.trip_flights set flight_status='cancelled' where trip_id='${done.trip_id}';update public.trip_accommodations set reservation_status='cancelled' where trip_id='${done.trip_id}';update public.trip_activities set reservation_status='cancelled' where trip_id='${done.trip_id}';set role service_role;select public.sync_notification_deliveries();`);
 assert.equal(q(`select count(*) from public.trip_reminders where trip_id='${done.trip_id}' and enabled`),'0');assert.equal(q(`select count(*) from public.trip_reminders where trip_id='${done.trip_id}'`),'5');
 console.log('PASS TB044 reminders: planning excluded; future confirmation produces five unique reminders; cancellation/resync preserves identity');
}

export function beforeHandoff({docker,database}){
 const tables=['trip_briefs','trip_brief_operations','proposal_generations','trip_proposals','proposal_operations','trips','trip_members','trip_accommodations','trip_flights','trip_activities','travel_documents','trip_reminders'];
 const state=`jsonb_build_object(${tables.map(t=>`${lit(t)},coalesce((select jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text) from public.${t} x),'[]'::jsonb)`).join(',')})`;
 docker(['psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,'-c',`create table public.tb044_before as select ${state} as state;`]);return state;
}
export function afterHandoff({docker,database},state){docker(['psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,'-c',`do $$begin if (select state from public.tb044_before) is distinct from ${state} then raise exception 'Legacy state changed';end if;end$$;drop table public.tb044_before;`]);console.log('PASS TB044 before/after: all Briefs, proposals, receipts, trips, members, pieces, documents and reminders unchanged');}

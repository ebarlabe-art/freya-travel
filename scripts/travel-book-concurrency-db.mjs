import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const q=s=>`'${String(s).replaceAll("'","''")}'`;
export async function testTravelBookConcurrency({container,database,sql}){
 function session(command,{hold=false,onReady=()=>{}}={}){
  const child=spawn('docker',['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d',database]);
  let output='',ready=false;
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,output}));});
  child.stdout.on('data',b=>{output+=b;if(!ready&&output.includes('ALB_LOCK_HELD')){ready=true;onReady()}});child.stderr.on('data',b=>{output+=b});
  child.stdin.write(command);if(!hold)child.stdin.end();
  return {done,release(){child.stdin.end('commit;\n')}};
 }
 function setup(){
  const f=Object.fromEntries(['a','b','trip','book','ed','c1','c2','p1','p2'].map(k=>[k,randomUUID()]));
  sql(`insert into auth.users(id) values(${q(f.a)}),(${q(f.b)});insert into public.trips(id,name,owner_id,time_zone) values(${q(f.trip)},'ALB concurrency',${q(f.a)},'UTC');insert into public.trip_members(trip_id,user_id) values(${q(f.trip)},${q(f.a)}),(${q(f.trip)},${q(f.b)});select set_config('request.jwt.claim.sub',${q(f.a)},false);select public.create_travel_book_v1(${q(f.trip)},${q(f.book)},'Book',gen_random_uuid());select public.create_travel_book_edition_v1(${q(f.trip)},${q(f.book)},${q(f.ed)},'Edition',gen_random_uuid());select public.change_travel_book_structure_v1(${q(f.trip)},${q(f.book)},${q(f.ed)},gen_random_uuid(),1,${q(JSON.stringify([{id:f.c1,page_ids:[f.p1]},{id:f.c2,page_ids:[f.p2]}]))},'{}',array[${q(f.c1)},${q(f.c2)}]::uuid[]);`);
  return f;
 }
 const prefix=actor=>`begin; set local statement_timeout='8s'; set local lock_timeout='6s'; set local role authenticated;select set_config('request.jwt.claim.sub',${q(actor)},true);`;
 const save=(f,ids=[f.c1],version=1,label='changed',op=randomUUID())=>`select public.save_travel_book_compositions_v1(${q(f.trip)},${q(f.book)},${q(f.ed)},${q(op)},(select jsonb_agg(jsonb_build_object('expected_version',${version},'document',jsonb_set(v.document,'{metadata,label}',${q(JSON.stringify(label))}::jsonb)) order by v.composition_id desc) from public.travel_book_composition_versions v where v.composition_id=any(array[${ids.map(q)}]::uuid[]) and v.version=1));`;
 const revision=(f,versions=[1,1])=>`select public.create_travel_book_revision_v1(${q(f.trip)},${q(f.book)},${q(f.ed)},gen_random_uuid(),gen_random_uuid(),2,${q(JSON.stringify([{id:f.c1,version:versions[0]},{id:f.c2,version:versions[1]}]))});`;
 async function race(label,first,second,{secondError=null,parallel=false}={}){
  let readyResolve;const ready=new Promise(r=>{readyResolve=r});
  const a=session(first+"select 'ALB_LOCK_HELD';\n",{hold:true,onReady:readyResolve});
  await Promise.race([ready,a.done.then(r=>{throw Error('First transaction failed: '+r.output)}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('First transaction timeout')),10000);t.unref()})]);
  const b=session(second+'commit;\n');
  let br;
  try{
   if(parallel){br=await Promise.race([b.done,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Independent composition was blocked')),4000);t.unref()})]);}
   else await new Promise(r=>setTimeout(r,150));
  }finally{a.release()}
  const ar=await a.done;br??=await b.done;
  assert.equal(ar.code,0,ar.output);
  if(secondError){assert.notEqual(br.code,0,br.output);assert.ok(br.output.includes(secondError),br.output)}else assert.equal(br.code,0,br.output);
  console.log('PASS concurrent '+label);
 }
 {
  const f=setup();await race('same composition rejects stale CAS',prefix(f.a)+save(f),prefix(f.b)+save(f,[f.c1],1,'other'),{secondError:'40001'});
 }
 {
  const f=setup();await race('different compositions make progress independently',prefix(f.a)+save(f),prefix(f.b)+save(f,[f.c2]),{parallel:true});
 }
 {
  const f=setup(),op=randomUUID(),call=save(f,[f.c1],1,'same',op);await race('duplicate operation applies once',prefix(f.a)+call,prefix(f.a)+call);
  const count=sql(`select count(*) from public.travel_book_operations where actor_id=${q(f.a)} and operation_id=${q(op)}`);assert.match(count,/\b1\b/);
 }
 {
  const f=setup();await race('atomic two-composition save rejects stale second writer',prefix(f.a)+save(f,[f.c1,f.c2]),prefix(f.b)+save(f,[f.c2,f.c1],1,'opposing'),{secondError:'40001'});
  sql(`do $$begin if (select count(*) from public.travel_book_compositions where edition_id=${q(f.ed)} and current_version=2)<>2 then raise exception 'partial multi-save';end if;end$$`);
 }
 {
  const f=setup();const reorder=`select public.change_travel_book_structure_v1(${q(f.trip)},${q(f.book)},${q(f.ed)},gen_random_uuid(),2,'[]','{}',array[${q(f.c2)},${q(f.c1)}]::uuid[]);`;
  await race('reorder waits for save and preserves content',prefix(f.a)+save(f),prefix(f.b)+reorder);
 }
 {
  const f=setup();await race('checkpoint rejects stale set after atomic save',prefix(f.a)+save(f,[f.c1,f.c2]),prefix(f.b)+revision(f),{secondError:'40001'});
  sql(prefix(f.a)+revision(f,[2,2])+'commit;');
 }
 {
  const f=setup();await race('checkpoint before save pins old versions consistently',prefix(f.a)+revision(f),prefix(f.b)+save(f,[f.c1,f.c2]));
  sql(`do $$begin if exists(select 1 from public.travel_book_revision_compositions where edition_id=${q(f.ed)} and composition_version<>1) then raise exception 'mixed checkpoint';end if;end$$`);
 }
 {
  const f=setup();const remove=`select public.change_travel_book_structure_v1(${q(f.trip)},${q(f.book)},${q(f.ed)},gen_random_uuid(),2,'[]',array[${q(f.c1)}]::uuid[],array[${q(f.c2)}]::uuid[]);`;
  await race('removal prevents queued save',prefix(f.a)+remove,prefix(f.b)+save(f),{secondError:'P0002'});
 }
 {
  const f=setup();await race('committed membership revocation denies queued save',`begin;delete from public.trip_members where trip_id=${q(f.trip)} and user_id=${q(f.b)};`,prefix(f.b)+save(f),{secondError:'42501'});
 }
 {
  const f=setup();await race('committed trip discard denies queued save',`begin;update public.trips set discarded_at=clock_timestamp(),discarded_by=${q(f.a)} where id=${q(f.trip)};`,prefix(f.b)+save(f),{secondError:'42501'});
 }
 {
  const f=setup();await race('in-flight authorized save finishes before revocation',prefix(f.b)+save(f),`begin;delete from public.trip_members where trip_id=${q(f.trip)} and user_id=${q(f.b)};`);
  let denied=false;try{sql(prefix(f.b)+save(f,[f.c2])+'commit;')}catch(e){denied=String(e).includes('42501')}assert.ok(denied,'revocation must cut subsequent writes');
 }
}

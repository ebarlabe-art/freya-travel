// Only a disposable database in a local Docker container; never a remote URL.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
const container=process.argv.includes('--ci-container')?'freya_shared_trip_ci':'supabase_db_freya-travel';
const database=`freya_shared_trip_test_${process.pid}`;
const owner='12500000-0000-4000-8000-000000000001',friend='12500000-0000-4000-8000-000000000002',outsider='12500000-0000-4000-8000-000000000003';
function sql(input,db=database){const r=spawnSync('docker',['exec','-i',container,'psql','-XAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],{input,encoding:'utf8',maxBuffer:16*1024*1024});if(r.status!==0)throw Error(r.error?.message||r.stderr);return r.stdout.trim()}
const file=p=>sql(readFileSync(p,'utf8'));
const as=(user,query)=>sql(`begin; set local role authenticated; set local "request.jwt.claim.sub"='${user}'; ${query}; commit;`).split('\n').filter(x=>!['BEGIN','SET','COMMIT'].includes(x)).join('\n');
const check=(user,condition)=>assert.equal(as(user,`select (${condition})`),'t',condition);
let created=false;
try{
 sql(`create database ${database}`,'postgres');created=true;
 for(const p of ['supabase/tests/local_progress_baseline.sql','supabase.sql','supabase/tests/local_progress_travel_baseline.sql'])file(p);
 for(const name of readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort()){
  if(name==='20260901144811_schedule_itinerary_notifications.sql')continue;
  if(name==='20260903172118_identify_london_2026_experience.sql')sql("insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'); insert into public.trips(id,name,owner_id) values ('9035e47f-f16c-4fa3-83fd-873bd98dc221','Historical local fixture','00000000-0000-4000-8000-000000000001');");
  if(name.endsWith('_travel_book_ingestion_v1.sql'))file('supabase/tests/alb03_storage_baseline.sql');
  file(`supabase/migrations/${name}`);
 }
 sql(`insert into auth.users(id) values ('${owner}'),('${friend}'),('${outsider}')`);
 const stops=JSON.stringify([{label:'Synthetic destination',canonical_name:'Synthetic destination',latitude:0,longitude:0,time_zone:'UTC',provider:'geoapify',provider_place_id:'synthetic-125'}]);
 const create=name=>JSON.parse(as(owner,`select row_to_json(t) from public.create_trip_with_stops_v1('${name}','2030-01-01','2030-01-02','${stops}') t`));
 const a=create('Synthetic shared trip'),b=create('Synthetic private trip');
 check(owner,'(select count(*) from public.get_my_trips())=2');
 check(friend,'(select count(*) from public.get_my_trips())=0');
 for(let i=0;i<2;i++)assert.equal(JSON.parse(as(friend,`select row_to_json(t) from public.join_trip_v2(' ${a.invite_code.toLowerCase()} ') t`)).id,a.id);
 check(friend,`(select count(*) from public.trip_members where user_id='${friend}' and trip_id='${a.id}')=1`);
 check(friend,`(select count(*) from public.get_my_trips())=1 and (select id from public.get_my_trips())='${a.id}'`);
 check(friend,`(select count(*) from public.trip_stops)=1 and not exists(select 1 from public.trips where id='${b.id}')`);
 const insert=(t,title)=>`insert into public.trip_itinerary_items(trip_id,title,timing_kind,created_by) values ('${t}','${title}','unscheduled','${owner}') returning id`;
 const item=as(owner,insert(a.id,'Shared agenda')).split('\n')[0];as(owner,insert(b.id,'Private agenda'));
 check(friend,`(select count(*) from public.trip_itinerary_items)=1`);
 check(outsider,`not exists(select 1 from public.trips) and not exists(select 1 from public.trip_stops) and not exists(select 1 from public.trip_itinerary_items) and not exists(select 1 from public.get_my_trips())`);
 for(const user of [friend,outsider]){
  assert.match(as(user,`update public.trip_itinerary_items set title='Intrusion' where trip_id='${b.id}'`),/UPDATE 0/);
  assert.match(as(user,`delete from public.trip_itinerary_items where trip_id='${b.id}'`),/DELETE 0/);
  assert.throws(()=>as(user,`insert into public.trip_itinerary_items(trip_id,title,timing_kind,created_by) values ('${b.id}','Intrusion','unscheduled','${user}')`),/row-level security/);
 }
 as(friend,`update public.trip_itinerary_items set title='Friend edit' where id='${item}'`);
 check(owner,`(select title='Friend edit' and updated_by='${friend}' from public.trip_itinerary_items where id='${item}')`);
 assert.throws(()=>as(friend,`update public.trip_itinerary_items set trip_id='${b.id}' where id='${item}'`),/immutables|row-level security/);
 console.log('PASS real create-with-stops → list → normalized/repeated join; three identities, two trips; RLS read/write/delete and immutable trip scope');
 const version=as(owner,`select updated_at from public.trip_itinerary_items where id='${item}'`);
 const update=title=>`update public.trip_itinerary_items set title='${title}' where trip_id='${a.id}' and id='${item}' and updated_at='${version}' returning id;`;
 function client(user,command,onOutput=()=>{}){
  const child=spawn('docker',['exec','-i',container,'psql','-XAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',database]);let output='';
  child.stdout.on('data',data=>{output+=data;onOutput(output)});child.stderr.on('data',data=>output+=data);
  child.stdin.end(`begin; set local role authenticated; set local "request.jwt.claim.sub"='${user}'; ${command} commit;`);
  return new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,output}))});
 }
 let second;
 const first=await client(owner,`${update('Owner wins')} select 'LOCK_HELD'; select pg_sleep(0.5);`,output=>{if(!second&&output.includes('LOCK_HELD'))second=client(friend,update('Stale overwrite'))});
 assert.equal(first.code,0,first.output);assert.ok(second);const stale=await second;assert.equal(stale.code,0,stale.output);assert.match(stale.output,/UPDATE 0/);
 for(const user of [owner,friend])check(user,`(select title='Owner wins' from public.trip_itinerary_items where id='${item}')`);
 const fresh=as(friend,`select updated_at from public.trip_itinerary_items where id='${item}'`);
 assert.match(as(friend,`update public.trip_itinerary_items set title='Reconciled' where id='${item}' and updated_at='${fresh}'`),/UPDATE 1/);
 check(owner,`(select title='Reconciled' from public.trip_itinerary_items where id='${item}')`);
 check(owner,`(select count(*) from public.trip_itinerary_items)=2`);
 check(owner,`exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='trip_itinerary_items')`);
 console.log('PASS two concurrent authenticated clients: stale CAS rejected, fresh retry observed by both, no duplicate agenda items; Realtime publication present');
}finally{if(created){sql(`drop database ${database}`,'postgres');console.log('Removed disposable shared-trip database')}}

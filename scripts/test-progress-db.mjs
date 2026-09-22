// LOCAL ONLY. Creates/drops its own disposable database inside the fixed local
// Supabase container. No URL, project ref, production credentials or remote CLI.
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
const container='supabase_db_freya-travel';
const database=`freya_progress_test_${process.pid}`;
function docker(args,input){
  const result=spawnSync('docker',['exec','-i',container,...args],{input,encoding:'utf8',maxBuffer:16*1024*1024});
  if(result.status!==0)throw new Error(result.error?.message||result.stderr||result.stdout);
  return result.stdout;
}
function sql(input,db=database){return docker(['psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],input)}
function file(path){sql(readFileSync(path,'utf8'));console.log(`PASS ${path}`)}
async function concurrentCommands(){
  const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002',t='10000000-0000-4000-8000-000000000003',id='10000000-0000-4000-8000-000000000004';
  sql(`insert into auth.users(id) values ('${a}'),('${b}'); insert into public.trips(id,name,owner_id,time_zone) values ('${t}','Concurrent test','${a}','UTC'); insert into public.trip_members(trip_id,user_id) values ('${t}','${a}'),('${t}','${b}'); select set_config('request.jwt.claim.sub','${a}',false); insert into public.trip_activities(id,trip_id,title,activity_type,time_zone) values ('${id}','${t}','Concurrent activity','other','UTC');`);
  const call=(desired,version)=>`select public.set_trip_event_completed('${t}','activity','${id}','start',${desired},'${version}');`;
  function client(text,onOutput=()=>{}){
    const child=spawn('docker',['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d',database]);
    let output='';child.stdout.on('data',data=>{output+=data;onOutput(output)});child.stderr.on('data',data=>{output+=data});child.stdin.end(text);
    return new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,output}))});
  }
  for(const desired of [true,false]){
    sql(`select set_config('request.jwt.claim.sub','${a}',false); update public.trip_activities set completed_at=null where id='${id}';`);
    const version=docker(['psql','-X','-At','-U','postgres','-d',database,'-c',`select updated_at from public.trip_activities where id='${id}'`]).trim();
    let second;
    // Launch B only after A has mutated and locked the row, before A commits.
    const first=await client(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${a}',true); ${call(true,version)} select 'PROGRESS_LOCK_HELD'; select pg_sleep(0.4); commit;`,output=>{
      if(!second&&output.includes('PROGRESS_LOCK_HELD'))second=client(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${b}',true); ${call(desired,version)} commit;`);
    });
    if(first.code!==0||!second)throw new Error(`First concurrent client failed: ${first.output}`);
    const result=await second;
    if(desired?result.code!==0:result.code===0||!result.output.includes('40001'))throw new Error(`Concurrent ${desired} failed: ${result.output}`);
    const done=docker(['psql','-X','-At','-U','postgres','-d',database,'-c',`select completed_at is not null from public.trip_activities where id='${id}'`]).trim();
    if(done!=='t')throw new Error('Concurrent stale command overwrote completion');
    console.log(`PASS concurrent independent sessions: ${desired?'same desired state converges':'stale opposing command rejected'}`);
  }
}
async function concurrentPhotos(){
  const a='20000000-0000-4000-8000-000000000001',b='20000000-0000-4000-8000-000000000002',t='20000000-0000-4000-8000-000000000003',id='20000000-0000-4000-8000-000000000004',batch='20000000-0000-4000-8000-000000000005';
  sql(`insert into auth.users(id) values ('${a}'),('${b}'); insert into public.trips(id,name,owner_id,time_zone) values ('${t}','Concurrent photos','${a}','UTC'); insert into public.trip_members(trip_id,user_id) values ('${t}','${a}'),('${t}','${b}');`);
  const finalize=`select public.finalize_trip_photo('${t}','${id}','Photo','file.jpg','image/jpeg','${batch}',0,null,null,null);`;
  function client(command,onOutput=()=>{}){
    const child=spawn('docker',['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d',database]);let output='';
    child.stdout.on('data',data=>{output+=data;onOutput(output)});child.stderr.on('data',data=>{output+=data});child.stdin.end(command);
    return new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>resolve({code,output}))});
  }
  async function race(firstCommand,secondCommand,secondUser,conflict){
    let second;
    const first=await client(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${a}',true); ${firstCommand} select 'PHOTO_LOCK_HELD'; select pg_sleep(0.4); commit;`,output=>{
      if(!second&&output.includes('PHOTO_LOCK_HELD'))second=client(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${secondUser}',true); ${secondCommand} commit;`);
    });
    if(first.code!==0||!second)throw new Error(`Photo concurrent first client: ${first.output}`);
    const result=await second;if(conflict?result.code===0||!result.output.includes('40001'):result.code!==0)throw new Error(`Photo concurrent second client: ${result.output}`);
  }
  await race(finalize,finalize,a,false);
  const version=docker(['psql','-X','-At','-U','postgres','-d',database,'-c',`select updated_at from public.trip_photo_metadata where document_id='${id}'`]).trim();
  const edit=date=>`select public.set_trip_photo_context('${t}','${id}','${version}','${date}',null,null);`;
  await race(edit('2026-09-22'),edit('2026-09-23'),b,true);
  const count=docker(['psql','-X','-At','-U','postgres','-d',database,'-c',`select count(*)=1 and bool_and(local_date='2026-09-22') from public.trip_photo_metadata where document_id='${id}'`]).trim();
  if(count!=='t')throw new Error('Photo concurrent retry duplicated/overwrote data');
  console.log('PASS photo independent concurrent sessions: retry idempotent, member stale CAS rejected');
}
let created=false;
try{
  sql(`create database ${database};`,'postgres');created=true;
  file('supabase/tests/local_progress_baseline.sql');
  file('supabase.sql');
  file('supabase/tests/local_progress_travel_baseline.sql');
  for(const name of readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')).sort()){
    // Do not install/run any Cron job in the test container.
    if(name==='20260901144811_schedule_itinerary_notifications.sql'){console.log(`SKIP Cron scheduling only: ${name}`);continue}
    if(name==='20260903172118_identify_london_2026_experience.sql')sql("insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'); insert into public.trips(id,name,owner_id) values ('9035e47f-f16c-4fa3-83fd-873bd98dc221','Local migration precondition fixture','00000000-0000-4000-8000-000000000001');");
    if(name==='20260918174037_shared_trip_progress.sql')file('supabase/tests/progress_before_migration.sql');
    if(name==='20260922170531_contextual_photos_v1.sql'){
      sql("insert into public.travel_documents(trip_id,title,category,file_name,file_path,mime_type,created_by) values ('9035e47f-f16c-4fa3-83fd-873bd98dc221','Legacy photo snapshot','Foto','legacy.jpg','9035e47f-f16c-4fa3-83fd-873bd98dc221/photos/legacy.jpg','image/jpeg','00000000-0000-4000-8000-000000000001'); create table public.photo_before_snapshot as select to_jsonb(d) as row from public.travel_documents d;");
    }
    file(`supabase/migrations/${name}`);
    if(name==='20260918174037_shared_trip_progress.sql')file('supabase/tests/progress_after_migration.sql');
    if(name==='20260922170531_contextual_photos_v1.sql'){
      sql("do $$ begin if exists((select row from public.photo_before_snapshot except select to_jsonb(d) from public.travel_documents d) union all (select to_jsonb(d) from public.travel_documents d except select row from public.photo_before_snapshot)) or exists(select 1 from public.trip_photo_metadata) then raise exception 'Photo migration changed existing data'; end if; end $$; drop table public.photo_before_snapshot;");
      console.log('PASS photo migration: all existing document values preserved, no invented metadata');
    }
  }
  const failures=[];
  sql("delete from public.travel_documents where file_path='9035e47f-f16c-4fa3-83fd-873bd98dc221/photos/legacy.jpg'; delete from auth.users where id='00000000-0000-4000-8000-000000000001';");
  for(const name of readdirSync('supabase/tests').filter(name=>name.endsWith('_rollback.sql')).sort()){
    try{file(`supabase/tests/${name}`)}catch(error){failures.push(name);console.error(`FAIL ${name}: ${error.message}`)}
  }
  if(failures.length)throw new Error(`${failures.length} SQL suites failed: ${failures.join(', ')}`);
  await concurrentCommands();
  await concurrentPhotos();
}finally{
  if(created){sql(`drop database ${database};`,'postgres');console.log(`Removed disposable database ${database}`)}
}

// LOCAL ONLY: fixed Docker container, own disposable database. Never reads remote URLs/credentials.
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
const ciContainer=process.env.FREYA_CI_POSTGRES_CONTAINER||'freya_alb02_ci';
const container=process.argv.includes('--ci-container')?ciContainer:'supabase_db_freya-travel';
const database=`freya_alb02_test_${process.pid}`;
export function runDatabaseTests({afterBase}={}){
 const docker=(args,input)=>{const r=spawnSync('docker',['exec','-i',container,...args],{input,encoding:'utf8',maxBuffer:16*1024*1024});if(r.status!==0)throw Error(r.error?.message||r.stderr||r.stdout);return r.stdout};
 const sql=(s,db=database)=>docker(['psql','-X','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d',db],s);
 const file=p=>sql(readFileSync(p,'utf8'));
 let created=false;
 return {container,database,docker,sql,file,async run(){try{
  sql(`create database ${database}`,'postgres');created=true;
  file('supabase/tests/local_progress_baseline.sql');file('supabase.sql');file('supabase/tests/local_progress_travel_baseline.sql');
  for(const name of readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort()){
   if(name>'20261004214647_travel_book_commands_v1.sql')continue;
   if(name==='20260901144811_schedule_itinerary_notifications.sql'){console.log('SKIP external Cron scheduling');continue}
   if(name==='20260903172118_identify_london_2026_experience.sql')sql("insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'); insert into public.trips(id,name,owner_id) values ('9035e47f-f16c-4fa3-83fd-873bd98dc221','Local historical migration fixture','00000000-0000-4000-8000-000000000001');");
   if(name.endsWith('_travel_book_foundation_v1.sql')){
    sql("insert into public.travel_documents(trip_id,title,category,file_name,file_path,created_by) values ('9035e47f-f16c-4fa3-83fd-873bd98dc221','Preservation sentinel','Foto','sentinel.jpg','9035e47f-f16c-4fa3-83fd-873bd98dc221/photos/alb02-sentinel.jpg','00000000-0000-4000-8000-000000000001'); create table public.alb02_existing_rows(name text primary key,rows jsonb); do $$ declare t record; j jsonb; begin for t in select tablename from pg_tables where schemaname='public' and tablename<>'alb02_existing_rows' loop execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from public.%I r',t.tablename) into j;insert into public.alb02_existing_rows values(t.tablename,j);end loop;end$$;");
   }
   file(`supabase/migrations/${name}`);
  }
  sql("do $$ declare t record;j jsonb;begin for t in select * from public.alb02_existing_rows loop execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb) from public.%I r',t.name) into j;if j is distinct from t.rows then raise exception 'Existing data changed: %',t.name;end if;end loop;end$$;drop table public.alb02_existing_rows;");
  console.log('PASS chronological migrations; all preexisting public table rows preserved');
  for(const name of readdirSync('supabase/tests').filter(n=>n.startsWith('travel_book_')&&n.endsWith('_rollback.sql')).sort()){sql((name==='travel_book_schema_rollback.sql'?'':readFileSync('supabase/tests/travel_book_fixture.sql','utf8'))+readFileSync(`supabase/tests/${name}`,'utf8'));console.log(`PASS ${name}`)}
  if(!process.argv.includes('--schema-only')){
    const {testTravelBookConcurrency}=await import('./travel-book-concurrency-db.mjs');await testTravelBookConcurrency({container,database,docker,sql});
  }
 if(afterBase)await afterBase({container,database,docker,sql,file});
 }finally{if(created){sql(`drop database ${database}`,'postgres');console.log('Removed disposable ALB-02 database')}}}};
}
if(import.meta.url===new URL(process.argv[1],'file:').href)await runDatabaseTests().run();

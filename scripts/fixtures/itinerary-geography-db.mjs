// Disposable local Postgres fixture; never accepts a connection string or credentials.
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
export async function geographyDatabase({module,tripId,userId}){
 const {PGlite}=await import(pathToFileURL(module).href),directory=await mkdtemp(join(tmpdir(),'freya-geography-228-'));
 let db=new PGlite(directory);
 const migrate=async name=>db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`create role anon;create role authenticated;create schema auth;create publication supabase_realtime;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;grant usage on schema auth to authenticated;
 create table trips(id uuid primary key);create table test_members(trip_id uuid,user_id uuid);grant select on test_members to authenticated;
 create function public.is_trip_member(id uuid) returns boolean language sql stable as $$select exists(select 1 from public.test_members where trip_id=id and user_id=auth.uid())$$;
 create table travel_documents(id uuid primary key,trip_id uuid,unique(trip_id,id));`);
 await db.query('insert into auth.users values($1)',[userId]);await db.query('insert into trips values($1)',[tripId]);await db.query('insert into test_members values($1,$2)',[tripId,userId]);
 await db.query("select set_config('test.user',$1,false)",[userId]);
 for(const name of ['20260908173557_create_trip_itinerary_items.sql','20260908203753_add_approximate_itinerary_times.sql','20260907184020_create_trip_activities.sql','20261016153108_itinerary_resolved_location_v27.sql','20261020100255_itinerary_ordered_place_points.sql','20261113124532_preserve_confirmed_activity_geography.sql'])await migrate(name);
 const columns=new Set((await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='trip_itinerary_items'")).rows.map(r=>r.column_name));
 await db.exec('set role authenticated');
 const rows=async()=> (await db.query('select to_jsonb(i) as row from trip_itinerary_items i order by sort_order,id')).rows.map(r=>r.row);
 return {
  rows,
  async insert(source){for(const row of source){const keys=Object.keys(row).filter(k=>columns.has(k));await db.query('insert into trip_itinerary_items('+keys.join(',')+') values('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map(k=>row[k]));}return rows()},
  async patch(patch,filters){const keys=Object.keys(patch);if(!keys.every(k=>columns.has(k))||!filters.every(([k])=>columns.has(k)))throw Error('Invalid local test column');const values=[...keys.map(k=>patch[k]),...filters.map(([,v])=>v)];const result=await db.query('update trip_itinerary_items set '+keys.map((k,i)=>k+'=$'+(i+1)).join(',')+' where '+filters.map(([k],i)=>k+'=$'+(keys.length+i+1)).join(' and ')+' returning to_jsonb(trip_itinerary_items) as row',values);return result.rows[0]?.row??null},
  async reopen(){await db.close();db=new PGlite(directory);await db.query("select set_config('test.user',$1,false)",[userId]);await db.exec('set role authenticated');return rows()},
  async close(){await db.close();await rm(directory,{recursive:true,force:true})}
 };
}

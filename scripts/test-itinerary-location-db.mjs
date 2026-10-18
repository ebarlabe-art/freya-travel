// Disposable embedded Postgres only. Never uses a remote database or credentials.
// Install @electric-sql/pglite outside the project and set PGLITE_MODULE to its index.js.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
if(!process.env.PGLITE_MODULE)throw Error('Set PGLITE_MODULE to an isolated @electric-sql/pglite installation');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
const owner='11800000-0000-4000-8000-000000000001',outsider='11800000-0000-4000-8000-000000000002',trip='11800000-0000-4000-8000-000000000003';
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 create table public.trips(id uuid primary key);
 create table public.test_members(trip_id uuid,user_id uuid);
 grant select on public.test_members to authenticated;
 create function public.is_trip_member(id uuid) returns boolean language sql stable as $$select exists(select 1 from public.test_members where trip_id=id and user_id=auth.uid())$$;
 insert into auth.users values('${owner}'),('${outsider}');insert into trips values('${trip}');
 insert into test_members values('${trip}','${owner}');set "test.user"='${owner}';`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260908173557_create_trip_itinerary_items.sql',import.meta.url),'utf8'));
 await db.exec(`set role authenticated;insert into public.trip_itinerary_items(trip_id,title,timing_kind,starts_at,ends_at,time_zone,location_name,city,notes,is_fixed)
 values('${trip}','Museum visit','exact','2030-01-01T09:00Z','2030-01-01T10:00Z','Europe/London','British Museum','London','Original document and reservation',true);reset role;`);
 const before=(await db.query('select * from trip_itinerary_items')).rows[0];
 // Minimal activity table contract for the shared invalidation trigger. Existing policies are untouched.
 await db.exec('create table public.trip_activities(id uuid,venue_name text,address text,city text,title text)');
 await db.exec(await readFile(new URL('../supabase/migrations/20261016153108_itinerary_resolved_location_v27.sql',import.meta.url),'utf8'));
 const snapshot={title:before.title,location_name:before.location_name,address:null,city:before.city,
  place:{canonical_name:'British Museum',provider:'geoapify',provider_place_id:'fixture',country_code:'GB',locality:'London',coordinate_role:'exact_location',latitude:51.5,longitude:-0.12,attribution:'Synthetic'}};
 await db.query('insert into trip_activities(id,venue_name,city,title,resolved_location) values($1,$2,$3,$4,$5)',
  [before.id,before.location_name,before.city,before.title,snapshot]);
 assert.deepEqual((await db.query('select resolved_location from trip_activities')).rows[0].resolved_location,snapshot);
 await db.exec("update trip_activities set venue_name='Corrected venue'");
 assert.equal((await db.query('select resolved_location from trip_activities')).rows[0].resolved_location,null);
 await db.exec('set role authenticated');
 await db.query('update trip_itinerary_items set resolved_location=$1 where id=$2',[snapshot,before.id]);
 const after=(await db.query('select * from trip_itinerary_items')).rows[0];
 assert.deepEqual(after.resolved_location,snapshot);
 for(const key of Object.keys(before).filter(k=>!['updated_at','updated_by'].includes(k)))assert.deepEqual(after[key],before[key],key+' preserved');
 const invalid=structuredClone(snapshot);invalid.place.latitude=999;
 await assert.rejects(db.query('update trip_itinerary_items set resolved_location=$1',[invalid]));
 const partial=structuredClone(snapshot);delete partial.place.provider_place_id;
 await assert.rejects(db.query('update trip_itinerary_items set resolved_location=$1',[partial]));
 await db.exec(`reset role;set "test.user"='${outsider}';set role authenticated;`);
 assert.equal((await db.query('select * from trip_itinerary_items')).rows.length,0);
 assert.equal((await db.query("update trip_itinerary_items set location_name='Wrong' returning id")).rows.length,0);
 await db.exec(`reset role;set "test.user"='${owner}';set role authenticated;`);
 // Same optimistic revision can be used only once.
 assert.equal((await db.query('update trip_itinerary_items set notes=notes where id=$1 and updated_at=$2 returning id',[before.id,before.updated_at])).rows.length,0);
 await db.exec("update trip_itinerary_items set location_name='My corrected entrance'");
 const corrected=(await db.query('select * from trip_itinerary_items')).rows[0];
 assert.equal(corrected.resolved_location,null);assert.equal(corrected.location_name,'My corrected entrance');
 assert.deepEqual(corrected.starts_at,before.starts_at);assert.deepEqual(corrected.ends_at,before.ends_at);
 // Bolonya existing manual plan: both quick and automatic paths persist name + snapshot.
 const bolognaId='11800000-0000-4000-8000-000000000004';
 await db.query(`insert into trip_itinerary_items(id,trip_id,title,timing_kind,starts_at,ends_at,time_zone,notes,is_fixed)
 values($1,$2,$3,'exact','2026-10-24T09:00Z','2026-10-24T10:00Z','Europe/Rome','Keep original document',true)`,
 [bolognaId,trip,'Opcional: visita a la Torre dell’Orologio, amb reserva prèvia.']);
 const bolognaBefore=(await db.query('select * from trip_itinerary_items where id=$1',[bolognaId])).rows[0];
 const bolognaSnapshot={title:bolognaBefore.title,location_name:'Torre dell’Orologio',address:null,city:null,
  place:{canonical_name:'Torre dell’Orologio',country_code:'IT',locality:'Bolonya',latitude:44.4937,longitude:11.3426,
   coordinate_role:'exact_location',provider:'geoapify',provider_place_id:'synthetic-tower',attribution:'Synthetic test data'}};
 const countBefore=(await db.query('select count(*) as n from trip_itinerary_items')).rows[0].n;
 const write=()=>db.query('update trip_itinerary_items set location_name=$1,resolved_location=$2 where id=$3 and updated_at=$4 and location_name is null returning id',
  [bolognaSnapshot.location_name,bolognaSnapshot,bolognaId,bolognaBefore.updated_at]);
 assert.equal((await write()).rows.length,1);assert.equal((await write()).rows.length,0,'No duplicate or stale write');
 const bolognaAfter=(await db.query('select * from trip_itinerary_items where id=$1',[bolognaId])).rows[0];
 assert.deepEqual(bolognaAfter.resolved_location,bolognaSnapshot,'Real invalidation trigger retains the full snapshot');
 for(const key of Object.keys(bolognaBefore).filter(k=>!['updated_at','updated_by','location_name','resolved_location'].includes(k)))assert.deepEqual(bolognaAfter[key],bolognaBefore[key]);
 assert.equal((await db.query('select count(*) as n from trip_itinerary_items')).rows[0].n,countBefore);
 await db.exec('delete from trip_itinerary_items');assert.equal((await db.query('select * from trip_itinerary_items')).rows.length,0);
 console.log('PASS embedded Postgres: real baseline and additive migration, unchanged original fields, valid/invalid geography, existing RLS owner/outsider, optimistic revisions, manual correction invalidation, deletion. No remote state verified.');
}finally{await db.close()}

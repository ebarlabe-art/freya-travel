// Real migrations in memory only. No remote database, credentials or personal data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {pointSnapshot} from '../domain/itinerary-place-points.mjs';
if(!process.env.PGLITE_MODULE)throw Error('PGLITE_MODULE required');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite(process.env.PGLITE_DATA_DIR||undefined);
const id=n=>'13800000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=id(1),member=id(2),outsider=id(3),trip=id(4);
const migration=name=>readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create publication supabase_realtime;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 create table public.trips(id uuid primary key);create table public.test_members(trip_id uuid,user_id uuid);grant select on test_members to authenticated;
 create function public.is_trip_member(id uuid) returns boolean language sql stable as $$select exists(select 1 from public.test_members where trip_id=id and user_id=auth.uid())$$;
 create table public.travel_documents(id uuid primary key,trip_id uuid,unique(trip_id,id));
 insert into auth.users values('${owner}'),('${member}'),('${outsider}');insert into trips values('${trip}');insert into test_members values('${trip}','${owner}'),('${trip}','${member}');set "test.user"='${owner}';`);
 await db.exec(await migration('20260908173557_create_trip_itinerary_items.sql'));
 await db.exec(await migration('20260907184020_create_trip_activities.sql'));
 await db.exec(await migration('20261016153108_itinerary_resolved_location_v27.sql'));
 await db.exec(`set role authenticated;insert into trip_itinerary_items(id,trip_id,title,timing_kind,starts_at,ends_at,time_zone,notes,is_fixed)
 values('${id(5)}','${trip}','Piazza Maggiore i passeig','exact','2030-01-01T09:00Z','2030-01-01T10:00Z','Europe/Rome','Keep source document',true);
 insert into trip_activities(id,trip_id,title,reservation_status,booking_reference) values('${id(6)}','${trip}','Reserved visit','confirmed','KEEP-SYNTHETIC');reset role;`);
 const before=(await db.query('select * from trip_itinerary_items')).rows[0],activityBefore=(await db.query('select * from trip_activities')).rows[0];
 await db.exec(await migration('20261020100255_itinerary_ordered_place_points.sql'));
 assert.equal((await db.query('select location_points from trip_itinerary_items')).rows[0].location_points,null,'no backfill');
 const place={canonical_name:'Piazza Maggiore',provider:'geoapify',provider_place_id:'synthetic',country_code:'IT',locality:'Bologna',kind:'street',coordinate_role:'representative_point',latitude:44.49,longitude:11.34,attribution:'Synthetic',formatted_address:null};
 const points=[{id:'a',query:'Piazza Maggiore',place},{id:'b',query:'Unknown',place:null}];
 const snapshot=pointSnapshot(before,points);
 await db.exec('set role authenticated');
 await db.query('update trip_itinerary_items set location_points=$1 where id=$2',[snapshot,before.id]);
 const after=(await db.query('select * from trip_itinerary_items')).rows[0];
 assert.deepEqual(after.location_points,snapshot);
 for(const k of Object.keys(before).filter(k=>!['updated_at','updated_by'].includes(k)))assert.deepEqual(after[k],before[k],k);
 for(const mutate of [s=>s.points[0].place.latitude=999,s=>s.points[0].status='resolved',s=>delete s.version,s=>s.points.push(s.points[0]),s=>s.points[0].place.provider='invented']){
  const invalid=structuredClone(snapshot);mutate(invalid);await assert.rejects(db.query('update trip_itinerary_items set location_points=$1',[invalid]));
 }
 await db.query('update trip_activities set location_points=$1',[pointSnapshot(activityBefore,points)]);
 const activityAfter=(await db.query('select * from trip_activities')).rows[0];
 for(const k of Object.keys(activityBefore).filter(k=>!['updated_at','updated_by'].includes(k)))assert.deepEqual(activityAfter[k],activityBefore[k],k);
 const revision=(await db.query('select updated_at::text as revision from trip_itinerary_items')).rows[0].revision;
 await db.exec(`reset role;set "test.user"='${member}';set role authenticated;`);
 const changed=pointSnapshot(before,[points[1],points[0]]);
 assert.equal((await db.query('update trip_itinerary_items set location_points=$1 where updated_at=$2 returning id',[changed,revision])).rows.length,1,'member may reorder');
 assert.equal((await db.query('update trip_itinerary_items set location_points=$1 where updated_at=$2 returning id',[snapshot,revision])).rows.length,0,'stale editor cannot overwrite');
 await db.exec(`reset role;set "test.user"='${outsider}';set role authenticated;`);
 for(const table of ['trip_itinerary_items','trip_activities']){
  assert.equal((await db.query('select * from '+table)).rows.length,0);
  assert.equal((await db.query('update '+table+' set location_points=null returning id')).rows.length,0);
 }
 await db.exec(`reset role;set role anon;`);await assert.rejects(db.query('select location_points from trip_itinerary_items'));
 await db.exec(`reset role;set "test.user"='${owner}';set role authenticated;`);
 await db.query('update trip_itinerary_items set location_points=$1',[pointSnapshot(before,[])]);
 assert.deepEqual((await db.query('select location_points from trip_itinerary_items')).rows[0].location_points.points,[],'empty manual choice survives');
 await db.exec("update trip_itinerary_items set title='Changed by old frontend';update trip_activities set venue_name='New venue';");
 assert.equal((await db.query('select location_points from trip_itinerary_items')).rows[0].location_points,null);
 assert.equal((await db.query('select location_points from trip_activities')).rows[0].location_points,null);
 assert.deepEqual((await db.query('select starts_at from trip_itinerary_items')).rows[0].starts_at,before.starts_at);

 await db.exec('reset role');
 await db.exec(await migration('20261113124532_preserve_confirmed_activity_geography.sql'));
 await db.exec('set role authenticated');
 const confirmedPlace={...place,canonical_name:'Saint-Bertrand-de-Comminges',country_code:'FR',locality:'Saint-Bertrand-de-Comminges',kind:'city',provider_place_id:'synthetic-town'};
 for(const table of ['trip_itinerary_items','trip_activities']){
  const row=(await db.query('select * from '+table)).rows[0];
  const current=pointSnapshot(row,[{id:'town',query:'Sant Bertrand',place:confirmedPlace},{id:'pending',query:'Chez Simone',place:null}]);
  await db.query('update '+table+' set location_points=$1 where id=$2',[current,row.id]);
  const changed=(await db.query("update "+table+" set title='Dinar al poble i visita al patrimoni',city='Text editorial corregit' where id=$1 returning *",[row.id])).rows[0];
  assert.equal(changed.location_points.points.length,1,'confirmed identity survives; stale pending query is not promoted');
  assert.equal(changed.location_points.points[0].place.provider_place_id,'synthetic-town');
  assert.deepEqual(changed.location_points.input,pointSnapshot(changed,[]).input);
  for(const k of Object.keys(row).filter(k=>!['title','city','location_points','updated_at','updated_by'].includes(k)))assert.deepEqual(changed[k],row[k],k+' preserved after descriptive edit');
  const legacy={...pointSnapshot(changed,[]).input,place:{...confirmedPlace,coordinate_role:'exact_location'}};
  await db.query('update '+table+' set resolved_location=$1 where id=$2',[legacy,row.id]);
  const renamed=(await db.query("update "+table+" set title='Nou text de la mateixa visita' where id=$1 returning *",[row.id])).rows[0];
  assert.equal(renamed.resolved_location.place.provider_place_id,'synthetic-town','legacy snapshot survives old client title update');
  assert.equal(renamed.resolved_location.title,renamed.title);
  const empty=pointSnapshot(renamed,[]);await db.query('update '+table+' set location_points=$1 where id=$2',[empty,row.id]);
  const removed=(await db.query("update "+table+" set title='Text posterior a eliminar els punts' where id=$1 returning *",[row.id])).rows[0];
  assert.deepEqual(removed.location_points.points,[],'explicit removal survives edit');
  await db.query('update '+table+' set location_points=null,resolved_location=null where id=$1',[row.id]);
  const cleared=(await db.query('select * from '+table+' where id=$1',[row.id])).rows[0];assert.equal(cleared.location_points,null);assert.equal(cleared.resolved_location,null);
 }
 await db.exec('reset role;set "test.user"=\''+outsider+'\';set role authenticated;');
 for(const table of ['trip_itinerary_items','trip_activities'])assert.equal((await db.query('update '+table+' set location_points=null returning id')).rows.length,0,'new contract keeps RLS');
 console.log('PASS actual baselines + additive points migration: no backfill, fields preserved, valid/invalid points, owner/member/outsider/anon RLS, stale editor conflict, reorder/remove, baseline invalidation reproduced, then #228 preservation of confirmed/legacy identities, pending-query invalidation, explicit removal and RLS verified. No remote state verified.');
}finally{await db.close()}

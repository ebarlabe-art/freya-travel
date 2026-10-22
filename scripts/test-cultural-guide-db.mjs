// Real additive migration in an isolated embedded Postgres. No network/database credentials.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {pathToFileURL} from 'node:url';
import {bolognaPlaces,cultureId,culturalArticle,proposedSections} from './fixtures/cultural-guide.mjs';import {guideProposal,guidePlaceKey} from '../domain/cultural-guide.mjs';
if(!process.env.PGLITE_MODULE)throw Error('PGLITE_MODULE required');
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite(),owner=cultureId(9),member=cultureId(10),outsider=cultureId(11),trip=cultureId(1),other=cultureId(2),guide=cultureId(70),place=bolognaPlaces[0],document=guideProposal(place,culturalArticle(place),proposedSections(culturalArticle(place)));
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create publication supabase_realtime;
 create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;grant usage on schema auth to authenticated;
 create table public.trips(id uuid primary key);create table public.test_members(trip_id uuid,user_id uuid);grant select on test_members to authenticated;
 create function public.is_trip_member(id uuid) returns boolean language sql stable as $$select exists(select 1 from public.test_members where trip_id=id and user_id=auth.uid())$$;
 insert into auth.users values('${owner}'),('${member}'),('${outsider}');insert into trips values('${trip}'),('${other}');insert into test_members values('${trip}','${owner}'),('${trip}','${member}'),('${other}','${outsider}');set "test.user"='${owner}';`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261022133316_cultural_place_guides.sql',import.meta.url),'utf8'));
 assert.equal((await db.query('select count(*) from trip_cultural_guides')).rows[0].count,0);
 await db.exec('set role authenticated');
 const insert=()=>db.query('insert into trip_cultural_guides(id,trip_id,place_key,place,document) values($1,$2,$3,$4,$5) returning *',[guide,trip,guidePlaceKey(place),place,document]);
 const row=(await insert()).rows[0];assert.equal(row.created_by,owner);assert.equal(Number(row.revision),1);
 await assert.rejects(insert(),e=>e.code==='23505');
 for(const mutate of [d=>delete d.version,d=>d.sections.history.origin='verified',d=>d.sources[0].url=null,d=>d.sources[0].id=null,d=>d.sections.history.origin=null,d=>d.sections.history.evidence[0].quote='invented',d=>d.place_key='wrong',d=>d.sections.history.text='x'.repeat(4001),d=>{d.sections.history.origin='source';d.sections.history.text='invented'}]){
  const invalid=structuredClone(document);mutate(invalid);await assert.rejects(db.query('update trip_cultural_guides set document=$1 where id=$2',[invalid,guide]),e=>e.code==='23514');
 }
 for(const [field,value]of [['trip_id',other],['place_key','geoapify:other'],['created_by',member]])await assert.rejects(db.query(`update trip_cultural_guides set ${field}=$1 where id=$2`,[value,guide]),e=>e.code==='42501');
 await db.exec(`reset role;set "test.user"='${member}';set role authenticated`);
 const revised=structuredClone(document);revised.sections.history={text:'Member correction',origin:'user',evidence:[]};
 assert.equal((await db.query('update trip_cultural_guides set document=$1 where id=$2 and revision=1 returning id',[revised,guide])).rows.length,1);
 assert.equal((await db.query('update trip_cultural_guides set document=$1 where id=$2 and revision=1 returning id',[document,guide])).rows.length,0);
 assert.equal(Number((await db.query('select revision from trip_cultural_guides')).rows[0].revision),2);
 await db.exec(`reset role;set "test.user"='${outsider}';set role authenticated`);
 assert.equal((await db.query('select * from trip_cultural_guides')).rows.length,0);
 assert.equal((await db.query('update trip_cultural_guides set document=$1 returning id',[document])).rows.length,0);
 assert.equal((await db.query('delete from trip_cultural_guides returning id')).rows.length,0);
 await assert.rejects(insert());
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select * from trip_cultural_guides'));
 await db.exec(`reset role;set "test.user"='${owner}';set role authenticated`);
 assert.equal((await db.query('select * from trip_cultural_guides')).rows.length,1);
 await db.exec(`reset role;delete from auth.users where id='${member}';`);assert.equal((await db.query('select updated_by from trip_cultural_guides')).rows[0].updated_by,null);
 await db.exec(`delete from trips where id='${trip}'`);assert.equal((await db.query('select * from trip_cultural_guides')).rows.length,0);
 console.log('PASS cultural migration: no backfill; sources/schema; member/outsider/anon RLS; immutable trip/place identity; unique place; compare-and-swap; account and trip deletion.');
}finally{await db.close()}

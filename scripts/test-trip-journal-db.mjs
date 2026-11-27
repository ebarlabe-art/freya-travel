import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const author=id(1),participant=id(2),outsider=id(3),trip=id(4);
try{
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key); create table public.trips(id uuid primary key);
    create table public.test_members(trip_id uuid,user_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select current_setting('fixture.user',true)::uuid$$;
    create function public.is_trip_member(id uuid) returns boolean language sql stable security definer
      as $$select exists(select 1 from public.test_members where trip_id=id and user_id=auth.uid())$$;
    grant usage on schema auth to authenticated;
    insert into auth.users values ('${author}'),('${participant}'),('${outsider}');
    insert into public.trips values ('${trip}');
    insert into public.test_members values ('${trip}','${author}'),('${trip}','${participant}');
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261127130000_trip_journal_v1.sql',import.meta.url),'utf8'));
  const as=async user=>db.exec(`reset role;set "fixture.user"='${user}';set role authenticated;`);
  const save=(entry,operation,base,body,{audio=null,deleted=false,actor=author}={})=>db.query(
    'select save_trip_journal_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as accepted',
    [entry,trip,actor,operation,base,'2026-11-27','2026-11-27T12:00:00Z',body,audio,audio?'audio/mp4':null,audio?1200:null,deleted]);
  await as(author);
  const text=id(5),voice=id(6);
  assert.equal((await save(text,id(7),null,'Record privat')).rows[0].accepted,id(7));
  assert.equal((await save(text,id(7),null,'Record privat')).rows[0].accepted,id(7),'retry after lost acknowledgement');
  await save(voice,id(8),null,'',{audio:'YXVkaW8='});
  await assert.rejects(save(voice,id(9),id(7),'',{deleted:true}),error=>error.code==='40001');
  await assert.rejects(db.query("update trip_journal_entries set audio_base64='YQ==' where id=$1",[voice]),error=>error.code==='42501');
  assert.equal((await db.query('select count(*)::int as count from trip_journal_entries')).rows[0].count,2);
  await as(participant);
  assert.deepEqual((await db.query('select id,body,audio_base64 from trip_journal_entries')).rows,[]);
  assert.deepEqual((await db.query("update trip_journal_entries set body='Atac' where id=$1 returning id",[text])).rows,[]);
  await assert.rejects(save(text,id(13),null,'No access',{actor:participant}));
  await assert.rejects(save(voice,id(21),id(8),'',{actor:participant,deleted:true}),error=>error.code==='40001');
  await assert.rejects(save(id(19),id(20),null,'Crossed auth token',{actor:author}),error=>error.code==='42501');
  await assert.rejects(db.query("insert into trip_journal_entries(id,trip_id,author_id,local_day,captured_at,body,visibility,operation_id) values($1,$2,$3,current_date,now(),'unsafe','shared',$4)",[id(14),trip,participant,id(15)]));
  await as(outsider);
  await assert.rejects(save(id(11),id(12),null,'No membership',{actor:outsider}),error=>error.code==='42501');
  await db.exec('reset role;set role anon');
  await assert.rejects(db.query('select * from trip_journal_entries'));
  await as(author);
  const deletion=id(22);
  assert.equal((await save(voice,deletion,id(8),'',{deleted:true})).rows[0].accepted,deletion);
  assert.equal((await save(voice,deletion,id(8),'',{deleted:true})).rows[0].accepted,deletion);
  assert.deepEqual((await db.query('select deleted,body,audio_base64,audio_mime,duration_ms from trip_journal_entries where id=$1',[voice])).rows,
    [{deleted:true,body:'',audio_base64:null,audio_mime:null,duration_ms:null}]);
  await assert.rejects(save(voice,id(8),null,'',{audio:'YXVkaW8='}),error=>error.code==='40001');
  await assert.rejects(db.query("update trip_journal_entries set deleted=false, body='Resurrected' where id=$1",[voice]),error=>error.code==='40001');
  const offlineVoice=id(23);
  await save(offlineVoice,id(24),id(25),'',{deleted:true});
  await assert.rejects(save(offlineVoice,id(25),null,'',{audio:'YXVkaW8='}),error=>error.code==='40001');
  assert.deepEqual((await db.query('select audio_base64 from trip_journal_entries where id=$1 and not deleted',[offlineVoice])).rows,[]);
  await save(text,id(16),id(7),'Editat');
  await assert.rejects(save(text,id(17),id(7),'Edició antiga'),error=>error.code==='40001');
  await save(text,id(18),id(16),'',{deleted:true});
  assert.equal((await save(text,id(18),id(16),'',{deleted:true})).rows[0].accepted,id(18));
  assert.deepEqual((await db.query('select deleted,body from trip_journal_entries where id=$1',[text])).rows,[{deleted:true,body:''}]);
  await db.exec(`reset role;delete from public.test_members where user_id='${author}'`);
  await as(author);
  assert.deepEqual((await db.query('select * from trip_journal_entries')).rows,[]);
  console.log('PASS C2.1 database: author RLS, replay, conflicts, atomic audio deletion and tombstones that prevent delayed writes.');
}finally{await db.close()}

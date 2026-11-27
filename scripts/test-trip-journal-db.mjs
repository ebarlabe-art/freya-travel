import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db=new PGlite();
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const author=id(1),participant=id(2),outsider=id(3),trip=id(4);
try{
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key); create table public.trips(id uuid primary key,discarded_at timestamptz);
    create table public.trip_members(trip_id uuid,user_id uuid);
    create function auth.uid() returns uuid language sql stable as $$select current_setting('fixture.user',true)::uuid$$;
    create function public.is_trip_member(id uuid) returns boolean language sql stable security definer
      as $$select exists(select 1 from public.trip_members where trip_id=id and user_id=auth.uid())$$;
    grant usage on schema auth to authenticated;
    grant select on public.trip_members,public.trips to service_role;
    insert into auth.users values ('${author}'),('${participant}'),('${outsider}');
    insert into public.trips values ('${trip}');
    insert into public.trip_members values ('${trip}','${author}'),('${trip}','${participant}');
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261127130000_trip_journal_v1.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261127165955_trip_journal_transcription_v1.sql',import.meta.url),'utf8'));
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
  // C2.2 extends the same record and still uses author-only reads and v1 deletion.
  const one=id(30),two=id(31),oneOp=id(32),twoOp=id(33);
  await save(one,oneOp,null,'',{audio:'YXVkaW8='});
  await save(two,twoOp,null,'Comentari opcional',{audio:'YXVkaW8='});
  await assert.rejects(db.query("update trip_journal_entries set transcript_original='fake' where id=$1",[one]),error=>error.code==='42501');
  await assert.rejects(db.query("insert into trip_journal_entries (id,transcript_original) values($1,'fake')",[id(99)]),error=>error.code==='42501');
  await assert.rejects(db.query('select count(*) from trip_journal_transcription_jobs'),error=>error.code==='42501');
  const claim=async (entry,request,epoch=null,actor=author)=>(await db.query(
    'select claim_trip_journal_transcription_v1($1,$2,$3,$4,$5,now()) as result',[actor,trip,entry,request,epoch])).rows[0].result;
  const finish=async (entry,request,text,language='ca')=>(await db.query(
    'select finish_trip_journal_transcription_v1($1,$2,$3,$4,$5,$6) as result',[author,trip,entry,request,text,language])).rows[0].result;
  const mutate=async (entry,operation,base,action,text=null,actor=author)=>(await db.query(
    'select mutate_trip_journal_transcript_v1($1,$2,$3,$4,$5,$6,$7) as result',[actor,trip,entry,operation,base,action,text])).rows[0].result;
  const service=()=>db.exec('reset role;set role service_role');
  const state=async entry=>(await db.query('select audio_base64,body,transcript_original,transcript_edit,transcript_language from trip_journal_entries where id=$1',[entry])).rows[0];
  await assert.rejects(claim(one,id(34)),error=>error.code==='42501');
  await service();
  assert.equal((await claim(one,id(34),null,participant)).status,'gone');
  assert.equal((await claim(one,id(34),null,outsider)).status,'gone');
  assert.deepEqual(await claim(one,id(34)),{status:'claimed',audio:'YXVkaW8=',mime:'audio/mp4',duration:1200});
  assert.deepEqual(await claim(one,id(34)),{status:'running'});
  assert.deepEqual(await claim(two,id(35)),{status:'busy'});
  assert.equal(await finish(one,id(34),'Primera transcripció'),'done');
  assert.deepEqual(await claim(one,id(34)),{status:'done'});
  assert.equal(await mutate(one,id(36),oneOp,'edit','Correcció privada'),id(36));
  assert.equal(await mutate(one,id(36),oneOp,'edit','Correcció privada'),id(36));
  assert.equal((await claim(one,id(37))).status,'claimed');
  assert.equal(await finish(one,id(37),null),'failed');
  assert.equal((await claim(one,id(37))).status,'failed');
  assert.equal((await claim(one,id(38))).status,'claimed');
  assert.equal(await finish(one,id(38),'Segona transcripció'),'done');
  assert.deepEqual(await state(one),{audio_base64:'YXVkaW8=',body:'',transcript_original:'Segona transcripció',
    transcript_edit:'Correcció privada',transcript_language:'ca'});
  await assert.rejects(mutate(one,id(39),id(36),'remove_audio',null,participant),error=>error.code==='40001');
  assert.equal((await claim(one,id(39))).status,'claimed');
  assert.equal(await mutate(one,id(40),id(36),'remove_audio'),id(40));
  assert.equal(await finish(one,id(39),'Resposta tardana'),'gone');
  assert.equal((await state(one)).audio_base64,null);
  assert.equal((await state(one)).transcript_edit,'Correcció privada');
  await assert.rejects(mutate(one,id(41),id(40),'remove_transcript'),error=>error.code==='22023');
  assert.equal((await claim(two,id(42))).status,'claimed');
  assert.equal(await finish(two,id(42),'Transcripció per eliminar'),'done');
  assert.equal((await claim(two,id(43))).status,'claimed');
  assert.equal(await mutate(two,id(44),twoOp,'remove_transcript'),id(44));
  assert.equal(await finish(two,id(43),'Resposta tardana'),'gone');
  assert.deepEqual(await state(two),{audio_base64:'YXVkaW8=',body:'Comentari opcional',
    transcript_original:null,transcript_edit:null,transcript_language:null});
  assert.equal((await claim(two,id(45))).status,'gone','cancelled epoch cannot be replayed');
  assert.equal((await claim(two,id(45),id(44))).status,'claimed');
  await as(participant);
  assert.equal(await state(one),undefined);
  await as(author);
  await save(two,id(46),id(44),'',{deleted:true});
  await service();
  assert.equal(await finish(two,id(45),'Resposta després del tombstone'),'gone');
  assert.deepEqual(await state(two),{audio_base64:null,body:'',transcript_original:null,transcript_edit:null,transcript_language:null});
  await as(author);
  await save(one,id(47),id(40),'',{deleted:true});
  assert.equal((await state(one)).transcript_original,null);
  await db.exec(`reset role;delete from public.trip_members where user_id='${author}'`);
  await as(author);
  assert.deepEqual((await db.query('select * from trip_journal_entries')).rows,[]);
  console.log('PASS C2.1/C2.2 database: author RLS, provider claims and retries, preserved corrections, selective deletion and late responses.');
}finally{await db.close()}

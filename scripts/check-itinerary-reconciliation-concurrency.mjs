// Two independent PostgreSQL connections; synthetic fixture exported by DB contract test.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {spawn} from 'node:child_process';
const container=process.env.RIG_PG_CONTAINER;if(!container||!process.env.RIG_SQL_FIXTURE)throw Error('RIG_PG_CONTAINER and RIG_SQL_FIXTURE required');
const databaseName='rig03b_'+Date.now();
const run=(sql,database=databaseName)=>new Promise(resolve=>{const p=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1']);let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('close',code=>resolve({code,out,err}));p.stdin.end(sql)});
const ok=async sql=>{const r=await run(sql);assert.equal(r.code,0,r.err);return r.out.trim()};
assert.equal((await run('create database '+databaseName+';','postgres')).code,0);
await ok(await readFile(process.env.RIG_SQL_FIXTURE,'utf8'));
const id=n=>'13000000-0000-4000-8000-'+String(n).padStart(12,'0'),trip=id(1),doc=id(6);
const auth=user=>`set "test.user"='${id(user)}';set role authenticated;`;
const snapshot=await ok(auth(3)+`select public.read_itinerary_reconciliation('${trip}');`);
const expected=JSON.stringify(JSON.parse(snapshot).map(r=>({id:r.id,updated_at:r.updated_at})));
const call=(op,target)=>`select public.commit_itinerary_reconciliation('${trip}','${id(op)}','${doc}','${expected}'::jsonb,'[{"action":"retire","id":"${id(target)}"}]'::jsonb);`;
// A holds the parent lock; B must wait, then reject its obsolete whole-set version.
const a=run("set application_name='rig_winner';"+auth(3)+'begin;'+call(101,20)+'select pg_sleep(1);commit;');
for(let n=0;n<100;n++){if(await ok("select count(*) from pg_stat_activity where application_name='rig_winner' and wait_event='PgSleep';")==='1')break;if(n===99)throw Error('winner did not reach transaction barrier');await new Promise(r=>setTimeout(r,20))}const b=run(auth(4)+call(102,21));
const [ra,rb]=await Promise.all([a,b]);assert.equal(ra.code,0,ra.err);assert.notEqual(rb.code,0);assert.match(rb.err,/RIG_STALE/);
assert.equal(await ok("select count(*) from itinerary_private.reconciliations;"),'1');
assert.equal(await ok(`select count(*) from trip_itinerary_items where status='cancelled';`),'1');
assert.equal(await ok(`select count(*) from trip_reminders where source_kind='itinerary_item' and not enabled;`),'1');
// Exercise an administrator-only recovery transaction from the recorded snapshot.
// No public rollback privilege; refuse if a newer receipt exists in a real recovery.
await ok(`begin;set "test.user"='${id(3)}';
update trip_itinerary_items i set status=x.status from itinerary_private.reconciliations a cross join lateral jsonb_populate_recordset(null::trip_itinerary_items,a.before_items) x where a.operation_id='${id(101)}' and i.id=x.id;
update trip_reminders m set enabled=x.enabled,event_at=x.event_at,scheduled_for=x.scheduled_for,source_updated_at=x.source_updated_at from itinerary_private.reconciliations a cross join lateral jsonb_populate_recordset(null::trip_reminders,a.before_reminders) x where a.operation_id='${id(101)}' and m.id=x.id;commit;`);
assert.equal(await ok("select count(*) from trip_itinerary_items where status='cancelled';"),'0');
assert.equal(await ok("select count(*) from trip_reminders where source_kind='itinerary_item' and enabled;"),'12');
console.log('PASS real PostgreSQL: simultaneous members, exactly one commit, stale loser and scoped snapshot recovery.');

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildTripParticipantRoster,fetchTripParticipants,saveOwnParticipantName} from '../domain/trip-participants.mjs';

test('A3: owner is first; only existing member nicknames are displayed',()=>{
  const members=[{user_id:'visitor',created_at:'2026-11-24'}, {user_id:'owner',created_at:'2026-11-23'}];
  const rows=buildTripParticipantRoster(members,[{user_id:'visitor',display_name:'  Laia '},{user_id:'outsider',display_name:'Do not reveal'}],'owner','visitor');
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(x=>[x.userId,x.name,x.isOwner,x.isYou]),[
    ['owner','Organitzador/a',true,false],['visitor','Laia',false,true]
  ]);
  assert.equal(rows[1].customName,'Laia');
  assert.doesNotMatch(JSON.stringify(rows),/outsider|Do not reveal/);
});
test('A3: verifies current membership and never trusts stale trip/other account',async()=>{
  const db={from(table){
    const result=table==='trip_members'
      ?[{user_id:'owner'},{user_id:'guest'}]:[{user_id:'guest',display_name:'Xesc'}];
    return {select:()=>({eq:()=>({order:async()=>({data:result,error:null}),then:resolve=>resolve({data:result,error:null})})})};
  }};
  const rows=await fetchTripParticipants({db,tripId:'trip',viewerId:'guest',ownerId:'owner'});
  assert.equal(rows[1].name,'Xesc');
  await assert.rejects(fetchTripParticipants({db,tripId:'trip',viewerId:'intruder',ownerId:'owner'}),/no tens accés/);
});
test('A3: nickname validates length and confirms remote write',async()=>{
  let record;
  const db={from(table){
    assert.equal(table,'trip_expense_member_labels');
    return {upsert(value,opts){
      record=value;assert.equal(opts.onConflict,'trip_id,user_id');
      return {select:()=>({maybeSingle:async()=>({data:{display_name:value.display_name},error:null})})};
    }};
  }};
  assert.equal(await saveOwnParticipantName({db,tripId:'trip',viewerId:'guest',name:'  Eva '}),'Eva');
  assert.deepEqual(record,{trip_id:'trip',user_id:'guest',display_name:'Eva'});
  await assert.rejects(saveOwnParticipantName({db,tripId:'trip',viewerId:'guest',name:'  '}),/1 i 60/);
  await assert.rejects(saveOwnParticipantName({db,tripId:'trip',viewerId:'guest',name:'A'.repeat(61)}),/1 i 60/);
});
test('A3 wiring: original travelers card; single source of membership; no revoke button',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  const pack=readFileSync(new URL('./package-pages.mjs',import.meta.url),'utf8');
  assert.match(html,/id="genericParticipantsRoster"/);
  assert.match(html,/id="genericParticipantNameForm"/);
  assert.match(html,/loadTravelBookModule\('trip-participants\.mjs'\)/);
  assert.match(html,/void refreshTripParticipants\(\)/);
  assert.match(pack,/'trip-participants\.mjs'/);
  assert.match(worker,/'\.\/domain\/trip-participants\.mjs'/);
  assert.doesNotMatch(html,/id="removeGenericParticipant"/);
});

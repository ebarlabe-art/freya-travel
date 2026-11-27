import test from 'node:test';
import assert from 'node:assert/strict';
import {journalDay,journalAudioFormat,journalOperation} from '../domain/trip-journal.mjs';
test('uses the local trip day at midnight and daylight changes',()=>{
  assert.equal(journalDay(new Date('2026-11-26T23:01:00Z'),'Europe/Brussels'),'2026-11-27');
  assert.equal(journalDay(new Date('2026-07-01T02:00:00Z'),'America/Los_Angeles'),'2026-06-30');
  assert.equal(journalDay(new Date('2026-07-01T02:00:00Z'),'Invalid/Zone'),'2026-07-01');
});
test('prefers native MP4 where supported and falls back to supported voice formats',()=>{
  const Recorder={isTypeSupported:type=>['audio/mp4','audio/webm;codecs=opus'].includes(type)};
  assert.equal(journalAudioFormat(Recorder),'audio/mp4');
  assert.equal(journalAudioFormat({isTypeSupported:type=>type==='audio/webm;codecs=opus'}),'audio/webm;codecs=opus');
  assert.equal(journalAudioFormat(undefined),'');
});
test('keeps stable entry identity and ordered revision dependencies across offline edits',()=>{
  const initial=journalOperation({id:'entry-1'},{body:'first',deleted:false},'op-1');
  const edited=journalOperation(initial,{body:'edited',deleted:false},'op-2');
  const deleted=journalOperation(edited,{body:'',deleted:true},'op-3');
  assert.equal(deleted.id,'entry-1');
  assert.deepEqual(deleted.pending.map(({id,base,deleted})=>({id,base,deleted})),[
    {id:'op-1',base:null,deleted:false},{id:'op-2',base:'op-1',deleted:false},{id:'op-3',base:'op-2',deleted:true}
  ]);
  assert.equal(initial.pending.length,1);
});

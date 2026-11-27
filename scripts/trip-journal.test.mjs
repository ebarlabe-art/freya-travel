import test from 'node:test';
import assert from 'node:assert/strict';
import {journalDay,journalAudioFormat,journalOperation} from '../domain/trip-journal.mjs';
test('uses the local trip day at midnight and daylight changes',()=>{
  assert.equal(journalDay(new Date('2026-11-26T23:01:00Z'),'Europe/Brussels'),'2026-11-27');
  assert.equal(journalDay(new Date('2026-07-01T02:00:00Z'),'America/Los_Angeles'),'2026-06-30');
  assert.equal(journalDay(new Date('2026-07-01T02:00:00Z'),'Invalid/Zone'),'2026-07-01');
});
test('voice deletion replaces an unacknowledged creation without retaining its audio fields',()=>{
  const voice=journalOperation({id:'voice',audio_mime:'audio/mp4',duration_ms:1000},{body:'Caption',deleted:false},'create-voice');
  const deletion=journalOperation(voice,{body:'',deleted:true},'delete-voice');
  assert.equal(deletion.id,'voice');
  assert.equal(deletion.audio_mime,null);
  assert.equal(deletion.duration_ms,null);
  assert.deepEqual(deletion.pending,[{id:'delete-voice',base:'create-voice',body:'',deleted:true}]);
  assert.equal(voice.audio_mime,'audio/mp4');
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

test('whole deletion drops local transcript content and preserves pending selective mutations',()=>{
  const entry={id:'voice',audio_mime:null,body:'',operation_id:'remove-audio',
    transcript_original:'Original',transcript_edit:'Edited',transcript_epoch:'remove-audio',
    pending:[{id:'remove-audio',base:'voice-create',action:'remove_audio'}]};
  const deleted=journalOperation(entry,{body:'',deleted:true},'delete');
  assert.equal(deleted.transcript_original,null);
  assert.equal(deleted.transcript_edit,null);
  assert.equal(deleted.transcript_job,null);
  assert.deepEqual(deleted.pending,[entry.pending[0],{id:'delete',base:'remove-audio',body:'',deleted:true}]);
});

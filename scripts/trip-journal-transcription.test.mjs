import test from 'node:test';
import assert from 'node:assert/strict';
import {createJournalTranscriptionHandler,transcribeRecording} from '../supabase/functions/trip-journal-transcribe/handler.mjs';

const id=n=>'20000000-0000-4000-8000-'+String(n).padStart(12,'0');
const recording={audio:'YXVkaW8=',mime:'audio/mp4',duration:1200};
const input={entry:id(1),trip:id(2),id:id(3),action:'transcribe',epoch:null,language:null,requestedAt:'2026-11-27T12:00:00Z'};
const request=(overrides={},auth='Bearer fixture')=>new Request('https://fixture.invalid',{
  method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({...input,...overrides})
});

test('provider receives original bytes and optional language, independent of UI or trip; never translation',async()=>{
  for(const mime of ['audio/mp4','audio/webm','audio/ogg']){
    const result=await transcribeRecording({...recording,mime},mime==='audio/mp4'?'ca':null,'fixture-key',async (url,options)=>{
      assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');
      assert.equal(options.headers.Authorization,'Bearer fixture-key');
      assert.equal(options.body.get('model'),'gpt-transcribe');
      assert.equal(options.body.get('file').type,mime);
      assert.equal(await options.body.get('file').text(),'audio');
      assert.deepEqual([...options.body.keys()],['file','model','response_format',...(mime==='audio/mp4'?['languages[]']:[])]);
      assert.equal(options.body.get('languages[]'),mime==='audio/mp4'?'ca':null);
      return Response.json({text:'  Passegem per l’Alguer.  ',languages:[{code:'ca'}]});
    });
    assert.deepEqual(result,{text:'Passegem per l’Alguer.',language:'ca'});
  }
  const noLanguage=await transcribeRecording(recording,null,'fixture-key',async()=>Response.json({text:'Hola',languages:[]}));
  assert.equal(noLanguage.language,null);
  await assert.rejects(transcribeRecording({...recording,mime:'audio/mpeg'},null,'fixture-key',()=>assert.fail()));
  await assert.rejects(transcribeRecording(recording,null,'fixture-key',async()=>Response.json({text:''})));
});

test('auth and database claims gate provider costs; replay and errors return no private material',async()=>{
  const calls=[];
  let status='claimed',providerFailure=false;
  const handler=createJournalTranscriptionHandler({
    authorize:async auth=>auth==='Bearer fixture'?id(4):null,
    rpc:async(name,args)=>{
      calls.push([name,args]);
      if(name.startsWith('claim'))return {...recording,status};
      if(name.startsWith('finish'))return args.p_text?'done':'failed';
      return args.p_operation;
    },
    transcribe:async (_audio,language)=>{
      assert.equal(language,null);
      if(providerFailure)throw Error('Synthetic provider response with private content');
      return {text:'Record de prova',language:'ca'};
    }
  });
  assert.equal((await handler(request({},'untrusted'))).status,401);
  assert.equal((await handler(request({language:'invalid'}))).status,400);
  assert.equal(calls.length,0);
  for(const state of ['gone','running','busy','done','limit']){
    status=state;
    const response=await handler(request({actor:id(8),audio:'ignored'}));
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await response.json(),{status:state});
    assert.deepEqual(calls.at(-1)[1],{p_actor:id(4),p_trip:id(2),p_entry:id(1),p_request:id(3),p_epoch:null,
      p_requested_at:'2026-11-27T12:00:00.000Z'});
  }
  status='claimed';
  assert.deepEqual(await (await handler(request())).json(),{status:'done'});
  assert.equal(calls.at(-1)[1].p_text,'Record de prova');
  providerFailure=true;
  assert.deepEqual(await (await handler(request())).json(),{status:'failed'});
  assert.equal(calls.at(-1)[1].p_text,null);
  assert.deepEqual(await (await handler(request({action:'remove_audio',base:id(9)}))).json(),{id:id(3)});
  assert.equal(calls.at(-1)[1].p_text,null);
});

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
      p_requested_at:'2026-11-27T12:00:00.000Z',p_provider_available:true});
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

test('server-verified accounts gate new charges while replays and content mutations survive revocation',async()=>{
  const actor=id(4),other=id(8);
  const allowed=new Set([actor]),jobs=new Map(),claims=[];
  let charges=0;
  const authorize=async auth=>auth==='Bearer fixture'?actor:auth==='Bearer other'?other:null;
  const rpc=async(name,args)=>{
    if(name==='trip_journal_transcription_allowed_v1'){
      assert.deepEqual(Object.keys(args),['p_actor']);
      return allowed.has(args.p_actor);
    }
    if(name==='claim_trip_journal_transcription_v1'){
      claims.push(args);
      const key=args.p_actor+':'+args.p_request;
      if(jobs.has(key))return {status:jobs.get(key)};
      if(!allowed.has(args.p_actor))return {status:'restricted'};
      if(!args.p_provider_available)return {status:'unavailable'};
      jobs.set(key,'running');
      return {...recording,status:'claimed'};
    }
    if(name==='finish_trip_journal_transcription_v1'){
      assert.equal(args.p_text,'Text sintètic');
      jobs.set(args.p_actor+':'+args.p_request,'done');
      return 'done';
    }
    assert.equal(name,'mutate_trip_journal_transcript_v1');
    assert.equal(args.p_actor,actor);
    assert.ok(['edit','remove_audio','remove_transcript'].includes(args.p_action));
    return args.p_operation;
  };
  const handler=createJournalTranscriptionHandler({
    authorize,rpc,
    transcribe:async()=>{charges++;return {text:'Text sintètic',language:'ca'}}
  });
  const availability=(auth)=>handler(request({action:'availability',trip:undefined,entry:undefined,id:undefined},auth));
  assert.equal((await availability('untrusted')).status,401);
  assert.deepEqual(await (await availability()).json(),{available:true});
  const deniedAvailability=await availability('Bearer other');
  assert.equal(deniedAvailability.headers.get('cache-control'),'no-store');
  assert.deepEqual(await deniedAvailability.json(),{available:false});
  assert.equal(claims.length,0);

  assert.deepEqual(await (await handler(request({actor,p_provider_available:false,available:true},'Bearer other'))).json(),{status:'restricted'});
  assert.equal(claims.at(-1).p_actor,other);
  assert.equal(claims.at(-1).p_provider_available,true,'the client cannot set provider availability');
  assert.equal(claims.at(-1).available,undefined);
  assert.equal(charges,0);
  assert.deepEqual(await (await handler(request())).json(),{status:'done'});
  assert.deepEqual(await (await handler(request())).json(),{status:'done'});
  assert.equal(charges,1);

  allowed.clear();
  assert.deepEqual(await (await availability()).json(),{available:false});
  assert.deepEqual(await (await handler(request())).json(),{status:'done'});
  const queued={id:id(12)};
  assert.deepEqual(await (await handler(request(queued))).json(),{status:'restricted'});
  assert.deepEqual(await (await handler(request(queued))).json(),{status:'restricted'});
  for(const action of ['edit','remove_audio','remove_transcript']){
    assert.deepEqual(await (await handler(request({action,id:id(13),base:id(9),text:'Canvi'}))).json(),{id:id(13)});
  }
  const configuredWithoutProvider=createJournalTranscriptionHandler({authorize,rpc});
  assert.deepEqual(await (await configuredWithoutProvider(request())).json(),{status:'done'});
  assert.equal(claims.at(-1).p_provider_available,false);
  assert.deepEqual(await (await configuredWithoutProvider(request(queued))).json(),{status:'restricted'});
  allowed.add(actor);
  assert.deepEqual(await (await configuredWithoutProvider(request({action:'availability'}))).json(),{available:false});
  assert.deepEqual(await (await configuredWithoutProvider(request(queued))).json(),{status:'unavailable'});
  assert.equal(jobs.size,1);
  assert.equal(charges,1);
});

test('a missing provider cannot be invoked even when a claim unexpectedly succeeds',async()=>{
  const handler=createJournalTranscriptionHandler({
    authorize:async()=>id(4),
    rpc:async(name,args)=>{
      assert.equal(name,'claim_trip_journal_transcription_v1');
      assert.equal(args.p_provider_available,false);
      return {...recording,status:'claimed'};
    }
  });
  assert.deepEqual(await (await handler(request())).json(),{status:'unavailable'});
});

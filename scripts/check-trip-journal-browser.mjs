import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname,join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
const engine=process.env.JOURNAL_ENGINE||'chromium';
const engines=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const profile=await mkdtemp(join(tmpdir(),'freya-journal-'));
const dist=resolve('dist'),mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.webmanifest':'application/manifest+json'};
let down=false;
const server=createServer(async(req,res)=>{
  if(down){res.writeHead(503).end();return}
  const pathname=new URL(req.url,'http://fixture').pathname;
  const file=resolve(dist,decodeURIComponent(pathname.replace(/^\/freya-travel\//,''))||'index.html');
  if(!pathname.startsWith('/freya-travel/')||!file.startsWith(dist+sep)){res.writeHead(404).end();return}
  try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'}).end(bytes)}
  catch{res.writeHead(404).end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/freya-travel/';
const user='journal-fixture-owner';
const today=new Date().toISOString().slice(0,10);
const row={id:'journal-fixture-trip',name:'Viatge del diari',time_zone:'Europe/Brussels',start_date:today,
  end_date:new Date(Date.now()+2*86400000).toISOString().slice(0,10),is_owner:true};
// Short, valid AAC silence to exercise the recorder events when Linux WebKit
// lacks every supported audio-only encoding. No media from a real device.
const silenceMp4=[
  'AAAAHGZ0eXBNNEEgAAACAE00QSBpc29taXNvMgAAAAhmcmVlAAAALW1kYXTeAgBMYXZjNjEuMTkuMTAxAAIwQA4BGCAHARgg',
  'BwEYIAcBGCAHAAADDm1vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAA+gAAAD6AAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAA',
  'AAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAI5dHJhawAAAFx0a2hkAAAA',
  'AwAAAAAAAAAAAAAAAQAAAAAAAAD6AAAAAAAAAAAAAAABAQAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAA',
  'AAAAAAAAAAAAAAAAJGVkdHMAAAAcZWxzdAAAAAAAAAABAAAA+gAABAAAAQAAAAABsW1kaWEAAAAgbWRoZAAAAAAAAAAAAAAA',
  'AAAAPoAAABOgVcQAAAAAAC1oZGxyAAAAAAAAAABzb3VuAAAAAAAAAAAAAAAAU291bmRIYW5kbGVyAAAAAVxtaW5mAAAAEHNt',
  'aGQAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASBzdGJsAAAAanN0c2QAAAAAAAAAAQAA',
  'AFptcDRhAAAAAAAAAAEAAAAAAAAAAAABABAAAAAAPoAAAAAAADZlc2RzAAAAAAOAgIAlAAEABICAgBdAFQAAAAAAXcAAAAOu',
  'BYCAgAUUCFblAAaAgIABAgAAACBzdHRzAAAAAAAAAAIAAAAEAAAEAAAAAAEAAAOgAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAF',
  'AAAAAQAAAChzdHN6AAAAAAAAAAAAAAAFAAAAFQAAAAQAAAAEAAAABAAAAAQAAAAUc3RjbwAAAAAAAAABAAAALAAAABpzZ3Bk',
  'AQAAAHJvbGwAAAACAAAAAf//AAAAHHNiZ3AAAAAAcm9sbAAAAAEAAAAFAAAAAQAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhk',
  'bHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjEuNy4xMDM='
].join('');
let ctx;
async function launch(online){
  ctx=await engines[engine].launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},
    ...(engine==='chromium'&&process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  await ctx.route('https://otueskpksylzvkhldoft.supabase.co/**',route=>route.abort());
  await ctx.addInitScript(isOnline=>{
    window.journalOnline=isOnline;
    window.micAllowed=false;
    Object.defineProperty(navigator,'language',{get:()=> 'ca-ES'});
    Object.defineProperty(navigator,'onLine',{get:()=>window.journalOnline});
    window.installJournalFixture=(fixture)=>{
      const devices=navigator.mediaDevices||{};
      Object.defineProperty(navigator,'mediaDevices',{get:()=>devices});
      Object.defineProperty(devices,'getUserMedia',{value:async constraints=>{
        if(!window.micAllowed)throw new DOMException('Synthetic denied permission','NotAllowedError');
        if(!constraints.audio||constraints.video)throw Error('Unexpected media request');
        if(fixture){
          const track=new EventTarget();track.readyState='live';track.stop=()=>{track.readyState='ended'};
          window.journalFixtureTrack=track;
          return {getTracks:()=>[track]};
        }
        const Audio=window.AudioContext||window.webkitAudioContext,context=new Audio();
        const oscillator=context.createOscillator(),destination=context.createMediaStreamDestination();
        oscillator.connect(destination);oscillator.start();
        void context.resume();
        const track=destination.stream.getAudioTracks()[0],stop=track.stop.bind(track);
        track.stop=()=>{stop();void context.close().catch(()=>{})};
        window.journalFixtureTrack=track;
        return destination.stream;
      }});
      if(fixture)window.MediaRecorder=class {
        static isTypeSupported(format){return format==='audio/mp4'}
        mimeType='audio/mp4';
        state='inactive';
        start(){this.state='recording'}
        stop(){
          this.state='inactive';
          queueMicrotask(()=>{
            this.ondataavailable?.({data:new Blob([Uint8Array.from(atob(fixture),unit=>unit.charCodeAt(0))],{type:this.mimeType})});
            this.onstop?.();
          });
        }
      };
    };
  },online);
  return ctx.newPage();
}
const local=page=>page.locator('[data-journal-local]');
const sync=page=>page.locator('[data-journal-sync]');
const records=page=>page.locator('[data-journal-entries] article');
const editor=page=>page.locator('#journalText');
const dashboard=page=>page.locator('#genericTripToolsSection [data-open="journalView"]');
try{
  let page=await launch(true);
  await page.goto(url);
  await page.waitForFunction(()=>navigator.serviceWorker.controller&&authInitializationResolved);
  await page.locator('#loginCard').waitFor({state:'visible'});
  await page.evaluate(({user,row})=>{
    session={user:{id:user,email:'fixture@example.invalid'},access_token:'fixture-token'};
    trips=[row];trip=row;tripLoadGeneration++;
    if(!rememberOfflineTrips(trips,user)||readOfflineSessionGrant()?.userId!==user)throw Error('Missing local grant');
    window.journalOnline=false;
    hide('auth');show('tripView');updateTripPresentation();setAppView('genericDashboardView');
  },{user,row});
  await dashboard(page).click();
  await editor(page).fill('Record privat de prova');
  await local(page).getByText(/Esborrany desat/).waitFor();
  await page.getByRole('button',{name:'Desa el record'}).click();
  await records(page).getByText('Record privat de prova').waitFor();
  await records(page).getByText(/pendent de sincronitzar/).waitFor();
  const capabilities=await page.evaluate(async()=>{
    const {journalAudioFormat}=await import('./domain/trip-journal.mjs');
    return {format:journalAudioFormat(window.MediaRecorder),microphone:!!navigator.mediaDevices?.getUserMedia};
  });
  const native=!!(capabilities.format&&capabilities.microphone);
  console.log(engine+': recorder capabilities',JSON.stringify(capabilities));
  if(!native){
    assert.equal(engine,'webkit','Chromium must exercise the native audio recorder');
    await page.getByRole('button',{name:'Enregistra veu'}).click();
    await local(page).getByText(/Aquest navegador no pot enregistrar/).waitFor();
  }
  await page.evaluate(fixture=>window.installJournalFixture(fixture),native?null:silenceMp4);
  await page.getByRole('button',{name:'Enregistra veu'}).click();
  await local(page).getByText(/Cal permís/).waitFor();
  await page.evaluate(()=>{window.micAllowed=true});
  await page.getByRole('button',{name:'Enregistra veu'}).click();
  await page.getByRole('button',{name:'Atura'}).waitFor();
  await page.locator('[data-journal-duration]').getByText(/0:01/).waitFor();
  await page.evaluate(()=>window.journalFixtureTrack.dispatchEvent(new Event('ended')));
  await local(page).getByText(/Enregistrament interromput/).waitFor();
  assert.equal(await page.evaluate(()=>window.journalFixtureTrack.readyState),'ended');
  const bytesBefore=await page.locator('[data-journal-preview]').evaluate(async player=>{
    if(!player.src.startsWith('blob:'))throw Error('Expected a local audio preview');
    return (await (await fetch(player.src)).arrayBuffer()).byteLength;
  });
  assert.ok(bytesBefore>0);
  const localRows=await page.evaluate(async()=>{
    const owner=session.user.id,db=await offlineDocDatabase(),key=await offlineDocKey(db,owner);
    await clearOfflineDocumentUserData(owner);
    if(!await offlineDocKey(db,owner))throw Error('Document cleanup removed the journal key');
    const rows=(await offlineDocUserRows(db,owner)).filter(row=>row.documentId.startsWith(JOURNAL_VAULT_PREFIX));
    return {length:rows.length,nonExportable:!key.extractable,plain:rows.some(row=>JSON.stringify(row).includes('Record privat de prova'))};
  });
  assert.deepEqual(localRows,{length:3,nonExportable:true,plain:false});
  await page.waitForFunction(async()=>!!await caches.match(new URL('index.html',location.href)));
  await ctx.close();

  down=true;
  page=await launch(false);
  await page.goto(url);
  await page.waitForFunction(owner=>offlineReadOnlySession&&!coldStartNavigationPending&&session?.user?.id===owner,user);
  await page.evaluate(id=>{
    trip=trips.find(item=>item.id===id);tripLoadGeneration++;updateTripPresentation();setAppView('genericDashboardView');
  },row.id);
  await dashboard(page).click();
  await local(page).getByText(/fragment recuperat/).waitFor();
  await page.waitForFunction(()=>!!document.querySelector('[data-journal-preview]')?.src);
  const preview=page.locator('[data-journal-preview]');
  assert.equal(await preview.evaluate(async player=>(await (await fetch(player.src)).arrayBuffer()).byteLength),bytesBefore);
  await page.getByRole('button',{name:'Desa el record'}).click();
  await records(page).getByRole('button',{name:'Escolta'}).waitFor();
  await records(page).getByRole('button',{name:'Escolta'}).click();
  await page.locator('[data-journal-playback] audio').waitFor();
  assert.equal(await page.locator('[data-journal-playback] audio').evaluate(async player=>(await (await fetch(player.src)).arrayBuffer()).byteLength),bytesBefore);

  await page.evaluate(()=>{
    const rows=new Map();window.journalFixtureRows=rows;
    const writes=[];window.journalFixtureWrites=writes;
    let loseAcknowledgement=true;
    db.rpc=(name,args)=>({abortSignal:async()=>{
      if(name!=='save_trip_journal_v1'||args.p_author!==session.user.id)throw Error('Unexpected RPC scope');
      writes.push(args);
      const prior=rows.get(args.p_id);
      if(prior?.deleted&&args.p_deleted)return {data:args.p_operation};
      if(prior?.operation_id!==args.p_operation){
        if((prior||!args.p_deleted)&&(prior?.operation_id??null)!==args.p_base)return {error:{code:'40001'}};
        rows.set(args.p_id,{id:args.p_id,local_day:args.p_day,captured_at:args.p_captured_at,body:args.p_body,
          audio_mime:args.p_mime,duration_ms:args.p_duration,operation_id:args.p_operation,deleted:args.p_deleted,
          audio_base64:args.p_audio});
      }
      if(loseAcknowledgement){loseAcknowledgement=false;return {error:new Error('Lost acknowledgement')}}
      return {data:args.p_operation};
    }});
    db.from=()=>({select:fields=>{
      const project=row=>Object.fromEntries(fields.split(',').map(field=>[field,row[field]]));
      const query={eq:()=>query,order:()=>query,range:async()=>({data:[...rows.values()].map(project)})};
      return query;
    }});
    window.journalOnline=true;offlineReadOnlySession=false;session={...session,access_token:'fixture-token'};
  });
  await page.evaluate(()=>tripJournalController.reconnect());
  await sync(page).getByText(/No s’ha pogut sincronitzar/).waitFor();
  await page.getByRole('button',{name:'Reintenta'}).click();
  await records(page).filter({hasText:'Record privat de prova'}).getByText('Sincronitzat').waitFor();
  assert.equal(await page.evaluate(()=>window.journalFixtureRows.size),2,'Replay must retain two unique memories');
  await records(page).filter({hasText:'Record privat de prova'}).getByRole('button',{name:'Edita el text'}).click();
  await editor(page).fill('Record privat editat');
  await page.getByRole('button',{name:'Desa el record'}).click();
  const edited=records(page).filter({hasText:'Record privat editat'});
  await edited.getByText('Sincronitzat').waitFor();
  page.once('dialog',dialog=>dialog.accept());
  await edited.getByRole('button',{name:'Elimina el record'}).click();
  await edited.waitFor({state:'detached'});
  await page.waitForFunction(()=>[...window.journalFixtureRows.values()].some(entry=>entry.deleted));
  assert.equal(await page.evaluate(()=>[...window.journalFixtureRows.values()].filter(entry=>entry.audio_base64).length),1);
  await page.getByRole('button',{name:'Torna al viatge'}).click();
  await page.evaluate(()=>{document.getElementById('genericPastRecordsSection').classList.remove('hidden')});
  await page.locator('#genericPastRecordsSection [data-open="journalView"]').click();
  await records(page).getByRole('button',{name:'Escolta'}).waitFor();
  const voiceId=await page.evaluate(()=>[...window.journalFixtureRows.values()].find(entry=>entry.audio_base64).id);
  // Exercise the same PWA controller with a synthetic, gated provider and the
  // production field names. The server fixture contains no real user audio.
  await page.evaluate(()=>{
    const rows=window.journalFixtureRows;
    const realFetch=window.fetch;
    const accepted=new Map();
    window.journalTranscribeRequests=[];
    window.journalProviderRequests=[];
    window.journalHoldProvider=true;
    window.journalTranscriptionAllowed=true;
    db.from=()=>({select:fields=>{
      const project=row=>row?Object.fromEntries(fields.split(',').map(field=>[field,row[field]])):null;
      let selected=null;
      const query={
        eq:(field,value)=>{if(field==='id')selected=value;return query},
        order:()=>query,range:async()=>({data:[...rows.values()].map(project)}),
        maybeSingle:async()=>{
          const data=project(rows.get(selected));
          if(window.journalHoldTranscriptRead&&fields.includes('transcript_original')){
            await new Promise(resolve=>{window.releaseJournalTranscriptRead=resolve});
          }
          return {data};
        }
      };
      return query;
    }});
    window.fetch=async (url,options)=>{
      if(!String(url).endsWith('/functions/v1/trip-journal-transcribe'))return realFetch(url,options);
      const request=JSON.parse(options.body),entry=rows.get(request.entry);
      const {id,action,epoch}=request;
      if(action==='availability')return Response.json({available:window.journalTranscriptionAllowed});
      if(action==='transcribe'){
        window.journalTranscribeRequests.push(id);
        if(!entry||entry.deleted||!entry.audio_base64||(entry.transcript_epoch??null)!==epoch)return Response.json({status:'gone'});
        if(accepted.has(id))return Response.json({status:accepted.get(id)});
        if(!window.journalTranscriptionAllowed)return Response.json({status:'restricted'});
        window.journalProviderRequests.push(request);
        if(window.journalHoldProvider)await new Promise(resolve=>{window.releaseJournalTranscription=resolve});
        if(window.journalProviderRequests.length===1){accepted.set(id,'failed');return Response.json({status:'failed'})}
        const current=rows.get(request.entry);
        if(current.deleted||!current.audio_base64||(current.transcript_epoch??null)!==epoch)return Response.json({status:'gone'});
        Object.assign(current,{transcript_request_id:id,transcript_language:request.language||'ca',
          transcript_original:window.journalProviderRequests.length===2?'Vam passejar per l’Alguer.':'Vam visitar l’Alguer.'});
        accepted.set(id,'done');
        if(window.journalProviderRequests.length===2)throw Error('Lost transcription acknowledgement');
        return Response.json({status:'done'});
      }
      if(entry.operation_id===id)return Response.json({id});
      if(entry.operation_id!==request.base)return Response.json({error:'conflict'},{status:409});
      if(action==='edit')entry.transcript_edit=request.text;
      if(action==='remove_audio')Object.assign(entry,{audio_base64:null,audio_mime:null,duration_ms:null,transcript_epoch:id});
      if(action==='remove_transcript')Object.assign(entry,{transcript_original:null,transcript_edit:null,transcript_language:null,
        transcript_request_id:null,transcript_epoch:id});
      entry.operation_id=id;
      return Response.json({id});
    };
    window.journalOnline=false;
  });
  const voice=records(page);
  const transcript=voice.locator('[data-journal-transcript]');
  const transcribeAction=voice.getByRole('button',{name:'Transcriu',exact:true});
  await transcribeAction.click();
  const consent=voice.locator('[data-journal-consent]');
  await consent.getByText(/L’àudio s’enviarà a OpenAI/).waitFor();
  await consent.getByRole('button',{name:'Cancel·la'}).click();
  assert.equal(await page.evaluate(()=>window.journalTranscribeRequests.length),0);
  await transcribeAction.click();
  await consent.getByRole('button',{name:'Autoritza i deixa pendent'}).click();
  await voice.getByText('Transcripció pendent d’enviament.').waitFor();
  await page.getByRole('button',{name:'Torna al viatge'}).click();
  await page.locator('#genericPastRecordsSection [data-open="journalView"]').click();
  await voice.getByText('Transcripció pendent d’enviament.').waitFor();
  assert.equal(await page.evaluate(()=>window.journalTranscribeRequests.length),0);
  await page.evaluate(()=>{window.journalOnline=true;void tripJournalController.reconnect()});
  await voice.getByText('Transcripció en curs…').waitFor();
  await page.waitForFunction(()=>typeof window.releaseJournalTranscription==='function');
  await page.evaluate(()=>{window.journalHoldProvider=false;window.releaseJournalTranscription()});
  await voice.getByText(/No s’ha pogut transcriure/).waitFor();
  await voice.getByRole('button',{name:'Escolta'}).waitFor();
  await transcribeAction.click();
  await consent.getByRole('combobox',{name:'Idioma parlat'}).selectOption('ca');
  await consent.getByRole('button',{name:'Confirma i transcriu'}).click();
  const checkRequest=voice.getByRole('button',{name:'Comprova la petició'});
  await checkRequest.waitFor();
  await page.evaluate(()=>{window.journalTranscriptionAllowed=false});
  await checkRequest.click();
  const transcriptField=transcript.getByRole('textbox',{name:'Transcripció'});
  await transcriptField.waitFor();
  assert.equal(await transcriptField.inputValue(),'Vam passejar per l’Alguer.');
  const providerStats=await page.evaluate(()=>({requests:window.journalTranscribeRequests,provider:window.journalProviderRequests}));
  assert.equal(providerStats.provider.length,2);
  assert.equal(providerStats.provider[0].language,null);
  assert.equal(providerStats.provider[1].language,'ca');
  assert.equal(providerStats.requests[1],providerStats.requests[2],'The same completed claim remains recoverable after access is revoked');
  await page.evaluate(()=>{window.journalOnline=false;window.journalTranscriptionAllowed=true});
  await transcriptField.fill('Vam passejar pel centre de l’Alguer.');
  await transcript.getByRole('button',{name:'Desa el text'}).click();
  await transcript.getByText('Vam passejar pel centre de l’Alguer.').waitFor();
  await voice.getByText(/pendent de sincronitzar/).waitFor();
  await page.getByRole('button',{name:'Torna al viatge'}).click();
  await page.locator('#genericPastRecordsSection [data-open="journalView"]').click();
  await transcript.getByText('Vam passejar pel centre de l’Alguer.').waitFor();
  await page.evaluate(async()=>{window.journalOnline=true;await tripJournalController.reconnect()});
  await voice.getByText('Sincronitzat').waitFor();
  await page.evaluate(()=>{window.journalHoldTranscriptRead=true});
  await voice.getByRole('button',{name:'Torna a transcriure'}).click();
  await consent.getByRole('button',{name:'Confirma i transcriu'}).click();
  await page.waitForFunction(()=>typeof window.releaseJournalTranscriptRead==='function');
  await transcript.getByRole('button',{name:'Edita la transcripció'}).click();
  await transcriptField.fill('Vam passejar pel centre històric de l’Alguer.');
  await transcript.getByRole('button',{name:'Desa el text'}).click();
  await transcript.getByText('Vam passejar pel centre històric de l’Alguer.',{exact:true}).waitFor();
  await voice.getByText('Sincronitzat').waitFor();
  await page.evaluate(()=>{
    window.journalOnline=false;window.journalHoldTranscriptRead=false;window.releaseJournalTranscriptRead();
  });
  await voice.locator('[data-journal-transcription-status]').waitFor({state:'detached'});
  await transcript.getByText('Vam visitar l’Alguer.',{exact:true}).waitFor({state:'attached'});
  await transcript.locator('summary').click();
  await transcript.getByText('Vam visitar l’Alguer.',{exact:true}).waitFor();
  await transcript.getByText('Vam passejar pel centre històric de l’Alguer.',{exact:true}).waitFor();

  await page.evaluate(()=>{window.journalOnline=true;window.journalHoldProvider=true;window.releaseJournalTranscription=null});
  await voice.getByRole('button',{name:'Torna a transcriure'}).click();
  await consent.getByRole('button',{name:'Confirma i transcriu'}).click();
  await page.waitForFunction(()=>typeof window.releaseJournalTranscription==='function');
  page.once('dialog',dialog=>dialog.accept());
  await voice.getByRole('button',{name:'Elimina només la transcripció'}).click();
  await transcript.waitFor({state:'detached'});
  await page.waitForFunction(id=>window.journalFixtureRows.get(id).transcript_original===null,voiceId);
  await page.evaluate(()=>{window.journalHoldProvider=false;window.releaseJournalTranscription()});
  await voice.getByRole('button',{name:'Escolta'}).waitFor();
  assert.equal(await transcript.count(),0);
  await records(page).getByRole('button',{name:'Escolta'}).click();
  const playing=page.locator('[data-journal-playback] audio');
  await playing.waitFor();
  const originalUrl=await playing.getAttribute('src');
  page.once('dialog',dialog=>dialog.dismiss());
  await records(page).getByRole('button',{name:'Elimina el record'}).click();
  assert.equal(await playing.count(),1,'Cancelling must preserve the original and its playback');
  await page.evaluate(()=>{window.journalOnline=false});
  page.once('dialog',dialog=>dialog.accept());
  await records(page).getByRole('button',{name:'Elimina el record'}).click();
  await records(page).waitFor({state:'detached'});
  assert.equal(await page.evaluate(async({id,url})=>{
    const scope={userId:session.user.id,tripId:trip.id},vault=tripJournalVault(scope,()=>true);
    const gone=!(await vault.read('audio:'+id));
    const canFetch=await fetch(url).then(()=>true,()=>false);
    const canRestore=await vault.write([['audio:'+id,new Uint8Array([1])]]).then(()=>true,()=>false);
    return gone&&!canFetch&&!canRestore;
  },{id:voiceId,url:originalUrl}),true,'The local encrypted copy, playback URL and late cache writes must be unavailable');
  assert.equal(await page.evaluate(id=>!!window.journalFixtureRows.get(id).audio_base64,voiceId),true,
    'An offline deletion should report that the server copy is still pending');
  await sync(page).getByText(/canvis pendents/).waitFor();

  await page.evaluate(fixture=>{window.installJournalFixture(fixture);window.micAllowed=true},native?null:silenceMp4);
  await editor(page).fill('Veu eliminada abans de sincronitzar');
  await page.getByRole('button',{name:'Enregistra veu'}).click();
  await page.getByRole('button',{name:'Atura'}).waitFor();
  await page.locator('[data-journal-duration]').getByText(/0:01/).waitFor();
  await page.getByRole('button',{name:'Atura'}).click();
  await page.locator('[data-journal-preview]').waitFor();
  await page.getByRole('button',{name:'Desa el record'}).click();
  const unsent=records(page).filter({hasText:'Veu eliminada abans de sincronitzar'});
  await unsent.getByRole('button',{name:'Escolta'}).waitFor();
  const unsentId=await page.evaluate(async()=>{
    const database=await offlineDocDatabase();
    const rows=await offlineDocUserRows(database,session.user.id,true);
    const active=rows.filter(row=>row.documentId.startsWith(JOURNAL_VAULT_PREFIX+'audio:'));
    if(active.length!==1)throw Error('Expected only the unsent local voice copy');
    return active[0].documentId.split(':').at(-1);
  });
  page.once('dialog',dialog=>dialog.accept());
  await unsent.getByRole('button',{name:'Elimina el record'}).click();
  await unsent.waitFor({state:'detached'});
  await page.getByRole('button',{name:'Torna al viatge'}).click();
  await page.locator('#genericPastRecordsSection [data-open="journalView"]').click();
  await sync(page).getByText(/canvis pendents/).waitFor();
  assert.equal(await records(page).count(),0);
  await page.evaluate(async()=>{window.journalOnline=true;await tripJournalController.reconnect()});
  const deletionState=await page.evaluate(({voiceId,unsentId})=>{
    const rows=window.journalFixtureRows,writes=window.journalFixtureWrites.filter(write=>write.p_id===unsentId);
    return {removed:[voiceId,unsentId].every(id=>rows.get(id)?.deleted&&rows.get(id).audio_base64===null),
      onlyTombstone:writes.length===1&&writes[0].p_deleted&&writes[0].p_audio===null};
  },{voiceId,unsentId});
  assert.deepEqual(deletionState,{removed:true,onlyTombstone:true},'Deletion must scrub synced audio and never upload an unsent original');
  const selectiveId='30000000-0000-4000-8000-000000000001';
  await page.evaluate(({id,audio})=>window.journalFixtureRows.set(id,{
    id,local_day:'2026-11-27',captured_at:'2026-11-27T12:00:00Z',body:'',audio_mime:'audio/mp4',duration_ms:1000,
    audio_base64:audio,operation_id:'30000000-0000-4000-8000-000000000002',deleted:false,
    transcript_original:'Transcripció sintètica que es conserva',transcript_edit:'Record escrit que es conserva',transcript_language:'ca'
  }),{id:selectiveId,audio:silenceMp4});
  await page.evaluate(()=>tripJournalController.reconnect());
  const selective=page.locator(`[data-journal-entry="${selectiveId}"]`);
  const selectedTranscript=selective.locator('[data-journal-transcript]');
  const retranscribe=selective.getByRole('button',{name:'Torna a transcriure'});
  await retranscribe.waitFor();
  await page.evaluate(()=>{window.journalOnline=false});
  await retranscribe.click();
  await selective.getByRole('button',{name:'Autoritza i deixa pendent'}).click();
  await selective.getByText('Transcripció pendent d’enviament.').waitFor();
  const callsBeforeRevocation=await page.evaluate(()=>({
    requests:window.journalTranscribeRequests.length,provider:window.journalProviderRequests.length
  }));
  await page.evaluate(()=>{
    window.journalTranscriptionAllowed=false;
    window.journalOnline=true;
    void tripJournalController.reconnect();
  });
  const restricted='La transcripció nova no està disponible per a aquest compte.';
  await selective.locator('[data-journal-transcription-status]').getByText(restricted,{exact:true}).waitFor();
  assert.equal(await retranscribe.count(),0,'Revocation must hide the action for a new transcription');
  await page.evaluate(async()=>{await tripJournalController.reconnect()});
  assert.deepEqual(await page.evaluate(()=>({
    requests:window.journalTranscribeRequests.length,provider:window.journalProviderRequests.length
  })),{requests:callsBeforeRevocation.requests+1,provider:callsBeforeRevocation.provider},
    'A restricted queued request must terminate without a provider call or another retry');
  await selectedTranscript.getByRole('button',{name:'Edita la transcripció'}).click();
  await selectedTranscript.getByRole('textbox',{name:'Transcripció'}).fill('Record escrit que es conserva després de revocar l’accés');
  await selectedTranscript.getByRole('button',{name:'Desa el text'}).click();
  await page.waitForFunction(id=>window.journalFixtureRows.get(id)?.transcript_edit==='Record escrit que es conserva després de revocar l’accés',selectiveId);
  await selectedTranscript.getByText('Record escrit que es conserva després de revocar l’accés',{exact:true}).waitFor();
  await selective.getByRole('button',{name:'Escolta'}).click();
  const localAudio=page.locator('[data-journal-playback] audio');
  const localAudioUrl=await localAudio.getAttribute('src');
  await page.evaluate(()=>{window.journalOnline=false});
  page.once('dialog',dialog=>dialog.accept());
  await selective.getByRole('button',{name:'Elimina només l’àudio'}).click();
  await localAudio.waitFor({state:'detached'});
  await selective.getByText('Record escrit que es conserva').waitFor();
  assert.equal(await selective.getByRole('button',{name:'Escolta'}).count(),0);
  assert.ok(await page.evaluate(async({id,url})=>{
    const vault=tripJournalVault({userId:session.user.id,tripId:trip.id},()=>true);
    return !await vault.read('audio:'+id)&&
      !await fetch(url).then(()=>true,()=>false)&&
      !await vault.write([['audio:'+id,Uint8Array.of(1)]]).then(()=>true,()=>false)&&
      !!window.journalFixtureRows.get(id).audio_base64;
  },{id:selectiveId,url:localAudioUrl}));
  await page.evaluate(async()=>{window.journalOnline=true;await tripJournalController.reconnect()});
  await page.waitForFunction(id=>window.journalFixtureRows.get(id).audio_base64===null,selectiveId);
  await selective.getByText('Sincronitzat').waitFor();
  await ctx.close();
  page=await launch(false);
  await page.goto(url);
  await page.waitForFunction(owner=>offlineReadOnlySession&&!coldStartNavigationPending&&session?.user?.id===owner,user);
  await page.evaluate(id=>{
    trip=trips.find(item=>item.id===id);tripLoadGeneration++;updateTripPresentation();setAppView('genericDashboardView');
  },row.id);
  await dashboard(page).click();
  await records(page).getByText('Record escrit que es conserva').waitFor();
  assert.equal(await records(page).getByRole('button',{name:'Escolta'}).count(),0);
  assert.equal(await page.evaluate(async()=>{
    const stored=await offlineDocUserRows(await offlineDocDatabase(),session.user.id,true);
    return stored.some(entry=>JSON.stringify(entry).includes('Record escrit que es conserva'));
  }),false);
  await page.evaluate(async()=>{
    const owner=session.user.id,tid=trip.id;
    const scope={userId:'other-fixture',tripId:tid};
    session={user:{id:scope.userId}};
    const labels=await tripJournalVault(scope,()=>session.user.id===scope.userId).labels();
    if(labels.length)throw Error('Other account read journal records');
    session={user:{id:owner}};
  });
  console.log('PASS '+engine+': journal entry points, '+(native?'native recording':'recording-event fixture')+
    ', offline recovery, consent, provider replay, access revocation, edits, selective and complete deletion, and account isolation.');
}finally{
  await ctx?.close();
  await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true});
}

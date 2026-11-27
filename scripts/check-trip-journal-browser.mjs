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
    let loseAcknowledgement=true;
    db.rpc=(name,args)=>({abortSignal:async()=>{
      if(name!=='save_trip_journal_v1'||args.p_author!==session.user.id)throw Error('Unexpected RPC scope');
      const prior=rows.get(args.p_id);
      if(prior?.operation_id!==args.p_operation){
        if((prior?.operation_id??null)!==args.p_base)return {error:{code:'40001'}};
        rows.set(args.p_id,{id:args.p_id,local_day:args.p_day,captured_at:args.p_captured_at,body:args.p_body,
          audio_mime:args.p_mime,duration_ms:args.p_duration,operation_id:args.p_operation,deleted:args.p_deleted,
          audio_base64:args.p_audio});
      }
      if(loseAcknowledgement){loseAcknowledgement=false;return {error:new Error('Lost acknowledgement')}}
      return {data:args.p_operation};
    }});
    db.from=()=>({select:()=>{const query={eq:()=>query,order:()=>query,range:async()=>({data:[...rows.values()]})};return query}});
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
  await page.evaluate(async()=>{
    const owner=session.user.id,tid=trip.id;
    const scope={userId:'other-fixture',tripId:tid};
    session={user:{id:scope.userId}};
    const labels=await tripJournalVault(scope,()=>session.user.id===scope.userId).labels();
    if(labels.length)throw Error('Other account read journal records');
    session={user:{id:owner}};
  });
  console.log('PASS '+engine+': journal entry points, denied microphone, '+(native?'native recording':'recording-event fixture')+', interruption, encrypted cold recovery, replay, edit/delete, preserved audio and account isolation.');
}finally{
  await ctx?.close();
  await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true});
}

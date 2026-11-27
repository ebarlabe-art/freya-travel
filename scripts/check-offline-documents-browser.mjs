import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname,join,resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const engine=process.env.OFFLINE_DOC_ENGINE||'chromium';
const engines=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const dist=resolve('dist');
const profile=await mkdtemp(join(tmpdir(),'freya-offline-documents-'));
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.png':'image/png','.webmanifest':'application/manifest+json'};
const userId='offline-doc-owner',tripId='offline-doc-trip';
const futureDay=days=>new Date(Date.now()+days*86400000).toISOString().slice(0,10);
const tripRow={id:tripId,name:'Brussel·les de prova',start_date:futureDay(7),end_date:futureDay(8),time_zone:'Europe/Brussels',is_owner:true,experience_key:null};
const docs=[
  {id:'ticket',title:'Bitllet PDF',file_name:'bitllet.pdf',mime_type:'application/pdf; charset=binary'},
  {id:'image',title:'Reserva amb imatge',file_name:'reserva.png',mime_type:'image/png'}
].map(doc=>({...doc,trip_id:tripId,category:'Reserva',file_path:tripId+'/'+doc.file_name}));
const shape='0.2 0.4 0.8 rg\n10 10 80 80 re f\n';
const objects=[
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>',
  '<< /Length '+shape.length+' >>\nstream\n'+shape+'endstream'
];
let pdfSource='%PDF-1.4\n';
const offsets=objects.map((object,index)=>{
  const offset=pdfSource.length;
  pdfSource+=(index+1)+' 0 obj\n'+object+'\nendobj\n';
  return offset;
});
const xref=pdfSource.length;
pdfSource+='xref\n0 5\n0000000000 65535 f \n'+offsets.map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+
  'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
const pdf=Buffer.from(pdfSource);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64');
const scopeUrl='https://otueskpksylzvkhldoft.supabase.co/**';
const downloads=[];
let failFirstPdf=true,finishFailedDownload,failedRequestBlocked=false;
let networkDown=false;
const failedDownload=new Promise(resolve=>{finishFailedDownload=resolve});
const server=createServer(async(req,res)=>{
  if(networkDown){res.writeHead(503).end();return}
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/rest/v1/travel_documents'&&req.method==='GET'){
    res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(docs));
    return;
  }
  if(pathname.startsWith('/storage/v1/object/trip-documents/')&&req.method==='GET'){
    const doc=docs.find(doc=>pathname.endsWith('/'+doc.file_path));
    if(!doc){res.writeHead(404).end();return}
    downloads.push(doc.id);
    if(doc.id==='ticket'&&failFirstPdf){
      failFirstPdf=false;failedRequestBlocked=true;
      await failedDownload;
      res.writeHead(503,{'Content-Type':'application/json'}).end('{}');
      return;
    }
    res.writeHead(200,{'Content-Type':doc.id==='ticket'?'application/pdf; charset=binary':'application/octet-stream; name=reserva.png'});
    res.end(doc.id==='ticket'?pdf:png);
    return;
  }
  const file=resolve(dist,decodeURIComponent(pathname.replace(/^\/freya-travel\//,''))||'index.html');
  if(!pathname.startsWith('/freya-travel/')||!file.startsWith(dist+sep)){res.writeHead(404).end();return}
  try{res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream'}).end(await readFile(file))}
  catch{if(!res.headersSent)res.writeHead(404);res.end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,url=origin+'/freya-travel/';
const launch=()=>engines[engine].launchPersistentContext(profile,{
  headless:true,viewport:{width:390,height:844},locale:'ca-ES',
  ...(process.env.CHROME_PATH&&engine==='chromium'?{executablePath:process.env.CHROME_PATH}:{})
});
let ctx;
try{
  ctx=await launch();
  await ctx.route(scopeUrl,route=>route.abort());
  await ctx.addInitScript(()=>Object.defineProperty(navigator,'language',{get:()=> 'ca-ES'}));
  const online=await ctx.newPage();
  await online.goto(url);
  await online.waitForFunction(()=>navigator.serviceWorker.controller&&authInitializationResolved);
  await online.locator('#loginCard').waitFor({state:'visible'});
  await online.evaluate(({userId,tripRow})=>{
    // Run the real SDK against same-origin fixture responses in both engines.
    const fixtureClient=window.supabase.createClient(location.origin,'fixture-public-key',{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
    });
    db.storage=fixtureClient.storage;
    const from=db.from.bind(db);
    db.from=table=>table==='travel_documents'?fixtureClient.from(table):from(table);
    session={user:{id:userId,email:'fixture@example.invalid'},access_token:'fixture-online-token'};
    trip=tripRow;tripLoadGeneration++;
    if(!rememberOfflineTrips([tripRow],userId)||readOfflineSessionGrant()?.userId!==userId)
      throw Error('Cannot seed local read grant');
    localStorage.setItem(OFFLINE_AUTO_DOCS_PREF+userId,'off');
    hide('auth');show('tripView');setAppView('documentsView');
  },{userId,tripRow});
  const ticket=online.locator('[data-doc-id="ticket"]'),image=online.locator('[data-doc-id="image"]');
  const state=card=>card.locator('[data-offline-state]');
  await ticket.waitFor({state:'visible'}).catch(async error=>{
    console.error('Offline document fixture did not render',await online.evaluate(()=>({
      language:insightsLanguage,view:visibleAppView(),online:navigator.onLine,message:$('documentMsg').textContent
    })));
    throw error;
  });
  await ticket.getByRole('button',{name:'Desa offline'}).click();
  await state(ticket).getByText('Descarregant el document…',{exact:false}).waitFor();
  assert.equal(failedRequestBlocked,true);
  assert.equal(await ticket.locator('[data-offline-save]').isDisabled(),true);
  finishFailedDownload();
  await state(ticket).getByText('No s’ha pogut descarregar',{exact:false}).waitFor();
  await ticket.getByRole('button',{name:'Reintenta el desament offline'}).click();
  await state(ticket).getByText('Disponible offline',{exact:false}).waitFor();
  await online.locator('#offlineAutoDocuments').check();
  await state(image).getByText('Disponible offline',{exact:false}).waitFor();
  assert.deepEqual(downloads,['ticket','ticket','image']);
  assert.deepEqual(await online.evaluate(async()=>{
    const scope=offlineDocScope(),database=await offlineDocDatabase();
    const key=await offlineDocKey(database,scope.userId);
    const records=await offlineDocUserRows(database,scope.userId);
    return {nonExportable:!key.extractable,records:records.map(row=>[row.documentId,row.ciphertext.byteLength-row.size]).sort()};
  }),{nonExportable:true,records:[['image',16],['ticket',16]]});
  console.log(engine+': PDF and PNG persisted and verified before browser shutdown');

  // Close the browser process, then reopen the same profile without a network
  // or a seeded JS session. The shell, account grant, cards and vault must survive.
  await online.waitForFunction(async()=>{
    const key=new URL('index.html',location.href);
    return !!await caches.match(key);
  });
  await ctx.close();
  networkDown=true;
  ctx=await launch();
  await ctx.route(scopeUrl,route=>route.abort());
  // WebKit's offline switch can fail the navigation before its relaunched worker
  // can handle it. In that engine every server request fails with 503 instead.
  if(engine==='chromium')await ctx.setOffline(true);
  await ctx.addInitScript(()=>{
    Object.defineProperty(navigator,'language',{get:()=> 'ca-ES'});
    Object.defineProperty(navigator,'onLine',{get:()=>false});
  });
  const offline=await ctx.newPage();
  offline.on('pageerror',error=>console.error('Offline app error:',error.message));
  await offline.goto(url);
  await offline.waitForFunction(({userId,tripId})=>authInitializationResolved&&offlineReadOnlySession&&
    !coldStartNavigationPending&&session?.user?.id===userId&&trips.some(row=>row.id===tripId),{userId,tripId});
  console.log(engine+': cold shell, local account grant and cached trip restored');
  // Start at Documents on the already restored trip. The dashboard startup also
  // starts unrelated itinerary/realtime work, outside the document contract.
  await offline.evaluate(id=>{
    trip=trips.find(row=>row.id===id);
    tripLoadGeneration++;
    setAppView('documentsView');
  },tripId);
  const viewer=offline.locator('#documentViewer');
  for(const [doc,bytes,selector] of [[docs[0],pdf,'iframe'],[docs[1],png,'img']]){
    const card=offline.locator('[data-doc-id="'+doc.id+'"]');
    await state(card).getByText('Disponible offline',{exact:false}).waitFor();
    await card.getByRole('button',{name:'Obrir document'}).click();
    const resource=viewer.locator(selector);
    await resource.waitFor({state:'attached'});
    assert.deepEqual(await resource.evaluate(async el=>{
      if(!el.src.startsWith('blob:'))throw Error('Expected a decrypted local Blob');
      if(el instanceof HTMLImageElement)await el.decode();
      return [...new Uint8Array(await (await fetch(el.src)).arrayBuffer())];
    }),[...bytes]);
    console.log(engine+': opened the decrypted '+selector+' from the cold vault');
    await offline.locator('#documentViewerClose').click();
  }
  // A stale/corrupt row must remain stored, but cannot be advertised as ready.
  await offline.evaluate(async()=>{
    const scope=offlineDocScope(),database=await offlineDocDatabase(),id=offlineDocId(scope.userId,scope.tripId,'ticket');
    const row=await offlineDocRead(database,'records',id);
    row.iv[0]^=1;
    await offlineDocTx(database,['records'],'readwrite',tx=>tx.objectStore('records').put(row));
    await offlineDocStatus();
  });
  const corrupt=offline.locator('[data-doc-id="ticket"]');
  await state(corrupt).getByText('La còpia xifrada no es pot recuperar',{exact:false}).waitFor();
  assert.equal(await corrupt.getByRole('button',{name:'Reintenta el desament offline'}).isDisabled(),true);
  assert.equal(await offline.evaluate(async()=>{
    const scope=offlineDocScope();
    return !!await offlineDocRead(await offlineDocDatabase(),'records',offlineDocId(scope.userId,scope.tripId,'ticket'));
  }),true);
  console.log('PASS '+engine+': manual PDF download and retry, auto PNG, MIME parameters, encrypted commit, cold offline reopen, and unreadable copy rejected.');
}finally{
  finishFailedDownload();
  await ctx?.close();
  await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true});
}

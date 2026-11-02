// Real Pages build and touch controls; only synthetic transport/state. No remote writes.
import assert from 'node:assert/strict';import {readFile,mkdir} from 'node:fs/promises';import {createServer} from 'node:http';import {resolve,extname,sep} from 'node:path';import {pathToFileURL} from 'node:url';
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),engine=process.env.PLANNING_ENGINE||'chromium',dist=resolve('dist');
const server=createServer(async(req,res)=>{const path=resolve(dist,new URL(req.url,'http://local').pathname.replace(/^\/freya-travel\//,'')||'index.html');if(!path.startsWith(dist+sep)){res.writeHead(404).end();return}try{res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/freya-travel/`;
const browser=await pw[engine].launch({headless:true});
try{
 const ctx=await browser.newContext({viewport:process.env.RECONCILE_TABLET?{width:1024,height:768}:{width:390,height:844},isMobile:!process.env.RECONCILE_TABLET,hasTouch:true,serviceWorkers:'block'});
 await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(url).origin?r.continue():r.abort());await ctx.routeWebSocket('**/*',s=>s.close());
 const page=await ctx.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.locator('#loginCard').waitFor({state:'visible'});
 await page.evaluate(()=>{
  const id=n=>'24000000-0000-4000-8000-'+String(n).padStart(12,'0');
  session={user:{id:id(1)}};trip={id:id(2),name:'Retorn sintètic',start_date:'2027-01-02',end_date:'2027-01-03',time_zone:'UTC'};
  const doc={id:id(3),trip_id:trip.id,title:'Reserva sintètica Xesc',file_name:'synthetic.pdf',mime_type:'application/pdf',category:'Vols'};
  const base={trip_id:trip.id,departure_time_zone:'UTC',arrival_time_zone:'UTC',flight_status:'reserved',passengers:'Eva',seat:'12A',booking_reference:'ABC',updated_at:'2026-01-01T00:00:00Z'};
  const rows=[{...base,id:id(10),flight_number:'AY1020',departure_at:'2027-01-02T10:20:00Z',arrival_at:'2027-01-02T11:20:00Z',departure_airport_code:'TLL',arrival_airport_code:'HEL'}, { ...base,id:id(11),flight_number:'AY1653',departure_at:'2027-01-02T14:55:00Z',arrival_at:'2027-01-02T18:00:00Z',departure_airport_code:'HEL',arrival_airport_code:'BCN'}];
  const links=rows.flatMap((r,i)=>[{trip_id:trip.id,flight_id:r.id,document_id:id(4),document_role:'booking'},{trip_id:trip.id,flight_id:r.id,document_id:id(20+i),document_role:'boarding_pass'}]);
  window.flightFixture={rows,links,original:JSON.stringify(rows),writes:0,assignments:[],failLink:false};
  const field=value=>({value,confidence:'high',evidence:[{kind:'text',excerpt:value,page:1}]});
  flightFixture.proposal={schema_version:1,source:{kind:'document',document_id:doc.id,mime_type:'application/pdf'},target_type:'flight',fields:{flight_number:field('AY1020'),passengers:field('Xesc'),booking_reference:field('DEF')},missing_required:[],warnings:[],flight_segments:rows.map(r=>({flight_number:r.flight_number,departure_at:r.departure_at.slice(0,16),arrival_at:r.arrival_at.slice(0,16),departure_city:'Ciutat sintètica',arrival_city:'Ciutat sintètica',passengers:'Xesc',seat:'12B'}))};
  tripStopRows=[{label:'Ciutat sintètica',canonical_name:'Ciutat sintètica',time_zone:'UTC'}];
  documentRows=[doc,{...doc,id:id(4),title:'Reserva Eva'},...rows.map((r,i)=>({...doc,id:id(20+i),title:'Targeta Eva '+i}))];flightRows=structuredClone(rows);flightDocumentLinks=structuredClone(links);
  loadDocuments=async()=>documentRows;renderDocuments=()=>{};
  loadFlights=async()=>{flightRows=structuredClone(rows);flightDocumentLinks=structuredClone(links);renderFlights();return flightRows};
  db.from=table=>{
   if(!['trip_flights','trip_flight_documents'].includes(table))throw Error('Unexpected table '+table);
   let ids=null;const q={select:()=>q,eq:()=>q,in:(_,v)=>{ids=v;return q},then:resolve=>Promise.resolve({data:structuredClone((table==='trip_flights'?rows:links).filter(r=>!ids||ids.includes(r.id))),error:null}).then(resolve),upsert:async(input,options)=>{if(options.onConflict!=='id'||options.ignoreDuplicates!==true)throw Error('Unsafe upsert');for(const r of input)if(!rows.some(x=>x.id===r.id)){rows.push({...r,updated_at:'2026-01-02T00:00:00Z'});flightFixture.writes++}return {error:null}}};return q;
  };
  db.rpc=async(name,args)=>{
   if(name==='sync_trip_flight_document'){
    if(flightFixture.failLink){flightFixture.failLink=false;return {error:{message:'Synthetic link failure'}}}
    if(!links.some(l=>l.flight_id===args.p_flight_id&&l.document_id===args.p_new_document_id))links.push({trip_id:trip.id,flight_id:args.p_flight_id,document_id:args.p_new_document_id,document_role:args.p_document_role});return {error:null};
   }
   if(name==='ensure_trip_flight_travelers'){flightFixture.assignments.push(structuredClone(args));return {data:[],error:null}}
   throw Error('Unexpected RPC '+name);
  };
  Object.defineProperty(db,'functions',{configurable:true,value:{invoke:async(name)=>{if(name!=='import-reservation')throw Error('Unexpected function');return {data:{proposal:flightFixture.proposal},error:null}}}});
  APP_VIEWS.forEach(id=>document.getElementById(id)?.classList.toggle('hidden',id!=='genericFlightsView'));
  let node=document.getElementById('genericFlightsView');while(node){node.classList.remove('hidden');node=node.parentElement}document.getElementById('loginCard').classList.add('hidden');renderFlights();
 });
 const importPdf=async()=>{
  await page.locator('[data-import-reservation="flight"]').tap();
  await page.locator('#reservationImportDocument').selectOption('24000000-0000-4000-8000-000000000003');
  await page.locator('#reservationImportUseDocument').tap();await page.locator('#reservationImportApply').waitFor({state:'visible'});
  await page.locator('#reservationImportApply').tap();
 };
 assert.equal(await page.evaluate(()=>flightFixture.writes),0);
 await importPdf();await page.locator('#reservationImportOverlay').waitFor({state:'hidden'});
 assert.deepEqual(await page.evaluate(()=>[flightFixture.rows.length,flightFixture.links.length]),[4,6]);
 await page.waitForFunction(()=>document.querySelectorAll('#flightList [data-flight-id]').length===2);
 assert.equal(await page.locator('[data-edit-flight]').count(),4);
 assert.equal(await page.locator('[data-flight-document-role="booking"]').count(),4);
 assert.equal(await page.locator('[data-flight-document][data-flight-document-role="boarding_pass"]').count(),2);
 assert.equal(await page.evaluate(()=>JSON.stringify(flightFixture.rows.slice(0,2))===flightFixture.original),true);
 assert.ok(await page.evaluate(()=>flightFixture.assignments.every(a=>a.p_flight_ids.length===1&&a.p_names.join()==='Xesc')));
 await importPdf();await page.locator('#reservationImportOverlay').waitFor({state:'hidden'});
 assert.deepEqual(await page.evaluate(()=>[flightFixture.rows.length,flightFixture.links.length,flightFixture.writes]),[4,6,2]);
 // Failed document linking can be retried without reinserting the ticket.
 await page.evaluate(()=>{flightFixture.proposal.flight_segments.forEach((s,i)=>{s.passengers=i?'Joana':'Maria';s.seat='13A'});flightFixture.proposal.fields.passengers.value='Maria';flightFixture.failLink=true});
 await importPdf();await page.waitForFunction(()=>document.getElementById('reservationImportStatus').textContent.includes('Synthetic link failure'));
 assert.equal(await page.evaluate(()=>flightFixture.rows.length),6);
 await page.locator('#reservationImportApply').tap();await page.locator('#reservationImportOverlay').waitFor({state:'hidden'});
 assert.deepEqual(await page.evaluate(()=>[flightFixture.rows.length,flightFixture.links.length,flightFixture.writes]),[6,8,4]);
 assert.equal(await page.evaluate(()=>JSON.stringify(flightFixture.rows.slice(0,2))===flightFixture.original),true);
 assert.ok(await page.evaluate(()=>flightFixture.assignments.every(a=>a.p_names.length===1&&flightFixture.rows.find(r=>r.id===a.p_flight_ids[0]).passengers===a.p_names[0])));
 assert.deepEqual(errors,[]);console.log('PASS #207 '+engine+': real PDF review/apply, missing airports, two cards, separate passengers/documents, repeat import and partial retry without duplicates.');
}finally{await browser.close();server.close()}

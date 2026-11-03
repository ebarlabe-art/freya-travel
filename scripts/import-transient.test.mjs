import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {stripTypeScriptTypes} from 'node:module';
import {readImportRequest,decodeTransientFile,MAX_TRANSIENT_REQUEST} from '../supabase/functions/import-itinerary/transient.mjs';
const id='14000000-0000-4000-8000-000000000001',file={name:'synthetic.pdf',mime_type:'application/pdf',base64:btoa('%PDF-1.4 synthetic fixture')};
test('#194 transient input is bounded, validates encoding and keeps contents out of errors',async()=>{
 assert.equal(new TextDecoder().decode(decodeTransientFile(file)),'%PDF-1.4 synthetic fixture');
 for(const f of [{...file,base64:'SECRET!!'},{...file,mime_type:'text/html'},{...file,extra:'private'},{...file,base64:''}])assert.throws(()=>decodeTransientFile(f),e=>e.message==='invalid_request');
 await assert.rejects(readImportRequest(new Request('https://local',{method:'POST',body:'{}',headers:{'content-length':String(MAX_TRANSIENT_REQUEST+1)}})),/invalid_file_size/);
 const tooLarge=new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_TRANSIENT_REQUEST+1));c.close()}});
 await assert.rejects(readImportRequest(new Request('https://local',{method:'POST',body:tooLarge,duplex:'half'})),/invalid_file_size/);
});
test('#194 actual Edge accepts ephemeral PDF only after JWT/RLS read; no storage or DB writes',async()=>{
 const savedFetch=globalThis.fetch,savedDeno=globalThis.Deno;let handler;const calls=[];
 globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_ANON_KEY:'synthetic-anon',OPENAI_API_KEY:'synthetic-key',A2_IMPORT_MODEL:'synthetic-model'})[key]},serve:fn=>{handler=fn}};
 let allowed=true,providerTranscript={complete:true,warnings:[],pages:[{page:1,text:'27/12/2030\n10:00 Visita al museu sintètic'}]};
 globalThis.fetch=async(url,options={})=>{
  const u=String(url);calls.push({url:u,method:options.method||'GET'});
  if(u.includes('/rest/v1/trips?'))return Response.json(allowed?[{id}]:[]);
  if(u.includes('/rest/v1/trip_stops'))return Response.json([]);
  if(u.includes('/functions/v1/place-resolution'))return Response.json({candidates:[]});
  if(u==='https://api.openai.com/v1/responses')return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(providerTranscript)}]}]});
  throw Error('Unexpected network request');
 };
 try{
  let source=await readFile(new URL('../supabase/functions/import-itinerary/index.ts',import.meta.url),'utf8');
  for(const name of ['transcript.mjs','transient.mjs'])source=source.replace("'./"+name+"'",JSON.stringify(new URL('../supabase/functions/import-itinerary/'+name,import.meta.url).href));
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
  const request=(body,auth=true)=>new Request('https://local',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{authorization:'Bearer synthetic-user'}:{})},body:JSON.stringify(body)});
  assert.equal((await handler(request({trip_id:id,document_id:id,file},false))).status,401);assert.equal(calls.length,0);
  allowed=false;assert.equal((await handler(request({trip_id:id,document_id:id,file}))).status,404);assert.equal(calls.length,1);
  allowed=true;calls.length=0;
  const result=await handler(request({trip_id:id,document_id:id,file}));assert.equal(result.status,200,JSON.stringify(await result.clone().json()));
  assert.equal((await result.json()).proposal.source.document_id,id);
  assert.ok(calls.some(c=>c.url==='https://api.openai.com/v1/responses'));
  assert.ok(calls.every(c=>!c.url.includes('/storage/')&&!c.url.includes('/travel_documents')));
  assert.ok(calls.filter(c=>c.url.includes('/rest/')).every(c=>c.method==='GET'));
  calls.length=0;assert.equal((await handler(request({trip_id:id,document_id:id,file:{...file,base64:btoa('not a PDF')}}))).status,415);
  assert.equal(calls.some(c=>c.url.includes('openai.com')),false);
  // Actual Edge handler + original Aran bytes, only provider transport mocked.
  providerTranscript=JSON.parse(await readFile(new URL('./fixtures/aran/annotated-transcript.json',import.meta.url),'utf8'));
  const original={name:'original.pdf',mime_type:'application/pdf',base64:(await readFile(new URL('./fixtures/aran/original.pdf',import.meta.url))).toString('base64')};
  const old=await handler(request({trip_id:id,document_id:id,file:original}));assert.equal(old.status,409);assert.equal((await old.json()).error,'reader_update_required');
  const modern=await handler(request({trip_id:id,document_id:id,file:original,reader_version:2}));assert.equal(modern.status,200);
  const recovered=(await modern.json()).proposal;assert.equal(recovered.candidates.length,17);assert.equal(recovered.requires_user_confirmation,true);
  providerTranscript=JSON.parse(await readFile(new URL('./fixtures/aran/openai-verified-transcript.json',import.meta.url),'utf8'));
  const liveReplay=await handler(request({trip_id:id,document_id:id,file:original,reader_version:2}));
  assert.equal(liveReplay.status,200);assert.equal((await liveReplay.json()).proposal.candidates.length,16);
  providerTranscript.blocks=providerTranscript.blocks.filter(b=>b.role!=='alternative');
  providerTranscript.blocks.find(b=>b.role==='activity').time='02.23';
  assert.equal((await handler(request({trip_id:id,document_id:id,file:original}))).status,409);
  assert.equal((await handler(request({trip_id:id,document_id:id,file:original,reader_version:3}))).status,400);
  assert.ok(calls.filter(c=>c.url.includes('/rest/')).every(c=>c.method==='GET'));
  assert.ok(calls.every(c=>!c.url.includes('/storage/')));

 }finally{globalThis.fetch=savedFetch;globalThis.Deno=savedDeno}
});

import {createIngestHandler} from './handler.mjs';
import {inspectSource,sha256,MAX_BYTES,requireEdgeCapacity} from './source.ts';
// Load the codec only after the original has been copied and durably registered.
const processImage=async(bytes:Uint8Array)=>{requireEdgeCapacity(inspectSource(bytes));return (await import('./image.ts')).processImage(bytes);};
const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const path=(s:string)=>s.split('/').map(encodeURIComponent).join('/');
const headers=(auth?:string)=>({apikey:auth?anon:service,Authorization:auth||'Bearer '+service});
const transientStorageStatus=(status:number)=>status===429||status===502||status===503||status===504;
async function read(bucket:string,name:string,auth?:string){
 let r:Response|null=null;
 for(let attempt=0;attempt<3;attempt++){
  r=await fetch(`${url}/storage/v1/object/authenticated/${bucket}/${path(name)}`,{headers:headers(auth),signal:AbortSignal.timeout(15000)});
  if(!transientStorageStatus(r.status))break;
  if(attempt<2)await new Promise(resolve=>setTimeout(resolve,attempt===0?250:750));
 }
 if(!r)throw Error('STORAGE_ERROR');
 if(r.status===404)return null;
 if(!r.ok){const body=await r.json().catch(()=>({}));if(Number(body.statusCode)===404)return null;throw Error('STORAGE_ERROR');}
 const limit=MAX_BYTES;
 const reader=r.body!.getReader();const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('LIMIT_EXCEEDED');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
}
const handler=createIngestHandler({
 authenticate:async(auth:string|null)=>{
  if(!auth?.startsWith('Bearer '))return null;
  const r=await fetch(url+'/auth/v1/user',{headers:headers(auth),signal:AbortSignal.timeout(8000)});return r.ok?(await r.json()).id:null;
 },
 rpc:async(name:string,args:unknown)=>{
  const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
  const raw=await r.text();const data=raw?JSON.parse(raw):null;
  if(!r.ok)throw Object.assign(Error(data?.message||'RPC_ERROR'),{code:data?.code});
  return data;
 },
 storage:{read,put:async(bucket:string,name:string,bytes:Uint8Array,mime:string)=>{
  const r=await fetch(`${url}/storage/v1/object/${bucket}/${path(name)}`,{method:'POST',headers:{...headers(),'Content-Type':mime,'x-upsert':'false'},body:bytes as BodyInit,signal:AbortSignal.timeout(15000)});
  if(!r.ok){const body=await r.json().catch(()=>({}));if(body.error!=='Duplicate'&&body.statusCode!=='409'&&r.status!==409)throw Error('STORAGE_ERROR');}
 }},
 processImage,inspectSource,hash:sha256
});
// One CPU/memory-bound image per isolate. Durable DB leases also serialize across isolates.
let processing=false;
Deno.serve(async req=>{if(processing)return Response.json({error:'RETRY_LATER'},{status:429});processing=true;try{return await handler(req);}finally{processing=false;}});

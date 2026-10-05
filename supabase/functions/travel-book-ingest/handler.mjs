// Network I/O is outside transactions; original preservation and visual readiness are separate commits.
export const BUCKET='travel-book';
export const pipelineVersion=1;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const allowedErrors=new Set(['SOURCE_MISSING','SOURCE_CHANGED','INVALID_IMAGE','LIMIT_EXCEEDED','STORAGE_ERROR','MASTER_MISSING','DERIVATIVE_UNSUPPORTED','DERIVATIVE_CAPACITY','DERIVATIVE_COLOR','DERIVATIVE_FAILED']);
export function editorialPath(asset,kind,ext='png'){
 if(!['original','preview','thumbnail'].includes(kind)||!['jpg','png','webp','heic','heif'].includes(ext)||![asset.trip_id,asset.book_id,asset.asset_key].every(v=>uuid.test(v))||!Number.isSafeInteger(asset.version)||asset.version<1)throw Error('INVALID_REQUEST');
 return `${asset.trip_id}/${asset.book_id}/${asset.asset_key}/${asset.version}/v1/${kind}.${ext}`;
}
const descriptor=v=>({hash:v.content_hash,width:v.width_px,height:v.height_px,path:v.storage_path,mime:v.mime_type,ext:v.file_extension,byte_size:v.byte_size,orientation:v.orientation});
export async function ingest({assetId,actor,auth,rpc,storage,processImage,inspectSource,hash}){
 const {job,asset,variants}=await rpc('alb03_claim_v1',{p_asset_id:assetId,p_actor:actor});
 const finish=(d,error=null)=>rpc('alb03_finish_v1',{p_asset_id:assetId,p_actor:actor,p_lease_id:job.lease_id,p_descriptor:d,p_error:error});
 let original=variants.find(v=>v.kind==='original');
 try{
  let bytes=original?await storage.read(BUCKET,original.storage_path):null;
  if(bytes&&await hash(bytes)!==original.content_hash)throw Error('MASTER_MISSING');
  if(!bytes){
   bytes=await storage.read('trip-documents',job.source_path,auth);
   if(!bytes)throw Error(original?'MASTER_MISSING':'SOURCE_MISSING');
   const info=inspectSource(bytes),digest=await hash(bytes);
   if(original&&digest!==original.content_hash)throw Error('MASTER_MISSING');
   const path=original?.storage_path||editorialPath(asset,'original',info.ext);
   await storage.put(BUCKET,path,bytes,info.mime);
   const stored=await storage.read(BUCKET,path);
   if(!stored||await hash(stored)!==digest)throw Error('STORAGE_ERROR');
   const d={hash:digest,width:info.width,height:info.height,path,mime:info.mime,ext:info.ext,byte_size:bytes.length,orientation:info.orientation};
   await finish({original:d}); // Durable before attempting any codec; keeps the lease.
   original={kind:'original',content_hash:digest,width_px:info.width,height_px:info.height,storage_path:path,mime_type:info.mime,file_extension:info.ext,byte_size:bytes.length,orientation:info.orientation};
  }
  const d={original:descriptor(original)};
  let complete=true;
  for(const kind of ['preview','thumbnail']){
   const v=variants.find(v=>v.kind===kind);if(!v){complete=false;break;}
   const data=await storage.read(BUCKET,v.storage_path);if(!data||await hash(data)!==v.content_hash){complete=false;break;}d[kind]=descriptor(v);
  }
  if(complete){await finish(d);return {asset_id:assetId,status:'ready',reused:true};}
  const images=await processImage(bytes);
  if(images.source_hash!==original.content_hash)throw Error('MASTER_MISSING');
  for(const kind of ['preview','thumbnail']){
   const image=images[kind],path=editorialPath(asset,kind),digest=await hash(image.bytes),previous=variants.find(v=>v.kind===kind);
   if(previous&&(digest!==previous.content_hash||path!==previous.storage_path))throw Error('DERIVATIVE_FAILED');
   await storage.put(BUCKET,path,image.bytes,'image/png');
   const stored=await storage.read(BUCKET,path);if(!stored||await hash(stored)!==digest)throw Error('STORAGE_ERROR');
   d[kind]={hash:digest,width:image.width,height:image.height,path,mime:'image/png',ext:'png',byte_size:image.bytes.length,orientation:1};
  }
  await finish(d);return {asset_id:assetId,status:'ready',reused:false};
 }catch(error){
  const code=allowedErrors.has(error.message)?error.message:error.message==='ALB_SOURCE_CHANGED'?'SOURCE_CHANGED':'STORAGE_ERROR';
  await finish(null,code);
  return {asset_id:assetId,status:original&&code.startsWith('DERIVATIVE_')?'derivative_pending':'unavailable',original_preserved:!!original,error:code};
 }
}
export function createIngestHandler(deps){
 return async request=>{
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  const reply=(body,status)=>new Response(JSON.stringify(body),{status,headers});
  if(request.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
  try{
   if(Number(request.headers.get('content-length'))>4096)return reply({error:'INVALID_REQUEST'},400);
   const reader=request.body?.getReader();let total=0;const chunks=[];
   if(reader)for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>4096){await reader.cancel();return reply({error:'INVALID_REQUEST'},400);}chunks.push(value);}
   const raw=new Uint8Array(total);let at=0;for(const c of chunks){raw.set(c,at);at+=c.length;}
   const body=JSON.parse(new TextDecoder().decode(raw));
   if(!body||Object.keys(body).length!==1||!uuid.test(body.asset_id))return reply({error:'INVALID_REQUEST'},400);
   const auth=request.headers.get('authorization');const actor=await deps.authenticate(auth);
   if(!actor)return reply({error:'UNAUTHENTICATED'},401);
   const result=await ingest({...deps,assetId:body.asset_id,actor,auth});
   return reply(result,result.status==='ready'?200:result.status==='derivative_pending'?202:422);
  }catch(error){
   const status=error.code==='42501'?403:error.code==='55P03'||error.code==='40001'?409:error instanceof SyntaxError?400:503;
   return reply({error:status===403?'ACCESS_DENIED':status===409?'RETRY_LATER':status===400?'INVALID_REQUEST':'INGESTION_UNAVAILABLE'},status);
  }
 };
}

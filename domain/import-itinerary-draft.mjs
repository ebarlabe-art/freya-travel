// Encrypted, device-local pause/resume for an uncommitted itinerary review.
// Nothing is uploaded: a temporary PDF remains in the browser until explicit confirmation.
const NAME='freya-itinerary-private-draft-v1',LIFETIME=24*60*60*1000,MAX_FILE=10*1024*1024,MAX_JSON=3*1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder();
const id=(userId,tripId)=>JSON.stringify([userId,tripId]);
function database(){
 if(typeof indexedDB==='undefined'||!globalThis.crypto?.subtle)throw Error('Aquest dispositiu no permet guardar revisions xifrades.');
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(NAME,1);
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('keys');db.createObjectStore('drafts',{keyPath:'id'})};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error('No es pot obrir la memòria local.'));
  request.onblocked=()=>reject(Error('Tanca les altres finestres de Freya i torna-ho a provar.'));
 });
}
function transaction(db,store,mode,work){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(store,mode),out=tx.objectStore(store);let result;
  const request=work(out);
  request.onsuccess=()=>{result=request.result};
  tx.oncomplete=()=>resolve(result);
  tx.onerror=()=>reject(tx.error||Error('No s’ha pogut accedir a la revisió.'));
  tx.onabort=()=>reject(tx.error||Error('Operació local cancel·lada.'));
 });
}
const read=(db,store,key)=>transaction(db,store,'readonly',s=>s.get(key));
const put=(db,store,value,key)=>transaction(db,store,'readwrite',s=>key===undefined?s.put(value):s.put(value,key));
const remove=(db,store,key)=>transaction(db,store,'readwrite',s=>s.delete(key));
async function keyFor(db,userId,create){
 let key=await read(db,'keys',userId);
 if(!key&&create){
  const proposed=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  // Re-read before storing to avoid needlessly replacing an existing key.
  key=await read(db,'keys',userId);
  if(!key){await put(db,'keys',proposed,userId);key=proposed}
 }
 return key;
}
async function seal(key,data,aad){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},key,data);
 return {iv,encrypted};
}
async function unseal(key,part,aad){
 return crypto.subtle.decrypt({name:'AES-GCM',iv:part.iv,additionalData:encoder.encode(aad)},key,part.encrypted);
}
function scopeOk(scope){return !!scope&&typeof scope.userId==='string'&&scope.userId.length>0&&typeof scope.tripId==='string'&&scope.tripId.length>0}
export async function saveImportDraft(scope,data,file,{current=()=>true}={}){
 if(!scopeOk(scope)||!data?.review?.items||!data?.reconciliation?.existing)throw Error('No hi ha una revisió completa per desar.');
 if(file&&(!file.name||file.size>MAX_FILE))throw Error('El PDF supera el límit local de 10 MB.');
 const clear=encoder.encode(JSON.stringify({version:1,...data}));if(clear.byteLength>MAX_JSON)throw Error('La revisió supera el límit local.');
 const bytes=file?await file.arrayBuffer():null;
 const db=await database();
 try{
  const key=await keyFor(db,scope.userId,true),tag=id(scope.userId,scope.tripId);
  const review=await seal(key,clear,tag+':review');
  const source=bytes?await seal(key,bytes,tag+':file'):null;
  if(!current())throw Error('S’ha canviat de compte o viatge: no s’ha guardat la revisió.');
  await put(db,'drafts',{id:tag,userId:scope.userId,tripId:scope.tripId,expiresAt:Date.now()+LIFETIME,review,source});
  return true;
 }finally{db.close()}
}
export async function loadImportDraft(scope){
 if(!scopeOk(scope))return null;
 const db=await database();
 try{
  const tag=id(scope.userId,scope.tripId),record=await read(db,'drafts',tag);
  if(!record)return null;
  if(record.expiresAt<=Date.now()){await remove(db,'drafts',tag);return null}
  const key=await keyFor(db,scope.userId,false);if(!key)throw Error('La clau privada d’aquesta revisió no està disponible.');
  const raw=JSON.parse(decoder.decode(await unseal(key,record.review,tag+':review')));
  if(raw.version!==1||!raw.review?.items||!Array.isArray(raw.reconciliation?.existing))throw Error('La revisió local no és vàlida.');
  let file=null;
  if(record.source){
   if(!raw.fileMeta?.name||!raw.fileMeta?.type)throw Error('Falta la informació del PDF local.');
   const clear=await unseal(key,record.source,tag+':file');
   if(clear.byteLength>MAX_FILE)throw Error('El document local supera el límit.');
   file=new File([clear],raw.fileMeta.name,{type:raw.fileMeta.type,lastModified:raw.fileMeta.lastModified||Date.now()});
  }
  return {data:raw,file};
 }finally{db.close()}
}
export async function discardImportDraft(scope){
 if(!scopeOk(scope))return;
 const db=await database();
 try{await remove(db,'drafts',id(scope.userId,scope.tripId))}finally{db.close()}
}
export async function discardUserImportDrafts(userId){
 if(!userId)return;
 const db=await database();
 try{
  const records=await transaction(db,'drafts','readonly',s=>s.getAll());
  for(const record of records||[])if(record.userId===userId)await remove(db,'drafts',record.id);
 }finally{db.close()}
}

export async function hasImportDraft(scope){
 if(!scopeOk(scope))return false;
 const db=await database();
 try{
  const record=await read(db,'drafts',id(scope.userId,scope.tripId));
  if(!record)return false;
  if(record.expiresAt<=Date.now()){await remove(db,'drafts',record.id);return false}
  return true;
 }finally{db.close()}
}

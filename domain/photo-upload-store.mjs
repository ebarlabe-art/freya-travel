// Device-local encrypted upload outbox. Identity/metadata survive reload; no server writes.
const NAME='freya-photo-outbox-v1',enc=new TextEncoder(),dec=new TextDecoder();
const scopeKey=s=>JSON.stringify([s.userId,s.tripId]);
function open(){return new Promise((resolve,reject)=>{
 if(!globalThis.indexedDB||!globalThis.crypto?.subtle)return reject(Error('No es pot protegir la cua en aquest navegador.'));
 const r=indexedDB.open(NAME,1);r.onupgradeneeded=()=>{r.result.createObjectStore('keys');r.result.createObjectStore('files');const jobs=r.result.createObjectStore('jobs',{keyPath:'id'});jobs.createIndex('scope','scope')};
 r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Tanca les altres finestres de Freya i torna-ho a provar.'));
})}
function tx(db,name,mode,work){return new Promise((resolve,reject)=>{const t=db.transaction(name,mode);let result;const r=work(t.objectStore(name));r.onsuccess=()=>result=r.result;t.oncomplete=()=>resolve(result);t.onabort=t.onerror=()=>reject(t.error||Error('No s’ha pogut conservar la cua local.'))})}
async function key(db,user){
 const proposed=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 return new Promise((resolve,reject)=>{const t=db.transaction('keys','readwrite'),s=t.objectStore('keys'),r=s.get(user);let value;r.onsuccess=()=>{value=r.result||proposed;if(!r.result)s.add(value,user)};t.oncomplete=()=>resolve(value);t.onabort=t.onerror=()=>reject(t.error)});
}
async function seal(k,bytes,aad){const iv=crypto.getRandomValues(new Uint8Array(12));return {iv,data:await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},k,bytes)}}
const unseal=(k,v,aad)=>crypto.subtle.decrypt({name:'AES-GCM',iv:v.iv,additionalData:enc.encode(aad)},k,v.data);
export async function save(scope,job){
 const db=await open();try{
 const s=scopeKey(scope),old=await tx(db,'jobs','readonly',x=>x.get(job.id));
 if(old&&old.scope!==s)throw Error('Identitat local incompatible.');
 const k=await key(db,scope.userId),{file,preview,scope:ignored,...meta}=job;
 meta.fileInfo={name:file.name,size:file.size,type:file.type,lastModified:file.lastModified};
 const body=await seal(k,enc.encode(JSON.stringify(meta)),s+job.id);
 // Keep the original encrypted bytes; metadata updates never duplicate large files.
 const bytes=old?null:await seal(k,await file.arrayBuffer(),s+job.id+'file');
 await new Promise((resolve,reject)=>{const t=db.transaction(['files','jobs'],'readwrite');if(!old)t.objectStore('files').put(bytes,job.id);t.objectStore('jobs').put({id:job.id,scope:s,body,order:old?.order||Date.now()});t.oncomplete=resolve;t.onabort=t.onerror=()=>reject(t.error||Error('No s’ha pogut conservar la foto.'))});
 }finally{db.close()}
}
export async function load(scope){
 const db=await open();try{const s=scopeKey(scope),rows=await tx(db,'jobs','readonly',x=>x.index('scope').getAll(s));if(!rows.length)return [];
 const k=await key(db,scope.userId),jobs=[];
 for(const r of rows.sort((a,b)=>a.order-b.order)){
  const meta=JSON.parse(dec.decode(await unseal(k,r.body,s+r.id)));const fileInfo=meta.fileInfo;delete meta.fileInfo;
  // Lazy file read avoids decrypting 50 full originals into memory on recovery.
  jobs.push({...meta,scope:{...scope},file:{...fileInfo,arrayBuffer:async()=>{const d=await open();try{return await unseal(k,await tx(d,'files','readonly',x=>x.get(r.id)),s+r.id+'file')}finally{d.close()}}},preview:''});
 }return jobs;
 }finally{db.close()}
}
export async function remove(scope,id){const db=await open();try{const row=await tx(db,'jobs','readonly',x=>x.get(id));if(row?.scope===scopeKey(scope)){await new Promise((resolve,reject)=>{const t=db.transaction(['files','jobs'],'readwrite');t.objectStore('jobs').delete(id);t.objectStore('files').delete(id);t.oncomplete=resolve;t.onabort=t.onerror=()=>reject(t.error)})}}finally{db.close()}}
// Serializes tabs as well as clicks. Do not silently run concurrent upload workers.
export async function exclusive(scope,work){
 if(!navigator.locks?.request)throw Error('Aquest navegador no permet coordinar la cua. Actualitza Safari i torna-ho a provar.');
 return navigator.locks.request('freya-photos:'+scopeKey(scope),{ifAvailable:true},lock=>{if(!lock)throw Error('La cua està oberta en una altra finestra de Freya. Torna-ho a provar en acabar.');return work()});
}

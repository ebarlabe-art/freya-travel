// Bounded request decoding only; never persists document bytes or logs content.
export const MAX_TRANSIENT_REQUEST=14*1024*1024;
const fail=code=>{throw Object.assign(new Error(code),{code})};
export async function readImportRequest(request){
 if(Number(request.headers.get('content-length'))>MAX_TRANSIENT_REQUEST)fail('invalid_file_size');
 const reader=request.body?.getReader();if(!reader)fail('invalid_request');
 const chunks=[];let total=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_TRANSIENT_REQUEST){await reader.cancel();fail('invalid_file_size')}chunks.push(value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(total);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}
 try{return JSON.parse(new TextDecoder().decode(bytes))}catch{fail('invalid_request')}
}
export function decodeTransientFile(file){
 if(!file||typeof file!=='object'||Array.isArray(file)||Object.keys(file).some(k=>!['name','mime_type','base64'].includes(k))||typeof file.name!=='string'||!file.name.trim()||file.name.length>255||!['application/pdf','image/jpeg','image/png','image/webp'].includes(file.mime_type)||typeof file.base64!=='string'||!file.base64.length||file.base64.length>13981016||file.base64.length%4!==0||/[^A-Za-z0-9+/=]/.test(file.base64))fail('invalid_request');
 let text;try{text=atob(file.base64)}catch{fail('invalid_request')}
 if(!text.length||text.length>10*1024*1024)fail('invalid_file_size');
 return Uint8Array.from(text,c=>c.charCodeAt(0));
}

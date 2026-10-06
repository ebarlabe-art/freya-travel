// Bounded header inspection only: preservation never requires pixel decompression.
export const MAX_BYTES = 32 * 1024 * 1024;
export const MAX_PIXELS = 200_000_000;
export const MAX_SIDE = 32768;
export const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))).map(x=>x.toString(16).padStart(2,'0')).join('');
export function requireEdgeCapacity(info:{mime:string,width:number,height:number}) {
 // Keep the Edge boundary for authentication, source validation and immutable
 // original preservation only. Pixel decoding is delegated to the Railway
 // derivative worker so large phone photos cannot exhaust Edge CPU time.
 if(['image/heic','image/heif'].includes(info.mime))throw Error('DERIVATIVE_UNSUPPORTED');
 throw Error('DERIVATIVE_CAPACITY');
}
const text=(b:Uint8Array,a:number,n:number)=>new TextDecoder().decode(b.subarray(a,a+n));
export function inspectSource(b:Uint8Array) {
 if(!b.length||b.length>MAX_BYTES)throw Error('LIMIT_EXCEEDED');
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
 let mime='',ext='',width=0,height=0,orientation=1;
 try {
 if(b[0]===255&&b[1]===216&&b[2]===255){
  mime='image/jpeg';ext='jpg';let at=2,segments=0;
  while(at+4<=b.length&&++segments<4096){if(b[at++]!==255)throw Error();while(b[at]===255)at++;const marker=b[at++];if(marker===0xda||marker===0xd9)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
   const size=v.getUint16(at);if(size<2||at+size>b.length)throw Error();
   if([0xc0,0xc1,0xc2].includes(marker)){height=v.getUint16(at+3);width=v.getUint16(at+5);}
   if(marker===0xe1&&text(b,at+2,6)==='Exif\0\0')orientation=exifOrientation(b.subarray(at+8,at+size));
   at+=size;
  }
 }else if(b.subarray(0,8).join(',')==='137,80,78,71,13,10,26,10'){
  mime='image/png';ext='png';if(text(b,12,4)!=='IHDR'||v.getUint32(8)!==13)throw Error();width=v.getUint32(16);height=v.getUint32(20);
  let at=8,chunks=0;while(at+12<=b.length&&++chunks<65536){const size=v.getUint32(at),type=text(b,at+4,4);if(at+size+12>b.length)throw Error();if(type==='acTL')throw Error();if(type==='eXIf')orientation=exifOrientation(b.subarray(at+8,at+8+size));at+=size+12;}
 }else if(text(b,0,4)==='RIFF'&&text(b,8,4)==='WEBP'){
  mime='image/webp';ext='webp';if(v.getUint32(4,true)+8!==b.length)throw Error();let at=12,chunks=0;
  while(at+8<=b.length&&++chunks<65536){const type=text(b,at,4),size=v.getUint32(at+4,true),p=at+8;if(p+size>b.length)throw Error();
   if(type==='ANIM'||type==='ANMF')throw Error();
   if(type==='VP8X'){width=1+b[p+4]+b[p+5]*256+b[p+6]*65536;height=1+b[p+7]+b[p+8]*256+b[p+9]*65536;}
   if(type==='VP8 '&&!width){if(text(b,p+3,3)!=='\u009d\u0001*'&&!(b[p+3]===157&&b[p+4]===1&&b[p+5]===42))throw Error();width=v.getUint16(p+6,true)&16383;height=v.getUint16(p+8,true)&16383;}
   if(type==='VP8L'&&!width){if(b[p]!==47)throw Error();const bits=v.getUint32(p+1,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
   if(type==='EXIF')orientation=exifOrientation(b.subarray(p+(text(b,p,6)==='Exif\0\0'?6:0),p+size));at=p+size+(size%2);
  }
 }else if(text(b,4,4)==='ftyp'){
  const h=inspectHeif(b);({width,height,mime,ext}=h);orientation=0; // HEIF item transforms are retained, never guessed as EXIF.
 }else throw Error();
 }catch(error){if(error instanceof Error&&error.message==='LIMIT_EXCEEDED')throw error;throw Error('INVALID_IMAGE');}
 if(!width||!height)throw Error('INVALID_IMAGE');
 if(width>MAX_SIDE||height>MAX_SIDE||width*height>MAX_PIXELS)throw Error('LIMIT_EXCEEDED');
 return {mime,ext,width,height,orientation,byte_size:b.length};
}
function exifOrientation(b:Uint8Array){
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength);const little=text(b,0,2)==='II';if(!little&&text(b,0,2)!=='MM')throw Error();if(v.getUint16(2,little)!==42)throw Error();const at=v.getUint32(4,little),n=v.getUint16(at,little);if(n>1024||at+2+n*12>b.length)throw Error();
 for(let i=0;i<n;i++){const p=at+2+i*12;if(v.getUint16(p,little)===274){const o=v.getUint16(p+8,little);if(v.getUint16(p+2,little)!==3||v.getUint32(p+4,little)!==1||o<1||o>8)throw Error();return o;}}return 1;
}
function inspectHeif(b:Uint8Array){
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength);let count=0;
 type Box={type:string,start:number,end:number};
 const boxes=(start:number,end:number):Box[]=>{const out:Box[]=[];while(start<end){if(++count>10000||start+8>end)throw Error();let size=v.getUint32(start),head=8;if(size===1){const large=v.getBigUint64(start+8);if(large>BigInt(b.length))throw Error();size=Number(large);head=16;}if(size===0)size=end-start;if(size<head||start+size>end)throw Error();out.push({type:text(b,start+4,4),start:start+head,end:start+size});start+=size;}return out;};
 const top=boxes(0,b.length),ftyp=top.find(x=>x.type==='ftyp');if(!ftyp||ftyp.end-ftyp.start<8)throw Error();
 const brands=[text(b,ftyp.start,4)];for(let p=ftyp.start+8;p+4<=ftyp.end;p+=4)brands.push(text(b,p,4));
 if(brands.some(x=>['avif','avis','msf1','hevc','hevx'].includes(x))||!brands.some(x=>['heic','heix','heif','mif1'].includes(x)))throw Error();
 const meta=top.find(x=>x.type==='meta');if(!meta)throw Error();const children=boxes(meta.start+4,meta.end),pitm=children.find(x=>x.type==='pitm'),iprp=children.find(x=>x.type==='iprp');if(!pitm||!iprp)throw Error();const primary=b[pitm.start]===0?v.getUint16(pitm.start+4):v.getUint32(pitm.start+4);
 const properties=boxes(iprp.start,iprp.end),ipco=properties.find(x=>x.type==='ipco');if(!ipco)throw Error();const entries=boxes(ipco.start,ipco.end);let width=0,height=0;
 for(const ipma of properties.filter(x=>x.type==='ipma')){let p=ipma.start;const version=b[p],wide=(v.getUint32(p)&1)!==0;p+=4;const n=v.getUint32(p);p+=4;if(n>10000)throw Error();
  for(let i=0;i<n;i++){const item=version<1?v.getUint16(p):v.getUint32(p);p+=version<1?2:4;const associations=b[p++];for(let k=0;k<associations;k++){const index=wide?(v.getUint16(p)&32767):(b[p]&127);p+=wide?2:1;if(p>ipma.end)throw Error();const prop=entries[index-1];if(item===primary&&prop?.type==='ispe'){if(prop.end-prop.start!==12)throw Error();width=v.getUint32(prop.start+4);height=v.getUint32(prop.start+8);}}}
 }
 return {width,height,mime:brands.some(x=>x==='heic'||x==='heix')?'image/heic':'image/heif',ext:brands.some(x=>x==='heic'||x==='heix')?'heic':'heif'};
}

import {ImageMagick,MagickFormat,MagickReadSettings} from '@imagemagick/magick-wasm';
import {processImage,sha256,MAX_BYTES,inspectSource} from './image.ts';
const equal=(a:unknown,b:unknown)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`);};
const fixture=(format:MagickFormat,width=2000,height=1000)=>ImageMagick.read('xc:red',new MagickReadSettings({width,height}),im=>im.write(format,b=>Uint8Array.from(b)));
async function rejects(fn:()=>unknown,code?:string){try{await fn();}catch(e){if(code)equal((e as Error).message,code);return;}throw Error('Expected rejection');}
for(const format of [MagickFormat.Png,MagickFormat.Jpeg,MagickFormat.WebP])Deno.test(`real ${format}: original descriptor, dimensions, hash and stable visual derivatives`,async()=>{
 const bytes=fixture(format),r=await processImage(bytes),r2=await processImage(bytes),original=inspectSource(bytes);
 equal(r.source_hash,await sha256(bytes));equal([original.width,original.height],[2000,1000]);
 equal([r.preview.width,r.preview.height],[1600,800]);equal([r.thumbnail.width,r.thumbnail.height],[320,160]);
 for(const k of ['preview','thumbnail'] as const){equal(inspectSource(r[k].bytes).mime,'image/png');equal(await sha256(r[k].bytes),await sha256(r2[k].bytes));ImageMagick.read(r[k].bytes,im=>equal([im.width,im.height],[r[k].width,r[k].height]));}
});
Deno.test('EXIF orientation is applied to derivatives only, original EXIF/bytes retained',async()=>{
 const jpeg=fixture(MagickFormat.Jpeg,30,20);
 const exif=new Uint8Array([69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
 const bytes=new Uint8Array(jpeg.length+exif.length+4);bytes.set(jpeg.subarray(0,2));bytes.set([255,225,0,exif.length+2],2);bytes.set(exif,6);bytes.set(jpeg.subarray(2),6+exif.length);
 const before=await sha256(bytes),r=await processImage(bytes);equal(r.source_orientation,6);equal([r.preview.width,r.preview.height],[20,30]);equal([inspectSource(bytes).width,inspectSource(bytes).height],[30,20]);equal(await sha256(bytes),before);
 ImageMagick.read(r.preview.bytes,im=>{if(im.getProfile('exif'))throw Error('EXIF leaked');});
});
Deno.test('ICC colour profile survives derivation, descriptive EXIF does not',async()=>{
 const profile=await Deno.readFile(new URL('./fixtures/test-rgb.icc',import.meta.url));
 const bytes=ImageMagick.read('xc:red',new MagickReadSettings({width:80,height:40}),im=>{im.setProfile('icc',profile);im.setAttribute('comment','private GPS location');return im.write(MagickFormat.Png,b=>Uint8Array.from(b));});
 const r=await processImage(bytes);for(const image of [r.preview,r.thumbnail]){
  const v=new DataView(image.bytes.buffer);let standardICC=false;for(let at=8;at<image.bytes.length;at+=v.getUint32(at)+12)if(new TextDecoder().decode(image.bytes.subarray(at+4,at+8))==='iCCP')standardICC=true;equal(standardICC,true);
  ImageMagick.read(image.bytes,im=>{equal(Array.from(im.getProfile('icc')!.data),Array.from(profile));equal(im.getAttribute('comment'),null);});
 }
});
Deno.test('reject unsupported, excessive bytes and decompression bombs before decoding',async()=>{
 for(const b of [new TextEncoder().encode('<svg/>'),new Uint8Array(MAX_BYTES+1),pixelBomb()])await rejects(()=>inspectSource(b));
});
function pixelBomb(){const b=fixture(MagickFormat.Png,10,10),v=new DataView(b.buffer,b.byteOffset,b.byteLength);v.setUint32(16,30000);v.setUint32(20,30000);let crc=0xffffffff;for(const byte of b.subarray(12,29)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}v.setUint32(29,(crc^0xffffffff)>>>0);return b;}
Deno.test('12 MP mobile JPEG (>8 MP) is accepted and rendered',async()=>{const bytes=fixture(MagickFormat.Jpeg,4000,3000);equal(inspectSource(bytes).width,4000);const r=await processImage(bytes);equal([r.preview.width,r.preview.height],[1600,1200]);});
Deno.test('valid JPEG above 5 MiB is preserved and rendered without byte truncation',async()=>{
 // Valid APP15 segments simulate large non-product metadata, not bytes appended after EOI.
 const jpeg=fixture(MagickFormat.Jpeg,32,24),size=60000,count=90,bytes=new Uint8Array(jpeg.length+count*(size+4));bytes.set(jpeg.subarray(0,2));let at=2;
 for(let i=0;i<count;i++){bytes.set([255,239,(size+2)>>8,(size+2)&255],at);bytes.fill(65,at+4,at+4+size);at+=size+4;}bytes.set(jpeg.subarray(2),at);
 if(bytes.length<=5*1024*1024)throw Error('fixture too small');const digest=await sha256(bytes);equal(inspectSource(bytes).width,32);await processImage(bytes);equal(await sha256(bytes),digest);
});
Deno.test('48 MP original accepted; heavy decode is explicitly deferred',async()=>{
 // Header-only fixture tests the boundary, not a successful 48 MP pixel decode.
 const b=fixture(MagickFormat.Jpeg,40,30);let at=2;const v=new DataView(b.buffer,b.byteOffset,b.byteLength);while(at<b.length){const marker=b[at+1],size=v.getUint16(at+2);if(marker===0xc0||marker===0xc2){v.setUint16(at+5,6000);v.setUint16(at+7,8000);break;}at+=size+2;}
 equal(inspectSource(b).width*inspectSource(b).height,48_000_000);await rejects(()=>processImage(b),'DERIVATIVE_CAPACITY');
});
Deno.test('real HEIC primary dimensions preserved; explicit pending visual decoder',async()=>{const b=await Deno.readFile(new URL('./fixtures/red.heic',import.meta.url));const info=inspectSource(b);equal(info.mime,'image/heic');equal([info.width,info.height],[40,20]);await rejects(()=>processImage(b),'DERIVATIVE_UNSUPPORTED');});
Deno.test('HEIF compatible container retains its MIME and pending state',async()=>{const b=await Deno.readFile(new URL('./fixtures/red.heic',import.meta.url));const v=new DataView(b.buffer,b.byteOffset,b.byteLength);for(let at=8;at<v.getUint32(0);at+=4){if(at===12)continue;const brand=new TextDecoder().decode(b.subarray(at,at+4));if(brand==='heic'||brand==='heix')b.set(new TextEncoder().encode('mif1'),at);}equal(inspectSource(b).mime,'image/heif');await rejects(()=>processImage(b),'DERIVATIVE_UNSUPPORTED');});
for(const format of ['jpeg','png','webp','heic'] as const)Deno.test(`physical ${format}: byte-for-byte original, retries, gallery deletion`,async()=>{
 const {ingest}=await import('./handler.mjs'),root=await Deno.makeTempDir({prefix:'alb03-binary-'});
 const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const asset:any={id:id(1),trip_id:id(2),book_id:id(3),asset_key:id(4),version:1,status:'pending'};
 const job:any={source_path:'photo',lease_id:id(5)};const variants:any[]=[];
 const read=async(b:string,p:string)=>{try{return await Deno.readFile(root+'/'+b+'/'+p);}catch(e){if(e instanceof Deno.errors.NotFound)return null;throw e;}};
 const put=async(b:string,p:string,data:Uint8Array)=>{const file=root+'/'+b+'/'+p;await Deno.mkdir(file.slice(0,file.lastIndexOf('/')),{recursive:true});try{await Deno.writeFile(file,data,{createNew:true});}catch(e){if(!(e instanceof Deno.errors.AlreadyExists))throw e;}};
 try{
  const bytes=format==='heic'?await Deno.readFile(new URL('./fixtures/red.heic',import.meta.url)):fixture(({jpeg:MagickFormat.Jpeg,png:MagickFormat.Png,webp:MagickFormat.WebP})[format],40,20);
  await put('trip-documents','photo',bytes);
  const deps={assetId:asset.id,actor:id(6),auth:'Bearer local',hash:sha256,inspectSource,processImage,storage:{read,put},rpc:async(n:string,p:any)=>{
   if(n==='alb03_claim_v1')return {asset:{...asset},job:{...job},variants:[...variants]};
   if(p.p_error){equal(p.p_error,'DERIVATIVE_UNSUPPORTED');return;}
   const d=p.p_descriptor;for(const [kind,x] of Object.entries<any>(d)){const row={kind,content_hash:x.hash,storage_path:x.path,width_px:x.width,height_px:x.height,mime_type:x.mime,file_extension:x.ext,byte_size:x.byte_size,orientation:x.orientation};const prev=variants.find(v=>v.kind===kind);if(prev)equal(prev,row);else variants.push(row);}
   if(d.preview)Object.assign(asset,{status:'ready',content_hash:d.preview.hash,storage_path:d.preview.path,width_px:d.preview.width,height_px:d.preview.height});
  }};
  equal((await ingest(deps)).status,format==='heic'?'derivative_pending':'ready');
  const original=variants.find(v=>v.kind==='original');equal(Array.from((await read('travel-book',original.storage_path))!),Array.from(bytes));equal(original.content_hash,await sha256(bytes));
  await Deno.remove(root+'/trip-documents/photo');equal((await ingest(deps)).status,format==='heic'?'derivative_pending':'ready');equal(variants.length,format==='heic'?1:3);
 }finally{await Deno.remove(root,{recursive:true});}
});
Deno.test('noisy photographic-sized PNG above 5 MiB decodes without a size rejection',async()=>{
 const pixels=new Uint8Array(1600*1200*3);let state=1234567;for(let i=0;i<pixels.length;i++){state^=state<<13;state^=state>>>17;state^=state<<5;pixels[i]=state&255;}
 const b=ImageMagick.read(pixels,new MagickReadSettings({format:MagickFormat.Rgb,width:1600,height:1200,depth:8}),im=>im.write(MagickFormat.Png,b=>Uint8Array.from(b)));
 if(b.length<=5*1024*1024)throw Error('fixture should exceed old 5 MiB limit');const digest=await sha256(b),r=await processImage(b);equal([r.preview.width,r.preview.height],[1600,1200]);equal(await sha256(b),digest);
});

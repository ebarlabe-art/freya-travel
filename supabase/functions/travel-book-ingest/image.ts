import {ImageMagick, initializeImageMagick, MagickFormat, MagickReadSettings,ResourceLimits,ColorSpace} from '@imagemagick/magick-wasm';
import {inspectSource,sha256,requireEdgeCapacity} from './source.ts';
export {inspectSource,sha256,MAX_BYTES,MAX_PIXELS} from './source.ts';
const wasm = await Deno.readFile(new URL(import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.44/magick.wasm')));
await initializeImageMagick(wasm);
ResourceLimits.memory=128n*1024n*1024n;ResourceLimits.disk=0n;ResourceLimits.listLength=8n;ResourceLimits.maxProfileSize=4n*1024n*1024n;
// Larger originals are preserved without attempting an unbounded Edge decode.

export function detectFormat(bytes:Uint8Array){return ({'image/jpeg':MagickFormat.Jpeg,'image/png':MagickFormat.Png,'image/webp':MagickFormat.WebP,'image/heic':MagickFormat.Heic,'image/heif':MagickFormat.Heif} as Record<string,MagickFormat>)[inspectSource(bytes).mime];}
export async function processImage(bytes:Uint8Array){
 const original=inspectSource(bytes);
 requireEdgeCapacity(original);
 try {
 const settings=new MagickReadSettings({format:detectFormat(bytes)});
 // JPEG scaled IDCT bounds the pixel buffer before full decode, including 12 MP phones.
 if(original.mime==='image/jpeg'&&Math.max(original.width,original.height)>2048)settings.setDefine(MagickFormat.Jpeg,'size','2048x2048');
 const result=ImageMagick.read(bytes,settings,image=>{
  if(!new Set<number>([ColorSpace.sRGB,ColorSpace.RGB,ColorSpace.Gray]).has(image.colorSpace))throw Error('DERIVATIVE_COLOR');
  const profile=image.getProfile('icc')||image.getProfile('icm');
  const icc=profile?Uint8Array.from(profile.data):null;
  image.autoOrient();
  // Preserve ICC and pixel colour interpretation; remove descriptive/sensitive metadata only.
  for(const name of [...image.profileNames])if(!['icc','icm'].includes(name.toLowerCase())){const p=image.getProfile(name);if(p)image.removeProfile(p);}
  for(const name of [...image.attributeNames])image.removeAttribute(name);
  image.settings.setDefine(MagickFormat.Png,'exclude-chunks','date,time,exif');
  const resize=(bound:number)=>{const scale=Math.min(1,bound/Math.max(image.width,image.height));image.resize(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));if(icc)image.setProfile('icc',icc);return {bytes:image.write(MagickFormat.Png,data=>Uint8Array.from(data)),width:image.width,height:image.height};};
  return {preview:resize(1600),thumbnail:resize(320)};
 });
 return {...result,source_hash:await sha256(bytes),source_orientation:original.orientation};
 }catch(error){if(error instanceof Error&&error.message.startsWith('DERIVATIVE_'))throw error;throw Error('DERIVATIVE_FAILED');}
}

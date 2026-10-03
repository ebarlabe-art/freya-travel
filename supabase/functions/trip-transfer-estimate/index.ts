const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const ANON=Deno.env.get('SUPABASE_ANON_KEY')!;
const GEOAPIFY_API_KEY=Deno.env.get('GEOAPIFY_API_KEY')!;
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Content-Type':'application/json','Cache-Control':'private, max-age=300'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});

async function currentUser(auth:string){
  const r=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{Authorization:auth,apikey:ANON},signal:AbortSignal.timeout(8000)});
  if(!r.ok)return null;
  return (await r.json())?.id||null;
}
async function canReadTrip(auth:string,tripId:string){
  const url=new URL(SUPABASE_URL+'/rest/v1/trips');
  url.searchParams.set('select','id');url.searchParams.set('id','eq.'+tripId);url.searchParams.set('limit','1');
  const r=await fetch(url,{headers:{Authorization:auth,apikey:ANON,Accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(!r.ok)return false;const rows=await r.json();return Array.isArray(rows)&&rows.length===1;
}
async function geocode(text:string){
  const url=new URL('https://api.geoapify.com/v1/geocode/search');
  url.search=new URLSearchParams({text,limit:'1',format:'json',lang:'ca',apiKey:GEOAPIFY_API_KEY}).toString();
  const r=await fetch(url,{signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error(r.status===429?'rate_limited':'provider_unavailable');
  const body=await r.json();const p=body?.results?.[0];
  if(!p||!Number.isFinite(Number(p.lat))||!Number.isFinite(Number(p.lon)))throw Error('no_match');
  return {lat:Number(p.lat),lon:Number(p.lon),label:p.formatted||p.name||text,country_code:p.country_code?.toUpperCase()||null};
}
async function route(origin:any,destination:any){
  const url=new URL('https://api.geoapify.com/v1/routematrix');url.searchParams.set('apiKey',GEOAPIFY_API_KEY);
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'drive',sources:[{location:[origin.lon,origin.lat]}],targets:[{location:[destination.lon,destination.lat]}]}),signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error(r.status===429?'rate_limited':'provider_unavailable');
  const body=await r.json();const cell=body?.sources_to_targets?.[0]?.[0];
  if(!cell||!Number.isFinite(Number(cell.distance))||!Number.isFinite(Number(cell.time)))throw Error('no_route');
  return {distance_m:Number(cell.distance),drive_seconds:Number(cell.time)};
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return reply({});
  if(req.method!=='POST')return reply({error:'invalid_request'},405);
  try{
    const auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))return reply({error:'unauthorized'},401);
    if(!await currentUser(auth))return reply({error:'unauthorized'},401);
    const input=await req.json();
    if(typeof input.trip_id!=='string'||typeof input.origin!=='string'||typeof input.destination!=='string'||!input.origin.trim()||!input.destination.trim()||input.origin.length>500||input.destination.length>500)return reply({error:'invalid_request'},400);
    if(!await canReadTrip(auth,input.trip_id))return reply({error:'unavailable'},403);
    if(!GEOAPIFY_API_KEY)return reply({error:'provider_unavailable'},503);
    const [origin,destination]=await Promise.all([geocode(input.origin.trim()),geocode(input.destination.trim())]);
    const estimate=await route(origin,destination);
    return reply({...estimate,origin,destination,mode:'drive',quality:'approximate'});
  }catch(error){
    const code=error instanceof Error?error.message:'provider_unavailable';
    const status={rate_limited:429,no_match:422,no_route:422,provider_unavailable:503}[code]||500;
    return reply({error:code},status);
  }
});

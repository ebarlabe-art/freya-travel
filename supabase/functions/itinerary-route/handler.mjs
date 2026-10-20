import {destinationContext} from './provider.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ref=r=>r&&['manual','activity'].includes(r.type)&&uuid.test(r.id)&&typeof r.updated_at==='string';
export function createRouteHandler({authenticate,readTrip,readItem,readStops,provider,now=Date.now,maxPerMinute=20}){
 const budgets=new Map();
 const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info'}});
 return async req=>{
  if(req.method==='OPTIONS')return reply({});if(req.method!=='POST')return reply({error:'invalid_request'},405);
  try{
   const auth=req.headers.get('authorization'),user=await authenticate(auth);if(!user)return reply({error:'unauthorized'},401);
   const text=await req.text();if(text.length>4096)return reply({error:'invalid_request'},400);
   let input;try{input=JSON.parse(text)}catch{return reply({error:'invalid_request'},400)}
   if(!uuid.test(input?.trip_id)||!ref(input.origin)||!ref(input.destination)||!['walk','drive','transit'].includes(input.mode))return reply({error:'invalid_request'},400);
   // Revalidate membership even on cached routes. All reads use the caller's JWT/RLS.
   if(!await readTrip(auth,input.trip_id))return reply({error:'unavailable'},403);
   const [a,b,stops]=await Promise.all([readItem(auth,input.trip_id,input.origin),readItem(auth,input.trip_id,input.destination),readStops(auth,input.trip_id)]);
   if(!a||!b||[a,b].some(r=>r.trip_id!==input.trip_id||r.status==='cancelled'||r.reservation_status==='cancelled'||['transport','transport_activity'].includes(r.activity_type)))return reply({error:'unavailable'},403);
   if(a.updated_at!==input.origin.updated_at||b.updated_at!==input.destination.updated_at)return reply({error:'stale_record'},409);
   for(const choice of Object.values(input.choices||{}))if(typeof choice!=='string'||choice.length>500)return reply({error:'invalid_request'},400);
   const minute=Math.floor(now()/60000),budget=budgets.get(user);const used=budget?.minute===minute?budget.used:0;
   if(used>=maxPerMinute)return reply({error:'rate_limited'},429);
   if(budgets.size>1000)for(const [id,budget]of budgets)if(budget.minute!==minute)budgets.delete(id);
   if(!budgets.has(user)&&budgets.size>=1000)return reply({error:'rate_limited'},429);
   budgets.set(user,{minute,used:used+1});
   const origin=await provider.resolve(a,destinationContext(a,stops),input.choices?.origin,'last');
   const destination=await provider.resolve(b,destinationContext(b,stops),input.choices?.destination,'first');
   const safe=result=>result.point?{label:result.point.label}:result;
   if(!origin.point||!destination.point)return reply({status:'insufficient',origin:safe(origin),destination:safe(destination)});
   const route=await provider.route(origin.point,destination.point,input.mode);
   return reply({status:'ready',origin:safe(origin),destination:safe(destination),route});
  }catch(e){
   const code=['missing_context','missing_place','rate_limited','provider_unavailable','invalid_response','no_route','mode_unavailable'].includes(e.message)?e.message:'provider_unavailable';
   return reply({error:code},code==='rate_limited'?429:['no_route','mode_unavailable'].includes(code)?422:503);
  }
 };
}

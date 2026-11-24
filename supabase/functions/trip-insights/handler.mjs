import {insightScope,validateInsightReport} from '../../../domain/trip-insights.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createTripInsightsHandler({authorize,readTrip,readStops,generate,now=Date.now,maxDaily=8}){
 const budget=new Map();
 const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
 return async request=>{
  if(request.method==='OPTIONS')return reply({});
  if(request.method!=='POST')return reply({error:'invalid_request'},405);
  try{
   const auth=request.headers.get('authorization'),user=await authorize(auth);
   if(!user)return reply({error:'unauthorized'},401);
   const raw=await request.text();if(raw.length>600)return reply({error:'invalid_request'},400);
   let data;try{data=JSON.parse(raw)}catch{return reply({error:'invalid_request'},400)}
   if(!data||Object.keys(data).length!==1||!UUID.test(data.trip_id||''))return reply({error:'invalid_request'},400);
   // RLS-scoped reads. Do not accept names, countries, dates or costs from the caller.
   const trip=await readTrip(auth,data.trip_id);
   if(!trip||trip.id!==data.trip_id||trip.experience_key==='london-2026')return reply({error:'unavailable'},403);
   const stops=await readStops(auth,data.trip_id);
   if(!Array.isArray(stops))return reply({error:'source_unavailable'},503);
   const scope=insightScope({trip,stops});if(!scope)return reply({error:'unavailable'},403);
   if(!scope.destinations.length)return reply({error:'destination_unavailable'},422);
   const day=new Date(now()).toISOString().slice(0,10);
   const item=budget.get(user),used=item?.day===day?item.count:0;
   if(used>=maxDaily)return reply({error:'rate_limited'},429);
   if(budget.size>500)for(const [uid,b]of budget)if(b.day!==day)budget.delete(uid);
   budget.set(user,{day,count:used+1});
   const {report,sourceUrls}=await generate({destinations:scope.destinations,start_date:scope.start_date,end_date:scope.end_date});
   const checked=validateInsightReport({...report,checked_at:day},{sourceUrls:Array.isArray(sourceUrls)?sourceUrls:[]});
   return reply(checked);
  }catch(error){
   const code=['not_configured','rate_limited','source_unavailable','invalid_response','research_timeout'].includes(error?.message)?error.message:'research_unavailable';
   return reply({error:code},code==='rate_limited'?429:code==='invalid_response'?422:503);
  }
 };
}

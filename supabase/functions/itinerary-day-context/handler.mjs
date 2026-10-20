// Day editorial suggestions only. This endpoint never writes trip data.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date=/^\d{4}-\d{2}-\d{2}$/;
export function createDayContextHandler({authenticate,readTrip,generate,now=Date.now,maxDaily=10}){
 const limits=new Map();
 const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
 const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:cors});
 return async request=>{
  if(request.method==='OPTIONS')return json({});
  if(request.method!=='POST')return json({error:'invalid_request'},405);
  try{
   const auth=request.headers.get('authorization'),user=await authenticate(auth);
   if(!user)return json({error:'unauthorized'},401);
   const raw=await request.text();
   if(raw.length>7000)return json({error:'invalid_request'},400);
   let data;try{data=JSON.parse(raw)}catch{return json({error:'invalid_request'},400)}
   if(!data||!uuid.test(data.trip_id)||!date.test(data.local_date)||Object.keys(data).some(k=>!['trip_id','local_date','items','destination'].includes(k))||
      !Array.isArray(data.items)||!data.items.length||data.items.length>20||typeof data.destination!=='string'||data.destination.length>160||
      !data.items.every(p=>p&&typeof p.title==='string'&&p.title.trim().length>0&&p.title.length<=220&&
       (p.when===null||p.when===undefined||typeof p.when==='string'&&p.when.length<=48)&&(p.fixed===undefined||typeof p.fixed==='boolean')))return json({error:'invalid_request'},400);
   // Check the current caller's RLS membership BEFORE the paid model call.
   if(!await readTrip(auth,data.trip_id))return json({error:'unavailable'},403);
   const today=new Date(now()).toISOString().slice(0,10),prior=limits.get(user);
   const n=prior?.day===today?prior.count:0;
   if(n>=maxDaily)return json({error:'rate_limited'},429);
   if(limits.size>500)for(const [id,v]of limits)if(v.day!==today)limits.delete(id);
   limits.set(user,{day:today,count:n+1});
   const items=data.items.map(x=>({title:x.title.trim(),when:x.when||null,fixed:x.fixed===true}));
   const result=await generate({local_date:data.local_date,destination:data.destination.trim(),items});
   const title=typeof result?.title==='string'?result.title.trim():'';
   const summary=typeof result?.summary==='string'?result.summary.trim():'';
   if(!title||title.length>160||!summary||summary.length>1000)throw Error('invalid_response');
   // The model suggests VISIT durations only. It cannot validate a route or change a booking.
   // Each suggestion must match one input index; reject omissions and hallucinated extra stops.
   const visits=result?.visits;
   if(!Array.isArray(visits)||visits.length!==items.length)throw Error('invalid_response');
   const indices=new Set();
   for(const visit of visits){
    if(!visit||!Number.isInteger(visit.index)||visit.index<0||visit.index>=items.length||indices.has(visit.index)||
       !Number.isInteger(visit.minutes)||visit.minutes<10||visit.minutes>360||
       typeof visit.reason!=='string'||visit.reason.trim().length>160)throw Error('invalid_response');
    indices.add(visit.index);
   }
   return json({title,summary,visits:visits.map(v=>({index:v.index,minutes:v.minutes,reason:v.reason.trim()}))});
  }catch(e){
   const code=['not_configured','rate_limited','invalid_response'].includes(e?.message)?e.message:'provider_error';
   return json({error:code},code==='rate_limited'?429:code==='invalid_response'?502:503);
  }
 };
}

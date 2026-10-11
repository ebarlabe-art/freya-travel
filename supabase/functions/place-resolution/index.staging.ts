// STAGING ONLY. Do not deploy this entrypoint in production.
// Open-Meteo Free Geocoding is for non-commercial evaluation of Freya PROVES.
import {createPlaceHandler} from './handler.mjs';
import {placeConfig} from './config.mjs';
import {openMeteoAdapter} from './providers/open-meteo-staging.mjs';

const env=(key:string)=>Deno.env.get(key),config=placeConfig(env);
const url=env('SUPABASE_URL')!,service=env('SUPABASE_SERVICE_ROLE_KEY')!,anon=env('SUPABASE_ANON_KEY')!;
const stagingRef='waatqrqyddurultrazbn';
const resolvedProject=new URL(url).hostname;
if(resolvedProject!==stagingRef+'.supabase.co'||!service||!anon){
 throw Error('staging_only_project_mismatch');
}
Deno.serve(createPlaceHandler({
 config,
 tokenSecret:service,
 adapter:openMeteoAdapter({config}),
 authenticate:async(auth:string|null)=>{
  if(!auth?.startsWith('Bearer '))return null;
  const response=await fetch(url+'/auth/v1/user',{
   signal:AbortSignal.timeout(8000),
   headers:{Authorization:auth,apikey:anon}
  });
  if(!response.ok)return null;
  return (await response.json()).id;
 },
 rpc:async(name:string,args:unknown)=>{
  if(!['claim_place_query_v1','finish_place_query_v1','confirm_place_v1'].includes(name))
   throw Error('unexpected_rpc');
  const response=await fetch(url+'/rest/v1/rpc/'+name,{
   method:'POST',signal:AbortSignal.timeout(8000),
   headers:{Authorization:'Bearer '+service,apikey:service,'Content-Type':'application/json'},
   body:JSON.stringify(args)
  });
  const result=await response.json();
  if(!response.ok)throw Object.assign(Error(result.message==='rate_limited'?'rate_limited':'RPC failed'),{code:result.code});
  return result;
 }
}));

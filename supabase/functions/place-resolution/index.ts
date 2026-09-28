import {createPlaceHandler} from './handler.mjs';
import {placeConfig} from './config.mjs';
import {geoapifyAdapter} from './providers/geoapify.mjs';
const env=(key:string)=>Deno.env.get(key),config=placeConfig(env);
const url=env('SUPABASE_URL')!,service=env('SUPABASE_SERVICE_ROLE_KEY')!,anon=env('SUPABASE_ANON_KEY')!;
Deno.serve(createPlaceHandler({config,tokenSecret:service,adapter:geoapifyAdapter({key:env('GEOAPIFY_API_KEY'),config}),
 authenticate:async(auth:string|null)=>{if(!auth?.startsWith('Bearer '))return null;const r=await fetch(url+'/auth/v1/user',{signal:AbortSignal.timeout(8000),headers:{Authorization:auth,apikey:anon}});if(!r.ok)return null;return (await r.json()).id;},
 rpc:async(name:string,args:unknown)=>{const r=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',signal:AbortSignal.timeout(8000),headers:{Authorization:'Bearer '+service,apikey:service,'Content-Type':'application/json'},body:JSON.stringify(args)});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.message==='rate_limited'?'rate_limited':'RPC failed'),{code:data.code});return data;}
}));

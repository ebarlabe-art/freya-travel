import {RPC_TIMEOUT_MS} from './timing.mjs';
// Server entry: no fixtures, no frontend imports and no provider text in logs.
import {configuredCandidateGenerator} from './candidate-generator.mjs';
import {createProposalHandler} from './handler.mjs';
const url=Deno.env.get('SUPABASE_URL')!;
const publicKey=Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
Deno.serve(createProposalHandler({
 authenticate:async(authorization:string|null)=>{
  if(!authorization?.startsWith('Bearer '))return null;
  const response=await fetch(url+'/auth/v1/user',{signal:AbortSignal.timeout(RPC_TIMEOUT_MS),headers:{Authorization:authorization,apikey:publicKey}});
  if(!response.ok)return null;
  const user=await response.json();return typeof user.id==='string'?user.id:null;
 },
 rpc:async(name:string,args:unknown)=>{
  const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',signal:AbortSignal.timeout(RPC_TIMEOUT_MS),headers:{Authorization:'Bearer '+serviceKey,apikey:serviceKey,'Content-Type':'application/json'},body:JSON.stringify(args)});
  const result=await response.json();if(!response.ok){const error=new Error('RPC failed') as Error&{code?:string};error.code=result.code;throw error;}return result;
 },
 makeGenerator:(options:object)=>configuredCandidateGenerator((name:string)=>Deno.env.get(name),options),
 logAttempt:(record:unknown)=>console.info(JSON.stringify(record)),
}));

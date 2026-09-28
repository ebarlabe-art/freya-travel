import {placeConfig} from './config.mjs';
const enc=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export async function signCandidate(payload,secret){const body=JSON.stringify(payload),key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return {payload,signature:hex(await crypto.subtle.sign('HMAC',key,enc.encode(body)))};}
export async function verifyCandidate(token,owner,secret,now=Date.now()){
 if(!token?.payload||token.payload.owner!==owner||token.payload.expires<=now||typeof token.signature!=='string'||!/^[a-f0-9]{64}$/.test(token.signature))throw Error('invalid_candidate_token');
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']),sig=Uint8Array.from(token.signature.match(/../g),s=>parseInt(s,16));
 if(!await crypto.subtle.verify('HMAC',key,sig,enc.encode(JSON.stringify(token.payload))))throw Error('invalid_candidate_token');return token.payload;
}
export function createPlaceHandler({authenticate,rpc,adapter,tokenSecret,config=placeConfig(),now=Date.now}){
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Cache-Control':'no-store'}});
 return async request=>{
 if(request.method==='OPTIONS')return reply({});if(request.method!=='POST')return reply({error:'invalid_request'},405);
 try{
 const owner=await authenticate(request.headers.get('authorization'));if(!owner)return reply({error:'unauthorized'},401);
 const text=await request.text();if(text.length>8192)return reply({error:'invalid_request'},400);let input;try{input=JSON.parse(text)}catch{return reply({error:'invalid_request'},400)}
 if(input.action==='confirm'){
 const token=await verifyCandidate(input.candidate_token,owner,tokenSecret,now());
 if(!input.subject||!Number.isSafeInteger(input.expected_revision)||!Number.isSafeInteger(input.expected_brief_revision)||typeof input.operation_id!=='string')throw Error('invalid_request');
 return reply(await rpc('confirm_place_v1',{p_owner:owner,p_subject:input.subject,p_token:token.token,p_hash:token.query_hash,p_index:token.index,p_expected_revision:input.expected_revision,p_expected_brief_revision:input.expected_brief_revision,p_operation_id:input.operation_id,p_token_seconds:config.tokenSeconds}));
 }
 if(!['search','revalidate'].includes(input.action)||typeof input.text!=='string'||!input.text.trim()||input.text.length>500||!/^([a-z]{2})$/.test(input.language||'ca')||(input.country_code&&!/^[A-Z]{2}$/.test(input.country_code)))throw Error('invalid_request');
 const query={text:input.text.trim(),language:input.language||'ca',...(input.country_code?{country_code:input.country_code}:{})};
 const claim=await rpc('claim_place_query_v1',{p_owner:owner,p_query:query,p_config:config});if(claim.pending)return reply({error:'resolution_pending'},409);
 let results=claim.results;
 if(!claim.cached){results=await adapter.search(query);await rpc('finish_place_query_v1',{p_owner:owner,p_hash:claim.query_hash,p_token:claim.token,p_results:results,p_seconds:results.length?config.cacheSeconds:config.emptySeconds});}
 const candidates=await Promise.all(results.map(async(place,index)=>({place,candidate_token:await signCandidate({owner,query_hash:claim.query_hash,token:claim.token,index,expires:now()+config.tokenSeconds*1000},tokenSecret)})));
 return reply({state:candidates.length>1?'ambiguous':candidates.length?'needs_confirmation':'unresolved',candidates,...(!candidates.length?{error:'no_match'}:{})});
 }catch(error){const permitted=['invalid_request','invalid_candidate_token','provider_unavailable','rate_limited','invalid_response','no_match'];const code=permitted.includes(error.message)?error.message:error.code==='40001'?'conflict':error.code==='42501'?'unavailable':'provider_unavailable';return reply({error:code,...(error.retryAfter?{retry_after:error.retryAfter}:{})},code==='rate_limited'?429:code==='conflict'?409:code.startsWith('invalid')?400:503)}
 };
}

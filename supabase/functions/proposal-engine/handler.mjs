import {runProposalEngine} from './engine.mjs';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function createProposalHandler({authenticate,rpc,makeGenerator}){
 return async request=>{
  if(request.method==='OPTIONS')return new Response(null,{headers:cors});
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
  let owner,claim;
  try{
   owner=await authenticate(request.headers.get('Authorization'));if(!owner)return reply({error:'unauthorized'},401);
   const raw=await request.text();if(raw.length>4096)return reply({error:'invalid_request'},400);
   const body=JSON.parse(raw);
   if(!body||!['generate','retry'].includes(body.action)||!uuid(body.operation_id))return reply({error:'invalid_request'},400);
   const keys=body.action==='generate'?['action','brief_id','revision','operation_id']:['action','generation_id','operation_id'];
   if(Object.keys(body).some(k=>!keys.includes(k)))return reply({error:'invalid_request'},400);
   if(body.action==='generate'?(!uuid(body.brief_id)||!Number.isSafeInteger(body.revision)||body.revision<1):!uuid(body.generation_id))return reply({error:'invalid_request'},400);
   const generator=makeGenerator();const config=generator.configuration;
   const version=[config.provider,config.api,config.adapter_version,config.model].join(':');
   const generation=body.action==='generate'?await rpc('request_proposals_v1',{p_owner:owner,p_brief:body.brief_id,p_revision:body.revision,p_operation:body.operation_id,p_generator:version}):await rpc('retry_proposals_v1',{p_owner:owner,p_generation:body.generation_id,p_operation:body.operation_id});
   if(generation.generator_version!==version)return reply({error:'configuration_changed'},409);
   claim=await rpc('claim_proposal_generation_v1',{p_owner:owner,p_generation:generation.id});
   if(!claim)return reply({generation_id:generation.id,status:generation.status});
   const result=await runProposalEngine({snapshot:claim.brief_snapshot,generator});
   const finished=await rpc('finish_proposal_generation_v1',{p_owner:owner,p_generation:claim.id,p_token:claim.attempt_token,p_result:result});
   return reply({generation_id:finished.id,status:finished.status});
  }catch(error){
   if(claim)try{await rpc('fail_proposal_generation_v1',{p_owner:owner,p_generation:claim.id,p_token:claim.attempt_token,p_error:error.code??'engine_error'})}catch{}
   const code=error.code==='40001'?'brief_or_attempt_changed':error.code==='42501'?'unavailable':['openai_key_missing','candidate_model_missing'].includes(error.code)?'configuration_error':'generation_failed';
   return reply({error:code},code==='unavailable'?403:code==='brief_or_attempt_changed'?409:500);
  }
 };
}

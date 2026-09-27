import {validateCandidateBatch,ProposalError} from '../../../domain/trip-proposal.mjs';
import {resolveBriefDecision} from '../../../domain/trip-brief.mjs';
import {pendingFactualVerifier} from './factual-verifier.mjs';
export const ENGINE_VERSION='tb04-engine-v1';
export const POLICY_VERSION='tb04-policy-v1';
const normalize=value=>value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
export async function fingerprintCandidate(candidate){
 const s=candidate.route.stops;
 // Identity ignores generated IDs, marketing text, claim phrasing and block order.
 const identity={stops:s.map(x=>[normalize(x.destination),x.nights,x.start_date,x.end_date]),legs:candidate.route.legs.map(x=>[x.mode===null?null:normalize(x.mode),x.transit_nights])};
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(identity))))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function structural(decision,candidate,snapshot){
 const {stops,legs}=candidate.route;
 if(decision.field==='destination.multidestination'){
  // Distinct literal labels establish a design choice, not geographical identity.
  const multi=new Set(stops.map(s=>normalize(s.destination))).size>1;
  return {state:multi===decision.value?'satisfied':'violated',reason:'route_multidestination'};
 }
 if(decision.field==='dates'){
  const flexibility=resolveBriefDecision(snapshot,'dates.flexibility_days');
  if(flexibility?.decision.knowledge==='known'&&flexibility.decision.value>0)return {state:'unresolved',reason:'date_flexibility_requires_review'};
  const start=decision.value.start??decision.value.earliest,end=decision.value.end??decision.value.latest;
  if(stops.some(s=>(s.start_date!==null&&s.start_date<start)||(s.end_date!==null&&s.end_date>end)))return {state:'violated',reason:'dates_outside_brief'};
  // Missing travel-day/time-zone information cannot prove the entire trip fits.
  return {state:'unresolved',reason:'travel_dates_require_verification'};
 }
 if(decision.field==='duration'&&decision.value.unit==='nights'&&stops.every(s=>s.nights!==null)&&legs.every(l=>l.transit_nights!==null)){
  const nights=stops.reduce((n,s)=>n+s.nights,0)+legs.reduce((n,l)=>n+l.transit_nights,0);
  return {state:nights>=decision.value.min&&nights<=decision.value.max?'satisfied':'violated',reason:'route_nights'};
 }
 return {state:'unresolved',reason:'verification_required'};
}
function validEvidence(e,now){
 return e&&typeof e.source==='string'&&e.source.length<=200&&typeof e.locator==='string'&&/^https:\/\//.test(e.locator)&&Number.isFinite(Date.parse(e.observed_at))&&Date.parse(e.observed_at)<=now&&Number.isFinite(Date.parse(e.valid_until))&&Date.parse(e.valid_until)>now;
}
export async function evaluateCandidate(candidate,snapshot,verifier=pendingFactualVerifier,now=Date.now()){
 const verification=await verifier.verify({claims:structuredClone(candidate.claims),snapshot:structuredClone(snapshot),candidate:structuredClone(candidate),now});
 if(!Array.isArray(verification))throw new ProposalError('invalid_verifier_result');
 const verified=new Map();
 for(const item of verification){
  if(!candidate.claims.some(c=>c.id===item.claim_id)||verified.has(item.claim_id)||!['confirmed','probable','pending_verification'].includes(item.certainty))throw new ProposalError('invalid_verifier_result');
  const evidence=Array.isArray(item.evidence)?item.evidence.filter(e=>validEvidence(e,now)):[];
  const certainty=evidence.length?item.certainty:'pending_verification';
  verified.set(item.claim_id,{claim_id:item.claim_id,certainty,evidence,reason:certainty==='pending_verification'?'no_current_evidence':'authorized_evidence'});
 }
 const claims=candidate.claims.map(c=>verified.get(c.id)??{claim_id:c.id,certainty:'pending_verification',evidence:[],reason:'no_authorized_source'});
 // Every source decision is represented. Ambiguous/unbound scopes cannot disappear.
 const evaluations=[];
 for(const [id,decision] of Object.entries(snapshot.decisions)){
  const effective=resolveBriefDecision(snapshot,decision.field,decision.scope);
  let result={state:'unresolved',reason:'verification_required'};
  if(decision.knowledge!=='known')result={state:'unresolved',reason:decision.knowledge};
  else if(effective?.id!==id||effective.requiresConfirmation)result={state:'unresolved',reason:'requires_confirmation'};
  else if(decision.scope==='global')result=structural(decision,candidate,snapshot);
  // Factual evaluation is supplied ONLY by the trusted verifier, never Candidate.
  // Confirmed claims alone do not imply that they satisfy a decision.
  if(result.state==='unresolved'&&decision.knowledge==='known'&&effective?.id===id&&!effective.requiresConfirmation){
   const proofs=verification.filter(v=>v.decision_id===id&&v.scope===decision.scope&&candidate.claims.find(c=>c.id===v.claim_id)?.decision_ids.includes(id)&&['satisfied','violated'].includes(v.decision_state)&&verified.get(v.claim_id)?.certainty==='confirmed');
   if(proofs.length){result={state:proofs.some(v=>v.decision_state==='violated')?'violated':'satisfied',reason:'verified_decision'};}
  }
  evaluations.push({decision_id:id,field:decision.field,scope:decision.scope,strength:decision.strength??null,knowledge:decision.knowledge,...result});
 }
 return {schema_version:1,candidate:structuredClone(candidate),evaluations,verification:claims};
}
export async function runProposalEngine({snapshot,generator,verifier=pendingFactualVerifier,now=Date.now(),signal}){
 // Snapshot comes exclusively from the server's immutable DB generation row.
 const input=structuredClone(snapshot);
 const batch=validateCandidateBatch(await generator.generate({snapshot:structuredClone(input),signal}),input);
 const proposals=[],seen=new Set();let rejected=0;
 for(const candidate of batch.candidates){
  const document=await evaluateCandidate(candidate,input,verifier,now);
  if(document.evaluations.some(e=>e.strength==='hard'&&e.state==='violated')){rejected++;continue;}
  const fingerprint=await fingerprintCandidate(candidate);if(seen.has(fingerprint))continue;seen.add(fingerprint);
  proposals.push({fingerprint,document});
 }
 return {status:proposals.length?'completed':'no_results',result_reason:proposals.length?null:rejected===batch.candidates.length&&rejected>0?'incompatible':'insufficient_information',proposals};
}

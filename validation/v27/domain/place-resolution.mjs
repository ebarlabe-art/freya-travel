// Provider-neutral factual place boundary. No credentials or provider calls.
export const placeStates=Object.freeze(['unresolved','ambiguous','needs_confirmation','resolved','stale']);
export function primaryStop(candidate){return candidate.route.stops.find(s=>s.nights>0)?.id??null;}
export function placeLabel(p){return [p.canonical_name,p.administrative_area,p.country_code,p.kind].filter(Boolean).join(' · ');}
export function validIana(value){if(typeof value!=='string'||!value.trim())return false;try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return true}catch{return false}}
export function validatePlace(p){
 if(!p||typeof p!=='object'||typeof p.provider_place_id!=='string'||!p.provider_place_id||p.provider!=='geoapify'||typeof p.canonical_name!=='string'||!p.canonical_name.trim()||p.canonical_name.length>500||!Number.isFinite(p.latitude)||Math.abs(p.latitude)>90||!Number.isFinite(p.longitude)||Math.abs(p.longitude)>180)throw Error('invalid_response');
 if(p.country_code!==null&&!/^[A-Z]{2}$/.test(p.country_code))throw Error('invalid_response');
 if(!['representative_point','exact_location'].includes(p.coordinate_role)||!['verified','needs_specific_location','unavailable'].includes(p.timezone_status))throw Error('invalid_response');
 if(p.timezone_status==='verified'?!validIana(p.timezone):p.timezone!==null)throw Error('invalid_response');
 if(typeof p.source!=='string'||!p.source||typeof p.attribution!=='string'||!p.attribution)throw Error('invalid_response');return p;
}
export function inheritPlace({own,base,from,to,kind}){
 if(kind==='transport')return {origin:from?.timezone??null,destination:to?.timezone??null};
 const p=own??base;return {timezone:p?.timezone_status==='verified'?p.timezone:null,latitude:own?.coordinate_role==='exact_location'?own.latitude:null,longitude:own?.coordinate_role==='exact_location'?own.longitude:null,inherited:!own};
}
export class PlaceClient{
 constructor(client){this.client=client;}
 async invoke(action,payload){const {data,error}=await this.client.functions.invoke('place-resolution',{body:{action,...payload}});if(error||data?.error)throw Object.assign(Error(data?.error||'provider_unavailable'),{code:data?.error||'provider_unavailable'});return data;}
 searchPlaces(input){return this.invoke('search',input)}
 confirmPlace(input){return this.invoke('confirm',input)}
 revalidatePlace(input){return this.invoke('revalidate',input)}
 async getPlaceBinding(subject){const {data,error}=await this.client.rpc('get_place_bindings_v1',{p_subject:subject});if(error)throw error;return data;}
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function planTravelBookIngestion(documents){
 const seen=new Set(),planned=[];
 for(const row of Array.isArray(documents)?documents:[]){
  const id=row?.id;
  if(!UUID.test(id||'')||seen.has(id))continue;
  seen.add(id);planned.push(id);
 }
 return planned;
}

export function batchBackoffMs(attempt){
 const n=Math.max(0,Math.min(Number.isInteger(attempt)?attempt:0,5));
 return Math.min(8000,500*(2**n));
}

export function classifyTravelBookProcessResponse({status,body={}}){
 const code=body?.error||body?.detail||body?.status||'';
 if(status===200&&body?.status==='ready')return {state:'ready',retry:false};
 if(status===202&&body?.status==='derivative_pending')return {state:'derivative_pending',retry:false};
 if(status===401||status===403)return {state:'auth',retry:false};
 if(status===409||status===429||status===502||status===503||status===504)return {state:'transient',retry:true};
 if(status===422&&['STORAGE_ERROR','INGESTION_UNAVAILABLE'].includes(code))return {state:'transient',retry:true};
 return {state:'failed',retry:false};
}

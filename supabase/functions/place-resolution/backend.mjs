// PostgREST functions returning void succeed with HTTP 204, without JSON.
export function placeRpc({url,service,fetcher=fetch}){
 return async(name,args)=>{
  const response=await fetcher(url+'/rest/v1/rpc/'+name,{method:'POST',signal:AbortSignal.timeout(8000),
   headers:{Authorization:'Bearer '+service,apikey:service,'Content-Type':'application/json'},body:JSON.stringify(args)});
  if(response.ok&&response.status===204&&name==='finish_place_query_v1')return null;
  let data;
  try{data=await response.json()}catch{throw Error('invalid_response')}
  if(!response.ok)throw Object.assign(Error(data?.message==='rate_limited'?'rate_limited':'RPC failed'),{code:data?.code});
  return data;
 };
}

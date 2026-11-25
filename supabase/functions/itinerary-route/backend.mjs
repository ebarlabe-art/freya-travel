// Only caller-authorized reads. Never use a service-role key for trip content.
export function routeBackend({url,anon,fetcher=fetch}){
 async function get(path,auth,params={}){
  const endpoint=new URL(url+path);endpoint.search=new URLSearchParams(params).toString();
  const response=await fetcher(endpoint,{headers:{Authorization:auth,apikey:anon},signal:AbortSignal.timeout(8000)});
  if(!response.ok)return null;return response.json();
 }
 return {
  authenticate:async auth=>auth?.startsWith('Bearer ')?(await get('/auth/v1/user',auth))?.id:null,
  readTrip:async(auth,id)=>{const rows=await get('/rest/v1/trips',auth,{select:'id',id:'eq.'+id,limit:'1'});return Array.isArray(rows)&&rows.length===1},
  readStops:async(auth,id)=>{const rows=await get('/rest/v1/trip_stops',auth,{select:'canonical_name,country_code',trip_id:'eq.'+id,order:'position',limit:'20'});if(!Array.isArray(rows))throw Error('provider_unavailable');return rows},
  readItem:async(auth,tripId,ref)=>{
   const table=ref.type==='manual'?'trip_itinerary_items':'trip_activities';
   const fields=ref.type==='manual'?'location_name,status,title,resolved_location':'venue_name,reservation_status,activity_type,title,resolved_location,latitude,longitude';
   const filters={id:'eq.'+ref.id,trip_id:'eq.'+tripId,limit:'1'};
   const rows=await get('/rest/v1/'+table,auth,{select:'id,trip_id,address,city,updated_at,location_points,'+fields,...filters});
   const row=Array.isArray(rows)?rows[0]||null:null;
   // Only note-derived snapshots need notes, and only to validate the saved evidence.
   if(row?.location_points?.geographic_evidence||row?.location_points?.input?.geographic_evidence){
    const evidenceRows=await get('/rest/v1/'+table,auth,{select:'notes',...filters,updated_at:'eq.'+row.updated_at});
    if(!Array.isArray(evidenceRows)||evidenceRows.length!==1)return null;
    return {...row,notes:evidenceRows[0].notes??null};
   }
   return row;
  }
 };
}

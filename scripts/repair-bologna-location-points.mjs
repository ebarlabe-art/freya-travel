// One-off authenticated data repair, never bundled in the public application.
// Usage from an authenticated maintenance context:
//   await repairBolognaPoints(supabase, { dryRun: true })
//   await repairBolognaPoints(supabase, { dryRun: false })
// The client MUST carry the signed-in trip member's JWT, not a service-role key.
// Only location_points is written. No changes to trips, activities, bookings or dates.
const REPAIRS = [
  {id:'c83a3f25-328b-88f9-b7f2-67fd9306c899', remove:'via',
   keep:'la Torre dell’Orologio'},
  {id:'f8799ab9-f102-87c9-8f41-92a60c3bf93b', remove:'50. Recomanable reservar',
   keep:'Via San Felice'},
];
export async function repairBolognaPoints(supabase,{dryRun=true}={}){
  if(!supabase?.auth?.getUser)throw Error('Authenticated Supabase client required');
  const {data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)throw Error('Sign in to Freya Travel first');
  const results=[];
  for(const item of REPAIRS){
    const {data:row,error:readError}=await supabase.from('trip_itinerary_items')
      .select('id,trip_id,title,location_points').eq('id',item.id).single();
    if(readError||!row)throw Error('Cannot read target row: '+item.id);
    const {data:trip,error:tripError}=await supabase.from('trips')
      .select('id,name').eq('id',row.trip_id).single();
    if(tripError||trip?.name!=='Bolonya amb amigues')throw Error('Unexpected trip; refusing to write');
    const snapshot=row.location_points;
    if(snapshot?.version!==1||snapshot.points?.length!==2||
       snapshot.points[0]?.query!==item.keep||
       snapshot.points[1]?.query!==item.remove||
       snapshot.points[1]?.status!=='pending'||snapshot.points[1]?.place!==null)
      throw Error('Snapshot changed; refusing to overwrite '+item.id);
    const next={...snapshot,points:[snapshot.points[0]]};
    if(dryRun){results.push({id:item.id,action:'would remove false point',removed:item.remove});continue;}
    // Optimistic concurrency: refuse to overwrite a snapshot edited since read.
    const {data:updated,error:writeError}=await supabase.from('trip_itinerary_items')
      .update({location_points:next}).eq('id',item.id)
      .filter('location_points','eq',JSON.stringify(snapshot))
      .select('id,location_points');
    if(writeError||updated?.length!==1)throw Error('Update rejected or concurrent change: '+item.id+' '+(writeError?.message||''));
    if(updated[0].location_points.points.length!==1)throw Error('Readback verification failed');
    results.push({id:item.id,action:'removed false point',removed:item.remove});
  }
  return {dryRun,results};
}

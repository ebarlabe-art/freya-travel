// Synthetic transport only; never packaged into the public application.
export async function installCulturalGuideFixture({trips,manuals,documents}){
  // Real SDK with a strictly local endpoint; never inherit production auth/URL.
  const nativeFunctions=window.supabase.createClient(location.origin+'/freya-travel/fixture-api','sb_publishable_synthetic_fixture',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>{const url=new URL(typeof input==='string'?input:input.url);if(url.origin!==location.origin)throw Error('External fixture request blocked');return fetch(input,init)}}}).functions;
  window.fixture={manuals,documents,guides:trips.flatMap(t=>readOfflineTripSnapshot(t.id,t.owner_id)?.culturalGuides||[]),writes:[],geographyWrites:[],calls:[],mismatch:false};
  const pointsApi=await loadTravelBookModule('itinerary-place-points.mjs');
  db.rpc=async name=>({data:name==='get_my_trips'?trips:[],error:null});
  db.from=table=>{const filters={},state={};const q=new Proxy({}, {get:(_,key)=>key==='then'?async resolve=>{
   let rows=table==='trip_itinerary_items'?fixture.manuals:table==='trip_cultural_guides'?fixture.guides:table==='checklist_items'?['Reservar el pàrquing de l’aeroport','Guardar la planta i la plaça del cotxe','Fer una foto del lloc on hem aparcat','Preparar menjar i aigua per als dos gats','Netejar la sorra dels gats','Confirmar qui cuidarà els gats i deixar-li les claus'].map(text=>({trip_id:trips[2].id,text})):[];
   rows=rows.filter(row=>Object.entries(filters).every(([k,v])=>row[k]===v));
   if(state.patch){
    if(table==='trip_itinerary_items'){
     // Only the automatic no-match snapshot is allowed; no operational field or identity may change.
     const row=rows[0],snapshot=row&&pointsApi.pointSnapshot(row,pointsApi.extractActivityPoints(row));
     if(rows.length!==1||row.location_points!==null||Object.keys(state.patch).join()!=='location_points'||
        Object.keys(filters).sort().join()!=='id,trip_id,updated_at'||!filters.updated_at||
        !snapshot.points.length||snapshot.points.some(p=>p.place||p.status!=='pending')||
        !pointsApi.samePointSnapshot(state.patch.location_points,snapshot))throw Error('Unexpected operational write');
     fixture.geographyWrites.push({table,filters:{...filters},patch:structuredClone(state.patch)});
     Object.assign(row,structuredClone(state.patch),{updated_at:'2026-10-22T12:00:01Z'});
    }else{
     if(table!=='trip_cultural_guides')throw Error('Unexpected operational write');
     fixture.writes.push({table,filters:{...filters},patch:state.patch});rows.forEach(row=>Object.assign(row,state.patch,{revision:row.revision+1}));
    }
   }
   if(state.insert){if(table!=='trip_cultural_guides')throw Error('Unexpected insert');if(fixture.guides.some(row=>row.place_key===state.insert.place_key&&row.trip_id===state.insert.trip_id))return resolve({data:null,error:{code:'23505'}});const row={...state.insert,revision:1};fixture.guides.push(row);fixture.writes.push({table,insert:state.insert});rows=[row]}
   return resolve({data:state.single?rows[0]||null:rows,error:null});
  }:(...args)=>{if(key==='eq')filters[args[0]]=args[1];if(key==='update')state.patch=args[0];if(key==='insert')state.insert=args[0];if(key==='maybeSingle'||key==='single')state.single=true;if(['upsert','delete'].includes(key))throw Error('Unexpected '+key);return q}});return q};
  db.channel=()=>{const c={on:()=>c,subscribe:()=>c,unsubscribe:async()=>{}};return c};db.removeChannel=async()=>{};
  Object.defineProperty(db,'functions',{configurable:true,value:{invoke:async(name,{body})=>{
   if(fixture.http)return nativeFunctions.invoke(name,{body});
   if(name!=='cultural-guide')return {data:{candidates:[]},error:null};fixture.calls.push(body);if(fixture.delay)await fixture.delay;
   if(fixture.mismatch)return {data:{error:'identity_mismatch'},error:null};
   if(body.action==='prepare'&&body.place_key.includes('eivissa'))return {data:{confirmation_required:true,candidates:[{pageid:100,title:'Font sintètica Eivissa',language:'it'}]},error:null};
   return {data:body.action==='search'?{candidates:[{pageid:100,title:'Font sintètica '+body.place_key,language:body.language}]}:{document:fixture.documents.find(d=>d.place_key===body.place_key)},error:null};
  }}});
  await renderSession({access_token:'synthetic-offline-grant-token',user:{id:trips[0].owner_id,email:'synthetic@example.invalid'}});await selectTrip(trips[0].id,{open:true});
}

const kindMeta={
  flight:{group:'transport',label:'Vol',icon:'✈️',view:'genericFlightsView'},
  accommodation:{group:'accommodation',label:'Allotjament',icon:'🏨',view:'accommodationView'},
  activity:{group:'activity',label:'Activitat / transport local',icon:'🎟️',view:'activitiesView'},
};
const statusMeta={
  planning:{key:'planning',label:'Pendent de buscar'},
  reserved:{key:'reserved',label:'Reservat'},
  confirmed:{key:'confirmed',label:'Confirmat'},
  cancelled:{key:'cancelled',label:'Cancel·lat'},
};

function sourceKind(link){return link.flight_id?'flight':link.accommodation_id?'accommodation':link.activity_id?'activity':null}
function sourceId(link,kind){return kind==='flight'?link.flight_id:kind==='accommodation'?link.accommodation_id:link.activity_id}
function sourceStatus(row,kind){return kind==='flight'?row?.flight_status:row?.reservation_status}
function sourceTitle(row,kind){
  if(kind==='flight'){
    const main=[row?.airline,row?.flight_number].filter(Boolean).join(' ');
    const route=[row?.departure_airport_code||row?.departure_city,row?.arrival_airport_code||row?.arrival_city].filter(Boolean).join(' → ');
    return [main,route].filter(Boolean).join(' · ')||'Vol per concretar';
  }
  if(kind==='accommodation')return row?.name||'Allotjament per concretar';
  return row?.title||'Activitat per concretar';
}
function sourceNote(row){return String(row?.notes||'').trim()}
function costState(cost){
  if(!cost)return {key:'unknown',label:'Preu pendent'};
  if(cost.confirmed_amount!==null&&cost.confirmed_amount!==undefined)return {key:'confirmed',label:'Preu confirmat'};
  if(cost.expected_amount!==null&&cost.expected_amount!==undefined)return {key:'expected',label:'Preu previst'};
  return {key:'unknown',label:'Preu pendent'};
}
function money(amount,currency){
  if(amount===null||amount===undefined||!currency)return null;
  return {amount:Number(amount),currency:String(currency)};
}
export function projectBuild({links=[],costs=[],budget=null,flights=[],accommodations=[],activities=[],brief=null}={}){
  const rows={flight:new Map(flights.map(r=>[r.id,r])),accommodation:new Map(accommodations.map(r=>[r.id,r])),activity:new Map(activities.map(r=>[r.id,r]))};
  const byCost=new Map(costs.map(c=>[c.component_id,c]));
  const components=links.map(link=>{
    const kind=sourceKind(link);
    if(!kind)return null;
    const id=sourceId(link,kind),row=rows[kind].get(id)||{},cost=byCost.get(link.component_id)||null;
    const rawStatus=sourceStatus(row,kind)||'planning',status=statusMeta[rawStatus]||statusMeta.planning;
    const price=costState(cost);
    return {
      component_id:link.component_id,
      kind,
      group:kindMeta[kind].group,
      icon:kindMeta[kind].icon,
      kind_label:kindMeta[kind].label,
      view:kindMeta[kind].view,
      source_id:id,
      title:sourceTitle(row,kind),
      note:sourceNote(row),
      status,
      price_state:price,
      price:money(cost?.confirmed_amount??cost?.expected_amount,cost?.currency),
      unknown_required_costs:Array.isArray(cost?.unknown_required_costs)?cost.unknown_required_costs:[],
      excluded_costs:Array.isArray(cost?.excluded_costs)?cost.excluded_costs:[],
      search_seed:kind==='flight'?{
        origin:row?.departure_airport_code||row?.departure_city||'',
        destination:row?.arrival_airport_code||row?.arrival_city||'',
        departure_at:row?.departure_at||null,
        departure_time_zone:row?.departure_time_zone||null,
      }:null,
    };
  }).filter(Boolean);
  const groups=[
    {key:'transport',label:'Transport',icon:'✈️'},
    {key:'accommodation',label:'Allotjament',icon:'🏨'},
    {key:'activity',label:'Activitats i transport local',icon:'🎟️'},
  ].map(group=>({...group,components:components.filter(c=>c.group===group.key)})).filter(group=>group.components.length);
  return {
    components,
    groups,
    budget:budget||{currencies:[],settings:null,total_components:components.length,unknown_components:components.length,unknown_required_costs:0,provisional:true},
    brief,
    counts:{
      total:components.length,
      confirmed:components.filter(c=>c.status.key==='confirmed').length,
      reserved:components.filter(c=>c.status.key==='reserved').length,
      cancelled:components.filter(c=>c.status.key==='cancelled').length,
      pending:components.filter(c=>c.status.key==='planning').length,
    },
  };
}

export async function loadBuild(client,tripId){
  const [links,costs,budget,flights,accommodations,activities,brief]=await Promise.all([
    client.from('trip_proposal_component_links').select('component_id,trip_id,accommodation_id,flight_id,activity_id').eq('trip_id',tripId),
    client.from('trip_component_costs').select('component_id,expected_amount,confirmed_amount,currency,unknown_required_costs,excluded_costs').eq('trip_id',tripId),
    client.rpc('get_trip_budget_v1',{p_trip_id:tripId}),
    client.from('trip_flights').select('id,airline,flight_number,departure_airport_code,departure_city,arrival_airport_code,arrival_city,departure_at,departure_time_zone,flight_status,notes').eq('trip_id',tripId),
    client.from('trip_accommodations').select('id,name,reservation_status,notes').eq('trip_id',tripId),
    client.from('trip_activities').select('id,title,activity_type,reservation_status,notes').eq('trip_id',tripId),
    client.from('trip_briefs').select('document').eq('trip_id',tripId).maybeSingle(),
  ]);
  for(const result of [links,costs,budget,flights,accommodations,activities,brief])if(result.error)throw result.error;
  return projectBuild({links:links.data||[],costs:costs.data||[],budget:budget.data||null,flights:flights.data||[],accommodations:accommodations.data||[],activities:activities.data||[],brief:brief.data?.document||null});
}

import {resolveBriefDecision} from './trip-brief.mjs';

const CABINS=new Set(['economy','premium_economy','business','first']);
const STRENGTHS=new Set(['hard','preference','flexible']);

function explicitKnown(document,field,scope='global'){
  const resolved=resolveBriefDecision(document,field,scope);
  const d=resolved?.decision;
  if(!d||resolved.requiresConfirmation||d.origin!=='explicit_user'||d.knowledge!=='known')return null;
  return {decision_id:resolved.id,strength:d.strength,value:structuredClone(d.value)};
}
function onePlace(entry,code,blockers){
  const places=entry?.value?.places;
  if(!entry||!Array.isArray(places)||places.length!==1){
    blockers.push({code,field:code==='origin_required'?'origin':'destination'});
    return null;
  }
  return places[0];
}
function flightPreference(document,field,key){
  const d=explicitKnown(document,field);
  return d?{key,decision_id:d.decision_id,strength:d.strength,value:d.value}:null;
}
function flightPreferences(document){
  const preferences=[
    flightPreference(document,'flight.max_stops','max_stops'),
    flightPreference(document,'flight.max_duration_minutes','max_duration_minutes'),
    flightPreference(document,'flight.alternative_airports','alternative_airports'),
    flightPreference(document,'flight.low_cost','low_cost'),
    flightPreference(document,'flight.departure_window','departure_window'),
    flightPreference(document,'flight.arrival_window','arrival_window'),
  ].filter(Boolean);
  if(preferences.some(p=>!STRENGTHS.has(p.strength)))throw new Error('Invalid search preference strength');
  return preferences;
}
function briefTravelers(document,blockers){
  const travelers=Object.values(document.travelers);
  const adults=travelers.filter(t=>t.kind==='adult').length;
  const children=travelers.filter(t=>t.kind==='child');
  if(!travelers.length||adults<1)blockers.push({code:'adult_traveler_required',field:'travelers'});
  if(adults>8||children.length>8)blockers.push({code:'too_many_travelers',field:'travelers'});
  const childrenAges=[];
  for(const child of children){
    if(!Number.isInteger(child.age))blockers.push({code:'child_age_required',field:'travelers'});
    else childrenAges.push(child.age);
  }
  return {adults,childrenAges};
}
function searchCulture(blockers,{market,locale,currency,cabin}={}){
  searchCulture(blockers,{market,locale,currency,cabin});
}
const ISO_DATE=/^20\d{2}-\d{2}-\d{2}$/;
function validDate(value){if(typeof value!=='string'||!ISO_DATE.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value}

export function compileFlightSearchFromBrief(document,{market,locale,currency,cabin}={}){
  if(!document||typeof document!=='object'||!document.decisions||!document.scopes||!document.travelers)throw new Error('Invalid Trip Brief document');
  const blockers=[];
  if(typeof market!=='string'||!/^[A-Z]{2}$/.test(market))blockers.push({code:'market_required',field:'market'});
  if(typeof locale!=='string'||!/^[a-z]{2}-[A-Z]{2}$/.test(locale))blockers.push({code:'locale_required',field:'locale'});
  if(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency))blockers.push({code:'currency_required',field:'currency'});
  if(!CABINS.has(cabin))blockers.push({code:'cabin_required',field:'cabin'});

  const origin=onePlace(explicitKnown(document,'origin'),'origin_required',blockers);
  const destinationDecision=explicitKnown(document,'destination');
  let destination=null;
  if(!destinationDecision||destinationDecision.value?.mode!=='known')blockers.push({code:'destination_required',field:'destination'});
  else destination=onePlace(destinationDecision,'destination_required',blockers);

  const dates=explicitKnown(document,'dates');
  let startDate=null,endDate=null;
  if(!dates)blockers.push({code:'dates_required',field:'dates'});
  else if(dates.value.mode!=='exact')blockers.push({code:'exact_dates_required',field:'dates'});
  else {startDate=dates.value.start;endDate=dates.value.end;}

  const {adults,childrenAges}=briefTravelers(document,blockers);
  const preferences=flightPreferences(document);

  return {
    ready:blockers.length===0,
    blockers,
    query:blockers.length?null:{
      origin,destination,start_date:startDate,end_date:endDate,trip_type:'round_trip',
      adults,children_ages:childrenAges,cabin,services:['flights'],
      market,locale,currency,preferences,
    },
  };
}


export function compileFlightLegSearch(document,{origin,destination,startDate,adults,childrenAges=[],market,locale,currency,cabin}={}){
  if(!document||typeof document!=='object'||!document.decisions||!document.scopes||!document.travelers)throw new Error('Invalid Trip Brief document');
  const blockers=[];
  searchCulture(blockers,{market,locale,currency,cabin});
  const cleanOrigin=typeof origin==='string'?origin.trim():'';
  const cleanDestination=typeof destination==='string'?destination.trim():'';
  if(!cleanOrigin)blockers.push({code:'origin_required',field:'origin'});
  if(!cleanDestination)blockers.push({code:'destination_required',field:'destination'});
  if(!validDate(startDate))blockers.push({code:'dates_required',field:'dates'});
  const adultCount=Number(adults),ages=Array.isArray(childrenAges)?childrenAges.map(Number):[];
  if(!Number.isInteger(adultCount)||adultCount<1||adultCount>8)blockers.push({code:'adult_traveler_required',field:'travelers'});
  if(ages.length>8||ages.some(age=>!Number.isInteger(age)||age<0||age>17))blockers.push({code:'child_age_required',field:'travelers'});
  const preferences=flightPreferences(document);
  return {
    ready:blockers.length===0,
    blockers,
    query:blockers.length?null:{
      origin:cleanOrigin,destination:cleanDestination,start_date:startDate,end_date:null,trip_type:'one_way',
      adults:adultCount,children_ages:ages,cabin,services:['flights'],
      market,locale,currency,preferences,
    },
  };
}

export function flightSearchDefaultsFromBrief(document){
  if(!document||typeof document!=='object'||!document.decisions||!document.scopes||!document.travelers)throw new Error('Invalid Trip Brief document');
  const blockers=[];
  const {adults,childrenAges}=briefTravelers(document,blockers);
  return {adults,children_ages:childrenAges,children_count:Object.values(document.travelers).filter(t=>t.kind==='child').length,preferences:flightPreferences(document),traveler_blockers:blockers};
}

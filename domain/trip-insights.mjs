// A4.1 · Contextual Freya Insights. Curated official entry points only.
// No remote calls, personal-document inference, or claims that entry requirements
// are permanently current. Check each authority again before departure.
export const INSIGHTS_SOURCE_DATE='2026-11-24';

const GUIDES=Object.freeze({
  GB:{
    country:'Regne Unit',
    items:[
      {id:'entry',icon:'🛂',title:'Documents i entrada',detail:'Consulta segons la nacionalitat i el motiu del viatge si cal visat o autorització ETA. No ho donis per resolt sense comprovar-ho.',source:'GOV.UK',url:'https://www.gov.uk/check-uk-visa'},
      {id:'transport',icon:'🚇',title:'Transport a Londres',detail:'Revisa contactless, Oyster i les condicions i tarifes vigents del transport públic abans de decidir què comprar.',source:'Transport for London',url:'https://tfl.gov.uk/fares/ways-to-pay/pay-as-you-go'}
    ]
  },
  JP:{
    country:'Japó',
    items:[
      {id:'entry',icon:'🛂',title:'Visit Japan Web',detail:'Consulta l’eina oficial per preparar els tràmits d’immigració i duanes. Revisa també els requisits d’entrada aplicables al teu passaport.',source:'Agència Digital del Japó',url:'https://www.digital.go.jp/en/policies/visit_japan_web'},
      {id:'practical',icon:'🗾',title:'Informació del viatge',detail:'Consulta la guia turística oficial per preparar transports, serveis i visites segons les destinacions del recorregut.',source:'JNTO',url:'https://www.japan.travel/en/'}
    ]
  },
  LK:{
    country:'Sri Lanka',
    items:[
      {id:'entry',icon:'🛂',title:'ETA i entrada',detail:'Comprova els requisits i el procediment vigent d’autorització de viatge segons la nacionalitat i les dates. No pressuposis cap exempció.',source:'Sri Lanka ETA oficial',url:'https://www.eta.gov.lk/slvisa/'},
      {id:'practical',icon:'🌿',title:'Visites i activitats',detail:'Consulta les orientacions oficials de turisme abans de confirmar rutes, parcs i activitats.',source:'Sri Lanka Tourism',url:'https://www.srilanka.travel/'}
    ]
  }
});

function localDay(date){
  if(!(date instanceof Date)||!Number.isFinite(date.getTime()))return null;
  const n=v=>String(v).padStart(2,'0');
  return date.getFullYear()+'-'+n(date.getMonth()+1)+'-'+n(date.getDate());
}

export function buildTripInsights({trip,stops=[],now=new Date()}={}){
  if(!trip||trip.experience_key==='london-2026')return null;
  const today=localDay(now);
  if(!today)return null;
  const phase=trip.end_date&&today>trip.end_date?'past':trip.start_date&&today>=trip.start_date?'during':'before';
  if(phase==='past')return {phase,entries:[],unsupported:[],asOf:INSIGHTS_SOURCE_DATE};

  const codes=[...new Set((Array.isArray(stops)?stops:[]).map(stop=>String(stop?.country_code||'').toUpperCase().trim()).filter(code=>/^[A-Z]{2}$/.test(code)).map(code=>code==='UK'?'GB':code))];
  const entries=codes.filter(code=>GUIDES[code]).map(code=>({
    code,
    country:GUIDES[code].country,
    items:GUIDES[code].items.map(item=>({...item}))
  }));
  return {phase,entries,unsupported:codes.filter(code=>!GUIDES[code]),asOf:INSIGHTS_SOURCE_DATE,unknownDestination:codes.length===0};
}

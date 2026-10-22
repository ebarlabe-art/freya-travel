import {savedActivityPoints,validPointPlace,normalizePointName} from './itinerary-place-points.mjs';
export const GUIDE_SECTIONS={history:'Història',context:'Context',curiosities:'Curiositats',highlights:'Punts d’interès',practical:'Informació pràctica',suggestions:'Suggeriments de visita'};
export function culturalName(value){return normalizePointName(value).replace(/^(?:basilica|palazzo|palau|church|chiesa) /,'').trim()}
export function guidePlaceKey(p){if(!validPointPlace(p))throw Error('Cal una ubicació verificada.');return p.provider+':'+p.provider_place_id}
export function culturalPlaces(row){
 const points=savedActivityPoints(row);
 const candidates=points?points.filter(p=>p.place&&p.status!=='pending').map(p=>({query:p.query,place:p.place})):row.resolved_location&&(row.resolved_location.location_name??null)===(row.location_name||row.venue_name||null)&&['title','address','city'].every(k=>(row.resolved_location[k]??null)===(row[k]??null))?[{query:row.title,place:row.resolved_location.place}]:[];
 const seen=new Set();return candidates.filter(({query,place})=>{
  if(!validPointPlace(place)||!['exact_location','representative_point'].includes(place.coordinate_role)||culturalName(query)!==culturalName(place.canonical_name))return false;
  const key=guidePlaceKey(place);if(seen.has(key))return false;seen.add(key);return true;
 }).map(({place})=>Object.fromEntries(['provider','provider_place_id','canonical_name','latitude','longitude','country_code','locality','kind','coordinate_role','attribution'].map(k=>[k,place[k]??null])));
}
export function sourceMatchesPlace(place,source){
 if(!validPointPlace(place)||!source||!Array.isArray(source.names)||!source.names.some(name=>culturalName(name)===culturalName(place.canonical_name)))return false;
 if(!Number.isFinite(source.latitude)||!Number.isFinite(source.longitude))return false;
 const north=(place.latitude-source.latitude)*111195,east=(place.longitude-source.longitude)*111195*Math.cos(place.latitude*Math.PI/180);
 return Math.hypot(north,east)<2000;
}
export function emptyCulturalGuide(place){
 return {version:1,language:'ca',place_key:guidePlaceKey(place),sections:Object.fromEntries(Object.keys(GUIDE_SECTIONS).map(k=>[k,{text:'',origin:'user',evidence:[]}])),sources:[]};
}
export function validateCulturalGuide(value,placeKey){
 if(!value||value.version!==1||value.language!=='ca'||value.place_key!==placeKey||!value.sections||!Array.isArray(value.sources)||value.sources.length>8)throw Error('Fitxa cultural no vàlida.');
 if(Object.keys(value).some(k=>!['version','language','place_key','sections','sources'].includes(k))||Object.keys(value.sections).length!==6)throw Error('Camps culturals no vàlids.');
 const ids=new Set();for(const source of value.sources){
  if(!source||Object.keys(source).some(k=>!['id','title','excerpt','url','license'].includes(k))||typeof source.id!=='string'||source.id.length>120||ids.has(source.id)||typeof source.title!=='string'||source.title.length>300||typeof source.excerpt!=='string'||source.excerpt.length>18000||typeof source.url!=='string'||!/^https:\/\/(?:ca|it|en)\.wikipedia\.org\/w\/index\.php\?oldid=\d+$/.test(source.url)||typeof source.license!=='string'||source.license.length>200)throw Error('Font cultural no vàlida.');ids.add(source.id);
 }
 for(const key of Object.keys(GUIDE_SECTIONS)){
  const section=value.sections[key];if(!section||typeof section.text!=='string'||section.text.length>4000||!['source','proposal','user'].includes(section.origin)||!Array.isArray(section.evidence)||section.evidence.length>8||Object.keys(section).some(k=>!['text','origin','evidence'].includes(k)))throw Error('Secció cultural no vàlida.');
  if(section.origin!=='user'&&section.text.trim()&&!section.evidence.length)throw Error('Falten les fonts de la secció.');
  for(const evidence of section.evidence){if(!evidence||Object.keys(evidence).some(k=>!['source_id','quote'].includes(k)))throw Error('Cita no vàlida.');const source=value.sources.find(s=>s.id===evidence.source_id);if(!source||typeof evidence.quote!=='string'||!evidence.quote.trim()||!source.excerpt.includes(evidence.quote))throw Error('La cita no correspon a la font.');if(section.origin==='source'&&section.text.trim()&&!source.excerpt.includes(section.text))throw Error('El text no és una transcripció de la font.');}
 }
 return structuredClone(value);
}
export function guideProposal(place,article,sections){
 if(!sourceMatchesPlace(place,article))throw Error('La font no correspon exactament al lloc.');
 const doc=emptyCulturalGuide(place),source={id:article.language+':'+article.pageid+':'+article.revision,title:article.title,url:`https://${article.language}.wikipedia.org/w/index.php?oldid=${article.revision}`,license:'Wikipedia · CC BY-SA 4.0 · consulta l’historial per als autors',excerpt:article.extract.slice(0,18000)};
 doc.sources=[source];for(const key of Object.keys(GUIDE_SECTIONS)){
  const section=sections[key];if(!section||typeof section.text!=='string'||typeof section.quote!=='string')throw Error('Proposta cultural incompleta.');
  doc.sections[key]={text:section.text,origin:'proposal',evidence:section.text.trim()?[{source_id:source.id,quote:section.quote}]:[]};
 }
 return validateCulturalGuide(doc,doc.place_key);
}
export function culturalNarration(document){
 validateCulturalGuide(document,document.place_key);
 return Object.entries(GUIDE_SECTIONS).flatMap(([k,label])=>document.sections[k].text.trim()?[label+'. '+document.sections[k].text]:[]).join('\n\n');
}
// Explicit editorial snapshot. No booking, itinerary notes, contacts or personal documents.
export function culturalTravelBookSnapshot(row){
 const document=validateCulturalGuide(row.document,row.place_key);
 return {kind:'cultural_guide',source_id:row.id,revision:row.revision,place_key:row.place_key,place_label:row.place.canonical_name,language:'ca',sections:document.sections,sources:document.sources};
}

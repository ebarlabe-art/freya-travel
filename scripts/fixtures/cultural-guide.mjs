import {pointSnapshot} from '../../domain/itinerary-place-points.mjs';
import {GUIDE_SECTIONS,guidePlaceKey} from '../../domain/cultural-guide.mjs';
export const cultureId=n=>'16700000-0000-4000-8000-'+String(n).padStart(12,'0');
// Names and geography deliberately close: proximity must never substitute identity.
export const bolognaPlaces=['Piazza Maggiore','Fontana del Nettuno','Basilica di San Petronio','Archiginnasio','Teatro Anatomico'].map((name,i)=>({canonical_name:name,provider:'geoapify',provider_place_id:'synthetic-bologna-'+i,country_code:'IT',locality:'Bologna',kind:i===0?'square':'building',coordinate_role:i===0?'representative_point':'exact_location',latitude:44.493+i*.0001,longitude:11.343,attribution:'Synthetic test fixture'}));
export function cultureRow(place,i=0,tripId=cultureId(1)){
 const row={id:cultureId(20+i),trip_id:tripId,title:place.canonical_name,timing_kind:'date',local_date:'2026-12-27',location_name:place.canonical_name,address:null,city:place.locality,status:'planned',is_fixed:false,is_optional:false,sort_order:i,updated_at:'2026-10-22T12:00:00Z'};
 row.location_points=pointSnapshot(row,[{id:'point-0',query:place.canonical_name,place}]);return row;
}
export function culturalArticle(place,i=0){return {pageid:100+i,revision:500+i,title:place.canonical_name,language:'it',names:[place.canonical_name],latitude:place.latitude,longitude:place.longitude,extract:'Fonte sintetica esclusiva di '+place.canonical_name+'. Questo è un dato di prova, senza affermazioni storiche reali.'}}
export function proposedSections(article){return Object.fromEntries(Object.keys(GUIDE_SECTIONS).map(k=>[k,{text:k==='suggestions'?'Suggeriment sintètic per a '+article.title:'Text sintètic en català sobre '+article.title+'. Aquesta és una dada de prova, no història real.',quote:article.extract}]))}
export function storedGuide(place,document,i=0,tripId=cultureId(1)){return {id:cultureId(70+i),trip_id:tripId,place_key:guidePlaceKey(place),place,document,revision:1,created_by:cultureId(9),updated_by:cultureId(9),created_at:'2026-10-22T12:00:00Z',updated_at:'2026-10-22T12:00:00Z'}}

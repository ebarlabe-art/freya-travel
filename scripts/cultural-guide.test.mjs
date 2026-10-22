import test from 'node:test';import assert from 'node:assert/strict';
import {culturalPlaces,guidePlaceKey,sourceMatchesPlace,emptyCulturalGuide,validateCulturalGuide,guideProposal,culturalNarration,culturalTravelBookSnapshot} from '../domain/cultural-guide.mjs';
import {createCulturalGuideHandler} from '../supabase/functions/cultural-guide/handler.mjs';
import {readCulturalArticle,searchCulturalArticles} from '../supabase/functions/cultural-guide/provider.mjs';
import {bolognaPlaces,cultureId,cultureRow,culturalArticle,proposedSections,storedGuide} from './fixtures/cultural-guide.mjs';
for(const [i,place]of bolognaPlaces.entries())test(place.canonical_name+' keeps its own guide even beside other Bologna monuments',()=>{
 const row=cultureRow(place,i),article=culturalArticle(place,i);assert.equal(culturalPlaces(row)[0].provider_place_id,place.provider_place_id);
 for(const other of bolognaPlaces)assert.equal(sourceMatchesPlace(place,culturalArticle(other)),other===place);
 const doc=guideProposal(place,article,proposedSections(article));assert.equal(doc.place_key,guidePlaceKey(place));assert.equal(doc.language,'ca');assert.equal(doc.sections.history.origin,'proposal');
 assert.match(culturalNarration(doc),/Suggeriments de visita/);assert.equal(culturalTravelBookSnapshot(storedGuide(place,doc)).source_id,cultureId(70));
});
test('uncertain, stale, wrong nearby and container/room identities never auto-link',()=>{
 const row=cultureRow(bolognaPlaces[4]);row.location_points.points[0].place=bolognaPlaces[3];assert.equal(culturalPlaces(row).length,0);
 row.title='Changed';assert.equal(culturalPlaces(row).length,0);
 assert.equal(culturalPlaces({title:'Fontana del Nettuno'}).length,0);
 assert.equal(sourceMatchesPlace(bolognaPlaces[0],{...culturalArticle(bolognaPlaces[0]),latitude:40}),false);
});
test('forged citations, unsupported fact provenance and nonpublic/private URLs rejected; manual edits stay unverified',()=>{
 const place=bolognaPlaces[0],article=culturalArticle(place),doc=guideProposal(place,article,proposedSections(article));
 for(const mutate of [d=>d.sections.history.evidence[0].quote='Invented fact',d=>d.sources[0].url='https://private.invalid/reservation',d=>d.sections.history.origin='verified',d=>d.sections.history.origin='source',d=>d.reservation='SECRET',d=>d.sources[0].document_id='SECRET']){
  const altered=structuredClone(doc);mutate(altered);if(altered.sections.history.origin==='source')altered.sections.history.text='Invented history';assert.throws(()=>validateCulturalGuide(altered,doc.place_key));
 }
 const blank=emptyCulturalGuide(place);blank.sections.history.text='User text';assert.equal(validateCulturalGuide(blank,blank.place_key).sections.history.origin,'user');
});
const request=data=>new Request('http://synthetic',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify(data)});
function setup(options={}){
 const calls=[],place=bolognaPlaces[4],article=culturalArticle(place),row={...cultureRow(place),notes:'PRIVATE NOTE',booking_reference:'PRIVATE RESERVATION',document_id:'PRIVATE DOC'};
 const handler=createCulturalGuideHandler({authenticate:async()=>cultureId(9),readItem:async()=>row,search:async p=>{calls.push({search:p});return [article]},readArticle:async()=>article,generate:async payload=>{calls.push({generate:payload});return proposedSections(article)},...options});
 const data={action:'propose',trip_id:cultureId(1),source_type:'manual',source_id:row.id,place_key:guidePlaceKey(place),language:'it',pageid:article.pageid};return {handler,calls,data};
}
test('provider receives only public source; requests cannot carry personal documents or trip notes',async()=>{
 const {handler,calls,data}=setup();assert.equal((await handler(request(data))).status,200);
 assert.deepEqual(Object.keys(calls[0].generate).sort(),['place_name','source_language','source_text','source_title']);assert.doesNotMatch(JSON.stringify(calls),/PRIVATE|trip_id|booking|document_id/);
 assert.equal((await handler(request({...data,documents:['PRIVATE']}))).status,400);assert.equal(calls.length,1);
});
test('auth, membership, source changes, wrong monument and wrong methods stop before generation',async()=>{
 for(const options of [{authenticate:async()=>null},{readItem:async()=>null},{readItem:async()=>cultureRow(bolognaPlaces[3])},{readArticle:async()=>culturalArticle(bolognaPlaces[3])}]){
  const {handler,calls,data}=setup(options);assert.ok((await handler(request(data))).status>=400);assert.equal(calls.length,0);
 }
 const {handler}=setup();assert.equal((await handler(new Request('http://synthetic'))).status,405);
});
test('public adapter fixes hosts, respects aliases and pins revisions without forwarding auth',async()=>{
 const urls=[],place=bolognaPlaces[4];const fake=async(url,opts)=>{urls.push([String(url),opts]);if(String(url).includes('wikidata'))return Response.json({entities:{Q100:{labels:{it:{value:place.canonical_name}},aliases:{},claims:{}}}});return Response.json({query:{pages:[{pageid:100,title:'Teatre anatòmic',extract:'Synthetic source',pageprops:{wikibase_item:'Q100'},coordinates:[{lat:place.latitude,lon:place.longitude}],revisions:[{revid:500}]}]}})};
 const article=await readCulturalArticle('ca',100,fake);assert.equal(sourceMatchesPlace(place,article),true);assert.equal(article.revision,500);assert.ok(urls.every(([url])=>['ca.wikipedia.org','www.wikidata.org'].includes(new URL(url).host)));assert.doesNotMatch(JSON.stringify(urls),/Bearer|PRIVATE/);
 await assert.rejects(readCulturalArticle('http://private',1,fake));
 let searchUrl;await searchCulturalArticles(place,'it',async url=>{searchUrl=String(url);return Response.json({query:{search:[]}})});assert.equal(new URL(searchUrl).host,'it.wikipedia.org');
});

 test('compound Archiginnasio and Teatro Anatomico visits retain two distinct place identities',()=>{
  const row=cultureRow(bolognaPlaces[3]);
  row.location_points.points.push({id:'point-1',query:bolognaPlaces[4].canonical_name,status:'resolved',place:bolognaPlaces[4]});
  assert.deepEqual(culturalPlaces(row).map(guidePlaceKey),[guidePlaceKey(bolognaPlaces[3]),guidePlaceKey(bolognaPlaces[4])]);
 });

test('automatic preparation chooses the only exact public identity, ignoring nearby search results',async()=>{
 const {handler,data,calls}=setup({search:async()=>[culturalArticle(bolognaPlaces[0],0),culturalArticle(bolognaPlaces[4],4)],readArticle:async(_,id)=>culturalArticle(bolognaPlaces[id===104?4:0],id===104?4:0)});
 const response=await handler(request({...data,action:'prepare'}));assert.equal(response.status,200);assert.equal((await response.json()).document.place_key,data.place_key);assert.equal(calls.length,1);
});
test('automatic ambiguity requires confirmation before the model; wrong identity never generates',async()=>{
 for(const ambiguous of [true,false]){
  const article=culturalArticle(bolognaPlaces[4]);
  const {handler,data,calls}=setup({search:async()=>ambiguous?[article,{...article,pageid:101}]:[culturalArticle(bolognaPlaces[3])],readArticle:async(_,id)=>ambiguous?{...article,pageid:id}:culturalArticle(bolognaPlaces[3])});
  const response=await handler(request({...data,action:'prepare'})),body=await response.json();assert.equal(calls.length,0);
  if(ambiguous){assert.equal(response.status,200);assert.equal(body.confirmation_required,true);assert.equal(body.candidates.length,2)}else{assert.equal(response.status,422);assert.equal(body.error,'source_not_found')}
 }
});
test('automatic preparation falls back to Italian and never falls back after a source timeout',async()=>{
 const article=culturalArticle(bolognaPlaces[4]),languages=[];
 const {handler,data}=setup({search:async(_,lang)=>{languages.push(lang);return lang==='ca'?[]:[article]}});
 assert.equal((await handler(request({...data,action:'prepare',language:'ca'}))).status,200);assert.deepEqual(languages,['ca','it']);
 const events=[];const timed=setup({readArticle:async()=>{throw new DOMException('private upstream contents','TimeoutError')},diagnose:e=>events.push(e)});
 const response=await timed.handler(request({...timed.data,action:'prepare'})),body=await response.json();assert.equal(response.status,503);assert.equal(body.error,'source_timeout');assert.equal(body.stage,'read_source');assert.match(body.request_id,/^[a-f0-9-]{36}$/);assert.doesNotMatch(JSON.stringify(events),/private|Bearer|place_key|trip_id/);
});
test('generation and citation failures return safe stage and correlation instead of a blank guide',async()=>{
 for(const options of [{generate:async()=>{throw Error('invalid_response')}},{generate:async()=>({})}]){
  const {handler,data}=setup(options);const response=await handler(request(data)),body=await response.json();assert.equal(response.status,503);assert.equal(body.error,'invalid_response');assert.ok(['generate','validate'].includes(body.stage));
 }
});

test('Wikimedia requests identify Freya Travel and preserve upstream HTTP status without leaking response bodies',async()=>{
 const place=bolognaPlaces[4];
 const calls=[];
 const fetcher=async (url,options)=>{
  calls.push({host:url.hostname,agent:options.headers['User-Agent']});
  return {ok:false,status:403};
 };
 await assert.rejects(searchCulturalArticles(place,'it',fetcher),error=>{
  assert.equal(error.message,'source_unavailable');
  assert.equal(error.providerStatus,403);
  assert.doesNotMatch(JSON.stringify(error),'PRIVATE');
  return true;
 });
 assert.equal(calls.length,1);
 assert.equal(calls[0].host,'it.wikipedia.org');
 assert.ok(calls[0].agent.includes('https://github.com/ebarlabe-art/freya-travel'));
 await assert.rejects(searchCulturalArticles(place,'it',async()=>({ok:false,status:429})),error=>error.message==='rate_limited'&&error.providerStatus===429);
});

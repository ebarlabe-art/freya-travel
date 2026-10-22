// Fixed public Wikimedia hosts only. No caller supplied URL, token or private file.
async function wiki(language,params,fetcher=fetch){
 if(!['ca','it','en'].includes(language))throw Error('source_unavailable');
 const url=new URL(`https://${language}.wikipedia.org/w/api.php`);url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',...params}).toString();
 const response=await fetcher(url,{headers:{'User-Agent':'FreyaTravel-CulturalGuide/1.0 (source attribution)'},signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('source_unavailable');return response.json();
}
export async function searchCulturalArticles(place,language,fetcher=fetch){
 const result=await wiki(language,{list:'search',srsearch:'"'+place.canonical_name.replace(/["\\]/g,'')+'"',srlimit:'6',srprop:''},fetcher);
 return (result.query?.search||[]).filter(p=>Number.isSafeInteger(p.pageid)&&typeof p.title==='string').map(p=>({pageid:p.pageid,title:p.title}));
}
export async function readCulturalArticle(language,pageid,fetcher=fetch){
 if(!Number.isSafeInteger(pageid)||pageid<1)throw Error('source_unavailable');
 const data=await wiki(language,{pageids:String(pageid),prop:'extracts|coordinates|pageprops|revisions',explaintext:'1',exsectionformat:'plain',exlimit:'1',colimit:'1',rvprop:'ids',ppprop:'wikibase_item|disambiguation'},fetcher),page=data.query?.pages?.[0];
 if(!page||page.missing||page.pageprops?.disambiguation!==undefined||typeof page.extract!=='string'||!page.extract.trim()||!Number.isSafeInteger(page.revisions?.[0]?.revid))throw Error('source_unsuitable');
 const names=[page.title],qid=page.pageprops?.wikibase_item;let latitude=page.coordinates?.[0]?.lat,longitude=page.coordinates?.[0]?.lon;
 if(/^Q\d+$/.test(qid||'')){
  const url=new URL('https://www.wikidata.org/w/api.php');url.search=new URLSearchParams({action:'wbgetentities',format:'json',ids:qid,props:'labels|aliases|claims',languages:'ca|it|en'}).toString();
  const response=await fetcher(url,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('source_unavailable');const entity=(await response.json()).entities?.[qid];
  for(const lang of ['ca','it','en']){if(entity?.labels?.[lang]?.value)names.push(entity.labels[lang].value);for(const alias of entity?.aliases?.[lang]||[])names.push(alias.value)}
  const coord=entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;if(latitude===undefined&&coord?.globe==='http://www.wikidata.org/entity/Q2'){latitude=coord.latitude;longitude=coord.longitude}
 }
 return {language,pageid:page.pageid,title:page.title,names,latitude,longitude,revision:page.revisions[0].revid,extract:page.extract.slice(0,18000)};
}

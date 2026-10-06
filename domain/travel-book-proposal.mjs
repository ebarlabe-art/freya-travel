const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fail(code){throw Object.assign(new Error(code),{code})}
function text(value,max){const v=typeof value==='string'?value.trim():'';return v?v.slice(0,max):null}
function date(value){if(!value)return null;if(!/^20\d{2}-\d{2}-\d{2}$/.test(value))return null;const d=new Date(value+'T00:00:00Z');return Number.isNaN(d.getTime())?null:value}
function positive(value){const n=Number(value);return Number.isFinite(n)&&n>0?n:null}
function index(value){const n=Number(value);return Number.isInteger(n)&&n>=0?n:null}

function normalizedPhoto(raw){
 if(!raw||!UUID.test(raw.asset_id||''))return null;
 if(raw.status!=='ready')return null;
 const snapshots=Array.isArray(raw.source_snapshot_ids)?[...new Set(raw.source_snapshot_ids.filter(id=>UUID.test(id)))].sort():[];
 return {
  asset_id:raw.asset_id,
  local_date:date(raw.local_date),
  selection_index:index(raw.selection_index),
  width_px:positive(raw.width_px),
  height_px:positive(raw.height_px),
  caption_candidate:raw.title_reviewed===true?text(raw.title,160):null,
  source_snapshot_ids:snapshots
 };
}

function photoOrder(a,b){
 const da=a.local_date||'9999-99-99',db=b.local_date||'9999-99-99';
 if(da!==db)return da.localeCompare(db);
 const ia=a.selection_index??Number.MAX_SAFE_INTEGER,ib=b.selection_index??Number.MAX_SAFE_INTEGER;
 if(ia!==ib)return ia-ib;
 return a.asset_id.localeCompare(b.asset_id);
}

function coverScore(photo){
 const w=photo.width_px||0,h=photo.height_px||0,area=w*h;
 const ratio=w&&h?w/h:0;
 const landscape=ratio>=1.1&&ratio<=2.2?1:0;
 const balanced=ratio?1-Math.min(Math.abs(Math.log(ratio/1.5)),1):0;
 return [landscape,balanced,area];
}
function compareCover(a,b){
 const as=coverScore(a),bs=coverScore(b);
 for(let i=0;i<as.length;i++)if(as[i]!==bs[i])return bs[i]-as[i];
 return a.asset_id.localeCompare(b.asset_id);
}
function layoutHint(count){if(count<=1)return 'hero';if(count===2)return 'duo';if(count===3)return 'triptych';if(count===4)return 'grid';return 'story_grid'}
function pageSize(remaining,index){if(remaining<=1)return 1;if(index===0&&remaining>=5)return 5;if(remaining===2)return 2;if(remaining===3)return 3;if(remaining===4)return 4;return Math.min(6,remaining)}
function pagesFor(items){
 const pages=[];let cursor=0,pageIndex=0;
 while(cursor<items.length){
  const size=pageSize(items.length-cursor,pageIndex),slice=items.slice(cursor,cursor+size);
  pages.push({index:pageIndex,layout_hint:layoutHint(slice.length),items:slice});
  cursor+=size;pageIndex++;
 }
 return pages;
}
function sectionKey(localDate){return localDate?'day:'+localDate:'memories:undated'}

export function buildInitialTravelBookProposal(input){
 if(!input||!UUID.test(input.trip_id||'')||!UUID.test(input.book_id||''))fail('ALB04_INVALID_SCOPE');
 const title=text(input.title,160)||'Travel Book';
 const photos=(Array.isArray(input.photos)?input.photos:[]).map(normalizedPhoto).filter(Boolean).sort(photoOrder);
 const cover=photos.slice().sort(compareCover)[0]||null;
 const groups=new Map();
 for(const photo of photos){
  const key=sectionKey(photo.local_date);
  if(!groups.has(key))groups.set(key,{key,role:photo.local_date?'day':'memories',local_date:photo.local_date,items:[]});
  groups.get(key).items.push(photo);
 }
 const sections=[...groups.values()].map(group=>({
  key:group.key,
  role:group.role,
  local_date:group.local_date,
  title_candidate:group.local_date,
  layout_hint:layoutHint(group.items.length),
  items:group.items.map(photo=>({
   asset_id:photo.asset_id,
   caption_candidate:photo.caption_candidate,
   caption_classification:photo.caption_candidate?'user_statement':null,
   source_snapshot_ids:photo.source_snapshot_ids
  }))
 }));
 const undated=photos.filter(photo=>!photo.local_date).length;
 const warnings=[];
 if(!photos.length)warnings.push('no_ready_assets');
 if(undated)warnings.push('photos_without_date_context');
 return {
  schema_version:1,
  engine:{mode:'hybrid',base_generator:'alb04-deterministic-v1',creative_layer:'pending'},
  trip_id:input.trip_id,
  book_id:input.book_id,
  title,
  cover:cover?{asset_id:cover.asset_id,source_snapshot_ids:cover.source_snapshot_ids}:null,
  sections:sections.map(section=>({...section,pages:pagesFor(section.items)})),
  unplaced_asset_ids:[],
  warnings,
  stats:{ready_photos:photos.length,dated_photos:photos.length-undated,undated_photos:undated}
 };
}

export function validateInitialTravelBookProposal(value){
 if(!value||value.schema_version!==1||value.engine?.mode!=='hybrid'||value.engine?.base_generator!=='alb04-deterministic-v1')return false;
 if(!UUID.test(value.trip_id||'')||!UUID.test(value.book_id||'')||typeof value.title!=='string'||!Array.isArray(value.sections)||!Array.isArray(value.warnings))return false;
 const assets=new Set();
 if(value.cover&&!UUID.test(value.cover.asset_id||''))return false;
 for(const section of value.sections){
  if(!['day','memories'].includes(section.role)||!Array.isArray(section.items)||!Array.isArray(section.pages)||typeof section.key!=='string')return false;
  if(section.role==='day'&&!date(section.local_date))return false;
  if(section.role==='memories'&&section.local_date!==null)return false;
  const pageAssets=[];
  for(const page of section.pages){
   if(!Number.isInteger(page.index)||page.index<0||!['hero','duo','triptych','grid','story_grid'].includes(page.layout_hint)||!Array.isArray(page.items)||!page.items.length||page.items.length>6)return false;
   for(const item of page.items){if(!UUID.test(item.asset_id||''))return false;pageAssets.push(item.asset_id);}
  }
  if(pageAssets.join('|')!==section.items.map(item=>item.asset_id).join('|'))return false;
  for(const item of section.items){
   if(!UUID.test(item.asset_id||'')||assets.has(item.asset_id))return false;
   assets.add(item.asset_id);
   if(item.caption_candidate!==null&&typeof item.caption_candidate!=='string')return false;
   if(item.caption_candidate&&item.caption_classification!=='user_statement')return false;
   if(!Array.isArray(item.source_snapshot_ids)||item.source_snapshot_ids.some(id=>!UUID.test(id)))return false;
  }
 }
 return value.stats?.ready_photos===assets.size;
}

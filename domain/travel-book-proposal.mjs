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
const CREATIVE_STYLES=['hero_editorial','scrapbook','narrative'];
const STICKERS={
 hero_editorial:['sparkle'],
 scrapbook:['tape','postcard','heart'],
 narrative:['quote','sparkle']
};
function creativeStyle(pageIndex,count,hasCaption){
 if(hasCaption&&count<=2)return 'narrative';
 if(pageIndex===0&&count<=3)return 'hero_editorial';
 return pageIndex%3===1?'scrapbook':pageIndex%3===2?'narrative':'scrapbook';
}
const TITLE_POOLS={
 hero_editorial:['Un moment per recordar','Moments que queden','Una pausa en el camí','Això també és viatjar','Un instant només nostre','D’aquells moments','Records en primer pla','Un moment, una història'],
 scrapbook:['Instants del viatge','Postals del camí','Trossos del viatge','Una mica de tot','Moments en moviment','Dies per guardar','Petits grans moments','Records sense ordre','El viatge, a bocins','Entre fotos i records'],
 narrative:['Petites històries del viatge','La nostra història','Entre moments i records','Històries que ens emportem','Així va passar','Dies per recordar','Moments amb història','El fil del viatge','Allò que queda','Una història dins del viatge']
};
function creativeCopy(style,hasCaption,usedTitles,pageIndex){
 const pool=hasCaption&&style==='narrative'
  ?['La nostra història','Així va passar','Moments amb història','Una història dins del viatge',...TITLE_POOLS.narrative]
  :TITLE_POOLS[style];
 const unique=[...new Set(pool)];
 const title=unique.find(candidate=>!usedTitles.has(candidate))||`${unique[pageIndex%unique.length]} · ${usedTitles.size+1}`;
 usedTitles.add(title);
 return {title,subtitle:null};
}
function pagesFor(items,usedTitles){
 const pages=[];let cursor=0,pageIndex=0;
 while(cursor<items.length){
  const size=pageSize(items.length-cursor,pageIndex),slice=items.slice(cursor,cursor+size);
  const hasCaption=slice.some(item=>!!item.caption_candidate),style=creativeStyle(pageIndex,slice.length,hasCaption),copy=creativeCopy(style,hasCaption,usedTitles,pageIndex);
  const firstCaption=slice.find(item=>item.caption_candidate)?.caption_candidate||null;
  pages.push({
   index:pageIndex,
   layout_hint:layoutHint(slice.length),
   creative_style:style,
   title:copy.title,
   subtitle:firstCaption,
   subtitle_classification:firstCaption?'user_statement':null,
   stickers:[...STICKERS[style]],
   items:slice
  });
  cursor+=size;pageIndex++;
 }
 return pages;
}
export function proposeAlternativeTravelBookTitle(page,usedTitles=[]){
 if(!page||!CREATIVE_STYLES.includes(page.creative_style))return null;
 const used=new Set(usedTitles.filter(value=>typeof value==='string'));
 used.add(page.title);
 return creativeCopy(page.creative_style,!!page.subtitle,used,Number.isInteger(page.index)?page.index+1:0).title;
}
export function editTravelBookPage(proposal,{section_index,page_index,title,subtitle,creative_style,stickers}){
 if(!validateInitialTravelBookProposal(proposal))fail('ALB053_INVALID_PROPOSAL');
 const section=proposal.sections?.[section_index],page=section?.pages?.[page_index];
 if(!page)fail('ALB053_PAGE_NOT_FOUND');
 const next=structuredClone(proposal),target=next.sections[section_index].pages[page_index];
 if(title!==undefined){const value=text(title,160);if(!value)fail('ALB053_INVALID_TITLE');target.title=value;}
 if(subtitle!==undefined){
  const value=text(subtitle,320);
  target.subtitle=value;
  target.subtitle_classification=value?'user_statement':null;
 }
 if(creative_style!==undefined){
  if(!CREATIVE_STYLES.includes(creative_style))fail('ALB053_INVALID_STYLE');
  target.creative_style=creative_style;
 }
 if(stickers!==undefined){
  if(!Array.isArray(stickers)||stickers.some(sticker=>!['sparkle','tape','postcard','heart','quote'].includes(sticker)))fail('ALB053_INVALID_STICKERS');
  target.stickers=[...new Set(stickers)];
 }
 if(!validateInitialTravelBookProposal(next))fail('ALB053_INVALID_EDIT');
 return next;
}
export function editTravelBookPhotoOverlay(proposal,{section_index,page_index,item_index,text:overlayText}){
 if(!validateInitialTravelBookProposal(proposal))fail('ALB054_INVALID_PROPOSAL');
 const page=proposal.sections?.[section_index]?.pages?.[page_index],item=page?.items?.[item_index];
 if(!item)fail('ALB054_PHOTO_NOT_FOUND');
 const next=structuredClone(proposal),target=next.sections[section_index].pages[page_index].items[item_index];
 const value=text(overlayText,120);
 target.overlay_text=value;
 target.overlay_text_classification=value?'user_statement':null;
 if(!validateInitialTravelBookProposal(next))fail('ALB054_INVALID_EDIT');
 return next;
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
 const usedTitles=new Set();
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
   source_snapshot_ids:photo.source_snapshot_ids,
   overlay_text:null,
   overlay_text_classification:null
  }))
 }));
 const undated=photos.filter(photo=>!photo.local_date).length;
 const warnings=[];
 if(!photos.length)warnings.push('no_ready_assets');
 if(undated)warnings.push('photos_without_date_context');
 return {
  schema_version:1,
  engine:{mode:'hybrid',base_generator:'alb04-deterministic-v1',creative_layer:'alb05-warm-editorial-v1'},
  trip_id:input.trip_id,
  book_id:input.book_id,
  title,
  cover:cover?{asset_id:cover.asset_id,source_snapshot_ids:cover.source_snapshot_ids}:null,
  sections:sections.map(section=>({...section,pages:pagesFor(section.items,usedTitles)})),
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
   if(!Number.isInteger(page.index)||page.index<0||!['hero','duo','triptych','grid','story_grid'].includes(page.layout_hint)||!CREATIVE_STYLES.includes(page.creative_style)||typeof page.title!=='string'||!page.title||!Array.isArray(page.stickers)||page.stickers.some(sticker=>!['sparkle','tape','postcard','heart','quote'].includes(sticker))||!Array.isArray(page.items)||!page.items.length||page.items.length>6)return false;
   if(page.subtitle!==null&&typeof page.subtitle!=='string')return false;
   if(page.subtitle&&page.subtitle_classification!=='user_statement')return false;
   for(const item of page.items){
    if(!UUID.test(item.asset_id||''))return false;
    if(item.overlay_text!==null&&item.overlay_text!==undefined&&typeof item.overlay_text!=='string')return false;
    if(item.overlay_text&&item.overlay_text_classification!=='user_statement')return false;
    pageAssets.push(item.asset_id);
   }
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

import {validateComposition} from './travel-book-composition.mjs';

const STICKER_PREFIX='freya://sticker/';
const STICKERS=new Set(['sparkle','postcard','heart','quote','flower','leaf','sun']);
const CANVAS={unit:'mm',width:210,height:297};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const geometry=(x=10,y=10,width=40,height=12,rotation=0)=>({x,y,width,height,rotation});
const locks=()=>({content:false,geometry:false});
const textElement=(id,role,text,source_snapshot_ids=[],g=geometry())=>({id,type:'text',role,text,source_snapshot_ids:[...new Set(source_snapshot_ids.filter(id=>UUID.test(id)))],geometry:g,locks:locks()});
const imageElement=(id,asset_id,g)=>({id,type:'image',asset_id,crop:{x:0,y:0,width:1,height:1},geometry:g,locks:locks()});
const defaultStickerPosition=(index)=>({x:82-(index%3)*14,y:12+Math.floor(index/3)*12,rotation:index%2?8:-7});

function labelFor(page){return JSON.stringify({ft:1,style:page.creative_style,layout:page.layout_hint}).slice(0,160)}
function readLabel(document){
 try{const value=JSON.parse(document?.metadata?.label||'');return value?.ft===1?value:null}catch{return null}
}
function oldId(document,predicate,makeId){
 const found=document?.elements?.find(predicate)?.id;
 return UUID.test(found||'')?found:makeId();
}
function stickerPosition(page,sticker,index){
 const p=page.sticker_positions?.[sticker]||defaultStickerPosition(index);
 return {x:clamp(Number.isFinite(Number(p.x))?Number(p.x):50,0,100),y:clamp(Number.isFinite(Number(p.y))?Number(p.y):50,0,100),rotation:clamp(Number(p.rotation)||0,-360,360)};
}
function toCanvasPosition(position){
 return {x:position.x*CANVAS.width/100,y:position.y*CANVAS.height/100,rotation:position.rotation};
}
function fromCanvasPosition(g){
 return {x:clamp(g.x/CANVAS.width*100,0,100),y:clamp(g.y/CANVAS.height*100,0,100),rotation:g.rotation||0};
}

export function flattenTravelBookPages(proposal){
 const out=[];
 for(let sectionIndex=0;sectionIndex<(proposal?.sections?.length||0);sectionIndex++){
  const section=proposal.sections[sectionIndex];
  for(let pageIndex=0;pageIndex<(section.pages?.length||0);pageIndex++)out.push({sectionIndex,pageIndex,page:section.pages[pageIndex]});
 }
 return out;
}

// Patch only fields exposed by the current editor. Hidden editorial properties are authoritative.
function patchSavedPage(page,previous,makeId){
 const document=structuredClone(previous),elements=document.elements;
 const updateText=(element,value,role,g)=>{
  if(element){
   if(element.locks.content&&element.text!==value)throw Error('Aquest element té el contingut protegit.');
   element.text=value;
  }else if(value)elements.push(textElement(makeId(),role,value,[],g));
 };
 updateText(elements.find(e=>e.type==='text'&&e.role==='title'),page.title||'','title',geometry(12,12,186,18));
 updateText(elements.find(e=>e.type==='text'&&e.role==='body'&&!e.text.startsWith(STICKER_PREFIX)),page.subtitle||'','body',geometry(12,32,186,18));
 for(const item of page.items){
  const at=elements.findIndex(e=>e.type==='image'&&(item.editor_image_id?e.id===item.editor_image_id:e.asset_id===item.asset_id));
  if(at<0)throw Error('La fotografia ja no correspon a la composició desada.');
  const image=elements[at];let caption;
  for(let i=at+1;i<elements.length&&elements[i].type!=='image';i++)if(elements[i].type==='text'&&elements[i].role==='caption'){caption=elements[i];break}
  if(caption)updateText(caption,item.overlay_text||'','caption');
  else if(item.overlay_text)elements.splice(at+1,0,textElement(makeId(),'caption',item.overlay_text,[],geometry(image.geometry.x+3,image.geometry.y+image.geometry.height-16,Math.max(1,image.geometry.width-6),13)));
 }
 const selected=new Set(page.stickers||[]);
 for(const e of elements)if(e.type==='text'&&e.text.startsWith(STICKER_PREFIX)&&STICKERS.has(e.text.slice(STICKER_PREFIX.length))&&!selected.has(e.text.slice(STICKER_PREFIX.length))&&e.locks.content)throw Error('Aquesta decoració té el contingut protegit.');
 document.elements=elements.filter(e=>!(e.type==='text'&&e.text.startsWith(STICKER_PREFIX)&&STICKERS.has(e.text.slice(STICKER_PREFIX.length))&&!selected.has(e.text.slice(STICKER_PREFIX.length))));
 for(const [index,sticker] of [...selected].entries()){
  if(!STICKERS.has(sticker))continue;
  const old=document.elements.find(e=>e.type==='text'&&e.text===STICKER_PREFIX+sticker),p=stickerPosition(page,sticker,index),c=toCanvasPosition(p);
  if(old){
   const before=fromCanvasPosition(old.geometry);
   if(Math.abs(before.x-p.x)>1e-8||Math.abs(before.y-p.y)>1e-8||before.rotation!==p.rotation){
    if(old.locks.geometry)throw Error('Aquesta decoració té la posició protegida.');
    Object.assign(old.geometry,c);
   }
  }else document.elements.push(textElement(makeId(),'body',STICKER_PREFIX+sticker,[],geometry(c.x,c.y,16,16,c.rotation)));
 }
 const label=readLabel(document);
 if(label)document.metadata.label=JSON.stringify({...label,style:page.creative_style,layout:page.layout_hint});
 return document;
}

export function compositionFromTravelBookPage({page,compositionId,pageId,previousDocument=null,makeId=()=>crypto.randomUUID()}){
 if(!page||!UUID.test(compositionId||'')||!UUID.test(pageId||''))throw new TypeError('ALB055_INVALID_PAGE');
 if(previousDocument?.elements?.length){
  if(!validateComposition(previousDocument)||previousDocument.composition_id!==compositionId||!previousDocument.page_ids.includes(pageId))throw Error('Composició desada incompatible.');
  const patched=patchSavedPage(page,previousDocument,makeId);
  if(!validateComposition(patched))throw Error('Composició editada invàlida.');
  return patched;
 }
 const elements=[];
 elements.push(textElement(oldId(previousDocument,e=>e.type==='text'&&e.role==='title',makeId),'title',page.title||'',[],geometry(12,12,186,18,0)));
 if(page.subtitle){
  elements.push(textElement(oldId(previousDocument,e=>e.type==='text'&&e.role==='body'&&!String(e.text||'').startsWith(STICKER_PREFIX),makeId),'body',page.subtitle,[],geometry(12,32,186,18,0)));
 }
 const oldImages=new Map((previousDocument?.elements||[]).filter(e=>e.type==='image').map(e=>[e.asset_id,e]));
 const oldCaptions=(previousDocument?.elements||[]).filter(e=>e.type==='text'&&e.role==='caption');
 page.items.forEach((item,index)=>{
  const columns=Math.min(2,page.items.length),w=columns===1?186:89,h=62,x=12+(index%columns)*(w+8),y=58+Math.floor(index/columns)*70;
  const oldImage=oldImages.get(item.asset_id);
  elements.push(imageElement(oldImage?.id||makeId(),item.asset_id,oldImage?.geometry||geometry(x,y,w,h,0)));
  if(item.overlay_text){
   const bySnapshot=oldCaptions.find(e=>item.source_snapshot_ids?.some(id=>e.source_snapshot_ids?.includes(id)));
   const oldCaption=bySnapshot||oldCaptions[index];
   elements.push(textElement(oldCaption?.id||makeId(),'caption',item.overlay_text,[],oldCaption?.geometry||geometry(x+3,y+h-16,w-6,13,0)));
  }
 });
 (page.stickers||[]).forEach((sticker,index)=>{
  if(!STICKERS.has(sticker))return;
  const old=(previousDocument?.elements||[]).find(e=>e.type==='text'&&e.text===STICKER_PREFIX+sticker);
  const p=stickerPosition(page,sticker,index),c=toCanvasPosition(p);
  elements.push(textElement(old?.id||makeId(),'body',STICKER_PREFIX+sticker,[],geometry(c.x,c.y,16,16,c.rotation)));
 });
 const document={schema_version:1,composition_id:compositionId,kind:'page',page_ids:[pageId],canvas:{...CANVAS},elements,locks:{layout:false},metadata:{label:labelFor(page)}};
 if(!validateComposition(document))throw new TypeError('ALB055_INVALID_DOCUMENT');
 return document;
}

export function applyTravelBookComposition(page,document){
 if(!page||!validateComposition(document))return page;
 if(!document.elements.length)return page;
 const label=readLabel(document);
 const next=structuredClone(page);
 if(label?.style&&['hero_editorial','scrapbook','narrative'].includes(label.style))next.creative_style=label.style;
 if(label?.layout&&['hero','duo','triptych','grid','story_grid'].includes(label.layout))next.layout_hint=label.layout;
 const title=document.elements.find(e=>e.type==='text'&&e.role==='title');
 const subtitle=document.elements.find(e=>e.type==='text'&&e.role==='body'&&!String(e.text||'').startsWith(STICKER_PREFIX));
 if(title?.text)next.title=title.text;
 next.subtitle=subtitle?.text||null;
 next.subtitle_classification=next.subtitle?'user_statement':null;
 const itemByAsset=new Map(next.items.map(item=>[item.asset_id,item]));
 next.items=document.elements.filter(e=>e.type==='image').map(e=>({...structuredClone(itemByAsset.get(e.asset_id)||{asset_id:e.asset_id,caption_candidate:null,caption_classification:null,source_snapshot_ids:[]}),editor_image_id:e.id,overlay_text:null,overlay_text_classification:null}));
 let currentItem=null;
 for(const element of document.elements){
  if(element.type==='image'){currentItem=next.items.find(item=>item.editor_image_id===element.id)||null;continue}
  if(element.type==='text'&&element.role==='caption'&&currentItem){
   currentItem.overlay_text=element.text||null;
   currentItem.overlay_text_classification=currentItem.overlay_text?'user_statement':null;
  }
 }
 const stickers=[],positions={};
 for(const element of document.elements){
  if(element.type!=='text'||!String(element.text||'').startsWith(STICKER_PREFIX))continue;
  const sticker=element.text.slice(STICKER_PREFIX.length);if(!STICKERS.has(sticker))continue;
  stickers.push(sticker);positions[sticker]=fromCanvasPosition(element.geometry);
 }
 next.stickers=[...new Set(stickers)];
 next.sticker_positions=positions;
 return next;
}

export function applyTravelBookDocuments(proposal,records){
 if(!records?.length)return structuredClone(proposal);
 const next=structuredClone(proposal),generated=flattenTravelBookPages(next),sections=[],used=new Set();
 const reserved=new Set(records.flatMap(r=>(r.document?.elements||[]).filter(e=>e.type==='image').map(e=>e.asset_id)));
 const allItems=next.sections.flatMap(s=>s.items||s.pages.flatMap(p=>p.items));
 const append=(page,section)=>{
  const last=sections.at(-1),target=last&&last.key===section.key?last:{...structuredClone(section),items:[],pages:[]};
  if(target!==last)sections.push(target);
  page.index=target.pages.length;target.pages.push(page);target.items.push(...page.items);
  page.items.forEach(item=>used.add(item.asset_id));
 };
 // Saved composition order/asset IDs win over newly generated page indices.
 for(let i=0;i<records.length;i++){
  const doc=records[i].document;
  if(doc&&!validateComposition(doc))throw Error('La composició desada no és vàlida. No s’ha modificat.');
  const images=doc?.elements?.filter(e=>e.type==='image')||[];
  const match=generated.find(g=>images.some(e=>g.page.items.some(item=>item.asset_id===e.asset_id)))||generated[i];
  const section=match?next.sections[match.sectionIndex]:{key:'memories:undated',role:'memories',local_date:null,title_candidate:null,layout_hint:'hero'};
  const base=match?.page||{index:i,layout_hint:'hero',creative_style:'hero_editorial',title:'Records',subtitle:null,stickers:[],sticker_positions:{},items:[]};
  const page=doc?.elements?.length?applyTravelBookComposition({...structuredClone(base),items:allItems},doc):structuredClone(base);
  if(!doc?.elements?.length)page.items=page.items.filter(item=>!used.has(item.asset_id)&&!reserved.has(item.asset_id));
  if(!page.items.length)throw Error('Aquesta composició no es pot representar amb l’editor actual. No s’ha modificat.');
  append(page,section);
 }
 // Newly prepared photos may add pages, never replace or shrink saved ones.
 for(const section of next.sections)for(const original of section.pages){
  const items=original.items.filter(item=>!used.has(item.asset_id));
  if(items.length)append({...structuredClone(original),items},section);
 }
 next.sections=sections;
 next.stats={ready_photos:used.size,dated_photos:sections.filter(s=>s.local_date).reduce((n,s)=>n+s.items.length,0),undated_photos:sections.filter(s=>!s.local_date).reduce((n,s)=>n+s.items.length,0)};
 if(next.cover&&!used.has(next.cover.asset_id))next.cover=null;
 return next;
}

export function defaultStickerPositionForPage(page,sticker){
 const index=Math.max(0,(page?.stickers||[]).indexOf(sticker));
 return stickerPosition(page||{},sticker,index);
}

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
 return {x:clamp(Number(p.x)||50,0,100),y:clamp(Number(p.y)||50,0,100),rotation:clamp(Number(p.rotation)||0,-360,360)};
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

export function compositionFromTravelBookPage({page,compositionId,pageId,previousDocument=null,makeId=()=>crypto.randomUUID()}){
 if(!page||!UUID.test(compositionId||'')||!UUID.test(pageId||''))throw new TypeError('ALB055_INVALID_PAGE');
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
   elements.push(textElement(oldCaption?.id||makeId(),'caption',item.overlay_text,item.source_snapshot_ids||[],oldCaption?.geometry||geometry(x+3,y+h-16,w-6,13,0)));
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
 const label=readLabel(document);if(!label)return page;
 const next=structuredClone(page);
 if(label?.style&&['hero_editorial','scrapbook','narrative'].includes(label.style))next.creative_style=label.style;
 if(label?.layout&&['hero','duo','triptych','grid','story_grid'].includes(label.layout))next.layout_hint=label.layout;
 const title=document.elements.find(e=>e.type==='text'&&e.role==='title');
 const subtitle=document.elements.find(e=>e.type==='text'&&e.role==='body'&&!String(e.text||'').startsWith(STICKER_PREFIX));
 if(title?.text)next.title=title.text;
 next.subtitle=subtitle?.text||null;
 next.subtitle_classification=next.subtitle?'user_statement':null;
 const itemByAsset=new Map(next.items.map(item=>[item.asset_id,item]));
 let currentItem=null;
 for(const element of document.elements){
  if(element.type==='image'){currentItem=itemByAsset.get(element.asset_id)||null;continue}
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
 const next=structuredClone(proposal),pages=flattenTravelBookPages(next);
 for(let i=0;i<Math.min(pages.length,records?.length||0);i++){
  const record=records[i];if(!record?.document)continue;
  const {sectionIndex,pageIndex}=pages[i];
  next.sections[sectionIndex].pages[pageIndex]=applyTravelBookComposition(next.sections[sectionIndex].pages[pageIndex],record.document);
 }
 return next;
}

export function defaultStickerPositionForPage(page,sticker){
 const index=Math.max(0,(page?.stickers||[]).indexOf(sticker));
 return stickerPosition(page||{},sticker,index);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {compositionFromTravelBookPage,applyTravelBookComposition,applyTravelBookDocuments,travelBookTemplateRestriction} from '../domain/travel-book-editor-state.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function ids(start=100){let n=start;return()=>id(n++)}

test('ALB-05.5 page edits round-trip through a valid persisted composition',()=>{
 const page={
  index:0,layout_hint:'duo',creative_style:'scrapbook',title:'Un dia nostre',
  subtitle:'Comentari de pàgina',subtitle_classification:'user_statement',
  stickers:['heart','flower'],sticker_positions:{heart:{x:31,y:72,rotation:12},flower:{x:76,y:22,rotation:-8}},
  items:[
   {asset_id:id(10),source_snapshot_ids:[id(20)],overlay_text:'Aquí!',overlay_text_classification:'user_statement'},
   {asset_id:id(11),source_snapshot_ids:[],overlay_text:null,overlay_text_classification:null}
  ]
 };
 const makeId=ids();
 const document=compositionFromTravelBookPage({page,compositionId:id(1),pageId:id(2),makeId});
 assert.equal(document.metadata.label.includes('"ft":1'),true);
 assert.equal(document.elements.filter(e=>e.type==='image').length,2);
 assert.equal(document.elements.some(e=>e.text==='freya://sticker/heart'),true);
 const restored=applyTravelBookComposition({
  ...page,title:'Generated',subtitle:null,stickers:[],sticker_positions:{},
  items:page.items.map(item=>({...item,overlay_text:null,overlay_text_classification:null}))
 },document);
 assert.equal(restored.title,'Un dia nostre');
 assert.equal(restored.subtitle,'Comentari de pàgina');
 assert.deepEqual(restored.stickers,['heart','flower']);
 assert.ok(Math.abs(restored.sticker_positions.heart.x-31)<0.01);
 assert.ok(Math.abs(restored.sticker_positions.heart.y-72)<0.01);
 assert.equal(restored.sticker_positions.heart.rotation,12);
 assert.equal(restored.items[0].overlay_text,'Aquí!');
});

test('ALB-05.5 an untouched empty ALB-02 composition does not erase generated proposal copy',()=>{
 const page={index:0,layout_hint:'hero',creative_style:'hero_editorial',title:'Generat',subtitle:'Text',subtitle_classification:'user_statement',stickers:['sparkle'],sticker_positions:{},items:[{asset_id:id(10),source_snapshot_ids:[],overlay_text:null,overlay_text_classification:null}]};
 const empty={schema_version:1,composition_id:id(1),kind:'page',page_ids:[id(2)],canvas:{unit:'mm',width:null,height:null},elements:[],locks:{layout:false},metadata:{label:null}};
 assert.deepEqual(applyTravelBookComposition(page,empty),page);
});

test('ALB-05.5 persisted records apply in exact page order',()=>{
 const basePage=n=>({index:n,layout_hint:'hero',creative_style:'hero_editorial',title:'Generated '+n,subtitle:null,subtitle_classification:null,stickers:['sparkle'],sticker_positions:{},items:[{asset_id:id(30+n),source_snapshot_ids:[],overlay_text:null,overlay_text_classification:null}]});
 const proposal={sections:[{pages:[basePage(0),basePage(1)]}]};
 const makeA=ids(200),makeB=ids(300);
 const a=compositionFromTravelBookPage({page:{...basePage(0),title:'Desat A'},compositionId:id(40),pageId:id(41),makeId:makeA});
 const b=compositionFromTravelBookPage({page:{...basePage(1),title:'Desat B'},compositionId:id(42),pageId:id(43),makeId:makeB});
 const restored=applyTravelBookDocuments(proposal,[{document:a},{document:b}]);
 assert.equal(restored.sections[0].pages[0].title,'Desat A');
 assert.equal(restored.sections[0].pages[1].title,'Desat B');
});

test('#213 editing copy preserves element IDs, crop, geometry, locks and non-editor content',()=>{
 const page={index:0,layout_hint:'hero',creative_style:'hero_editorial',title:'Abans',subtitle:'Comentari',stickers:['heart'],sticker_positions:{heart:{x:0,y:0,rotation:0}},items:[{asset_id:id(10),source_snapshot_ids:[],overlay_text:'Peu'}]};
 const previous=compositionFromTravelBookPage({page,compositionId:id(1),pageId:id(2),makeId:ids()});
 const image=previous.elements.find(e=>e.type==='image');
 image.crop={x:0.1,y:0.2,width:0.7,height:0.6};image.geometry.rotation=17;image.locks={content:true,geometry:true};
 previous.locks.layout=true;
 const restored=applyTravelBookComposition({...page,items:[]},previous);
 const next=compositionFromTravelBookPage({page:{...restored,title:'Després',subtitle:'Nou comentari',items:restored.items.map(i=>({...i,overlay_text:'Nou peu'}))},compositionId:id(1),pageId:id(2),previousDocument:previous,makeId:()=>{throw Error('Unexpected replacement')}});
 assert.deepEqual(next.elements.map(e=>e.id),previous.elements.map(e=>e.id));
 assert.deepEqual(next.elements.find(e=>e.type==='image'),image);
 assert.deepEqual(next.elements.map(e=>e.geometry),previous.elements.map(e=>e.geometry));
 assert.deepEqual(next.locks,previous.locks);
 assert.equal(applyTravelBookComposition(page,next).items[0].overlay_text,'Nou peu');
 assert.equal(applyTravelBookComposition(page,next).title,'Després');
 assert.equal(previous.elements[0].text,'Abans');
});

test('#213 regeneration cannot replace saved photos or shrink saved pages',()=>{
 const item=n=>({asset_id:id(n),source_snapshot_ids:[],caption_candidate:null,overlay_text:null});
 const page=n=>({index:0,layout_hint:'hero',creative_style:'hero_editorial',title:'Saved '+n,subtitle:null,stickers:[],sticker_positions:{},items:[item(n)]});
 const doc=n=>compositionFromTravelBookPage({page:page(n),compositionId:id(n+100),pageId:id(n+200),makeId:ids(n+300)});
 const proposal={sections:[{key:'memories:undated',role:'memories',local_date:null,items:[item(12)],pages:[page(12)]}]};
 const result=applyTravelBookDocuments(proposal,[{document:doc(10)},{document:doc(11)}]);
 assert.deepEqual(result.sections[0].pages.map(p=>p.items[0].asset_id),[id(10),id(11),id(12)]);
 assert.deepEqual(result.sections[0].pages.map(p=>p.title),['Saved 10','Saved 11','Saved 12']);
 assert.equal(result.stats.ready_photos,3);
});

test('#213 legacy documents without a Freya label retain their editorial content',()=>{
 const page={index:0,layout_hint:'hero',creative_style:'hero_editorial',title:'Legacy',subtitle:null,stickers:[],sticker_positions:{},items:[{asset_id:id(10),source_snapshot_ids:[],overlay_text:null}]};
 const doc=compositionFromTravelBookPage({page,compositionId:id(1),pageId:id(2),makeId:ids()});doc.metadata.label=null;
 const restored=applyTravelBookComposition({...page,title:'Generated'},doc);
 assert.equal(restored.title,'Legacy');
 assert.deepEqual(compositionFromTravelBookPage({page:restored,compositionId:id(1),pageId:id(2),previousDocument:doc}),doc);
});


test('#213 templates only change presentation metadata across all existing layouts',()=>{
 for(const layout of ['hero','duo','triptych','grid','story_grid']){
  const page={index:0,layout_hint:layout,creative_style:'hero_editorial',title:'Editorial',subtitle:'Text',stickers:[],sticker_positions:{},items:[{asset_id:id(10),source_snapshot_ids:[],overlay_text:'Caption'}]};
  let doc=compositionFromTravelBookPage({page,compositionId:id(1),pageId:id(2),makeId:ids()});
  const image=doc.elements.find(e=>e.type==='image');image.crop={x:.1,y:.1,width:.8,height:.8};image.geometry={x:17,y:22,width:82,height:61,rotation:12};image.locks.content=true;
  const caption=doc.elements.find(e=>e.role==='caption');doc.elements.push({...structuredClone(caption),id:id(900),text:'Another saved caption',locks:{content:true,geometry:false}});
  const original=structuredClone(doc);
  for(const style of ['scrapbook','narrative','hero_editorial']){
   const restored=applyTravelBookComposition(page,doc);
   assert.equal(travelBookTemplateRestriction(doc),null);
   doc=compositionFromTravelBookPage({page:{...restored,creative_style:style},compositionId:id(1),pageId:id(2),previousDocument:doc});
   assert.deepEqual({...doc,metadata:original.metadata},original);
   const reopened=applyTravelBookComposition(page,doc);assert.equal(reopened.creative_style,style);assert.equal(reopened.layout_hint,layout);
  }
 }
});

test('#213 locked geometry and layout reject template changes without altering the document',()=>{
 const page={index:0,layout_hint:'hero',creative_style:'hero_editorial',title:'Locked',subtitle:null,stickers:[],sticker_positions:{},items:[{asset_id:id(10),source_snapshot_ids:[],overlay_text:null}]};
 for(const lock of ['layout','geometry']){
  const doc=compositionFromTravelBookPage({page,compositionId:id(1),pageId:id(2),makeId:ids()});
  if(lock==='layout')doc.locks.layout=true;else doc.elements[0].locks.geometry=true;
  const original=structuredClone(doc);assert.match(travelBookTemplateRestriction(doc),/bloquejada/);
  assert.throws(()=>compositionFromTravelBookPage({page:{...page,creative_style:'scrapbook'},compositionId:id(1),pageId:id(2),previousDocument:doc}),/bloquejada/);
  assert.deepEqual(doc,original);
 }
});

test('#213 unknown legacy presentation is preserved and excluded from the template selector',()=>{
 const page={index:0,layout_hint:'hero',creative_style:'hero_editorial',title:'Legacy',subtitle:null,stickers:[],sticker_positions:{},items:[{asset_id:id(10),source_snapshot_ids:[],overlay_text:null}]};
 const doc=compositionFromTravelBookPage({page,compositionId:id(1),pageId:id(2),makeId:ids()});doc.metadata.label='Custom saved presentation';
 assert.match(travelBookTemplateRestriction(doc),/presentació pròpia/);
 assert.equal(applyTravelBookComposition(page,doc).title,'Legacy');
});

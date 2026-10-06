import test from 'node:test';
import assert from 'node:assert/strict';
import {compositionFromTravelBookPage,applyTravelBookComposition,applyTravelBookDocuments} from '../domain/travel-book-editor-state.mjs';

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

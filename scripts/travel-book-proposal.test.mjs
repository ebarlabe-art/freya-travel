import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInitialTravelBookProposal,validateInitialTravelBookProposal} from '../domain/travel-book-proposal.mjs';

const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const base={trip_id:id(1),book_id:id(2),title:'Eivissa i Formentera'};

test('ALB-04 deterministic base groups ready photos by explicit date and leaves undated separate',()=>{
 const proposal=buildInitialTravelBookProposal({...base,photos:[
  {asset_id:id(10),status:'ready',local_date:'2026-09-11',selection_index:1,width_px:1200,height_px:1600,title:'Cala'},
  {asset_id:id(11),status:'ready',local_date:'2026-09-11',selection_index:0,width_px:1600,height_px:1200,title:'Posta de sol'},
  {asset_id:id(12),status:'ready',title:'Sense context'}
 ]});
 assert.deepEqual(proposal.sections.map(x=>[x.key,x.items.map(i=>i.asset_id)]),[
  ['day:2026-09-11',[id(11),id(10)]],
  ['memories:undated',[id(12)]]
 ]);
 assert.equal(proposal.stats.ready_photos,3);
 assert.deepEqual(proposal.warnings,['photos_without_date_context']);
 assert.equal(validateInitialTravelBookProposal(proposal),true);
});

test('ALB-04 ignores pending/missing assets instead of presenting them as usable',()=>{
 const proposal=buildInitialTravelBookProposal({...base,photos:[
  {asset_id:id(10),status:'pending',local_date:'2026-09-10'},
  {asset_id:id(11),status:'missing',local_date:'2026-09-10'}
 ]});
 assert.equal(proposal.cover,null);
 assert.equal(proposal.sections.length,0);
 assert.deepEqual(proposal.warnings,['no_ready_assets']);
});

test('ALB-04 cover choice is deterministic and prefers a suitable landscape rendering',()=>{
 const photos=[
  {asset_id:id(20),status:'ready',width_px:1200,height_px:1600},
  {asset_id:id(21),status:'ready',width_px:1600,height_px:1200},
  {asset_id:id(22),status:'ready',width_px:800,height_px:600}
 ];
 const a=buildInitialTravelBookProposal({...base,photos});
 const b=buildInitialTravelBookProposal({...base,photos:[...photos].reverse()});
 assert.equal(a.cover.asset_id,id(21));
 assert.deepEqual(a,b);
});

test('ALB-04 treats photo titles only as attributed user statements, never as invented facts',()=>{
 const proposal=buildInitialTravelBookProposal({...base,photos:[{asset_id:id(10),status:'ready',title:'Vam nedar amb dofins',title_reviewed:true,source_snapshot_ids:[id(30)]}]});
 const item=proposal.sections[0].items[0];
 assert.equal(item.caption_candidate,'Vam nedar amb dofins');
 assert.equal(item.caption_classification,'user_statement');
 assert.deepEqual(item.source_snapshot_ids,[id(30)]);
 assert.equal('narrative' in item,false);
 assert.equal('fact' in item,false);
});

test('ALB-04 does not reuse unreviewed free-text photo titles',()=>{
 const proposal=buildInitialTravelBookProposal({...base,photos:[{asset_id:id(10),status:'ready',title:'Dada privada no revisada'}]});
 assert.equal(proposal.sections[0].items[0].caption_candidate,null);
 assert.equal(proposal.sections[0].items[0].caption_classification,null);
});

test('ALB-04 output does not leak storage paths, file names or arbitrary source fields',()=>{
 const proposal=buildInitialTravelBookProposal({...base,photos:[{
  asset_id:id(10),status:'ready',title:'Record',storage_path:'private/secret.heic',file_name:'IMG_SECRET.HEIC',reservation_code:'SECRET'
 }]});
 const raw=JSON.stringify(proposal);
 assert.doesNotMatch(raw,/private\/secret|IMG_SECRET|SECRET/);
});

test('ALB-04 rejects invalid scope',()=>{
 assert.throws(()=>buildInitialTravelBookProposal({...base,trip_id:'bad',photos:[]}),error=>error.code==='ALB04_INVALID_SCOPE');
});


test('ALB-04 creates bounded deterministic pages for a navigable first book',()=>{
 const photos=Array.from({length:13},(_,i)=>({asset_id:id(100+i),status:'ready',local_date:'2026-09-12',selection_index:i,width_px:1600,height_px:1200}));
 const proposal=buildInitialTravelBookProposal({...base,photos});
 const section=proposal.sections[0];
 assert.deepEqual(section.pages.map(page=>page.items.length),[5,6,2]);
 assert.deepEqual(section.pages.map(page=>page.index),[0,1,2]);
 assert.equal(section.pages.flatMap(page=>page.items.map(item=>item.asset_id)).join('|'),section.items.map(item=>item.asset_id).join('|'));
 assert.equal(validateInitialTravelBookProposal(proposal),true);
});


test('ALB-05 creative layer assigns the three supported visual styles deterministically',()=>{
 const photos=Array.from({length:15},(_,i)=>({asset_id:id(200+i),status:'ready',local_date:'2026-09-12',selection_index:i,width_px:1600,height_px:1200}));
 const proposal=buildInitialTravelBookProposal({...base,photos});
 assert.equal(proposal.engine.creative_layer,'alb05-warm-editorial-v1');
 const styles=proposal.sections[0].pages.map(page=>page.creative_style);
 assert.deepEqual(styles,['scrapbook','scrapbook','narrative']);
 assert.ok(proposal.sections[0].pages.every(page=>page.title&&Array.isArray(page.stickers)));
 assert.equal(validateInitialTravelBookProposal(proposal),true);
});

test('ALB-05 promotes an explicit reviewed photo comment into narrative copy without inventing text',()=>{
 const proposal=buildInitialTravelBookProposal({...base,photos:[
  {asset_id:id(250),status:'ready',local_date:'2026-09-10',selection_index:0,width_px:1200,height_px:1600,title:'Primer bany a Cala Comte',title_reviewed:true,source_snapshot_ids:[id(251)]}
 ]});
 const page=proposal.sections[0].pages[0];
 assert.equal(page.creative_style,'narrative');
 assert.equal(page.subtitle,'Primer bany a Cala Comte');
 assert.equal(page.subtitle_classification,'user_statement');
 assert.deepEqual(page.stickers,['quote','sparkle']);
 assert.equal(validateInitialTravelBookProposal(proposal),true);
});


test('ALB-05.3 avoids neutral title repetition inside the same album',()=>{
 const photos=Array.from({length:36},(_,i)=>({asset_id:id(300+i),status:'ready',local_date:i<18?'2026-09-10':'2026-09-11',selection_index:i,width_px:1600,height_px:1200}));
 const proposal=buildInitialTravelBookProposal({...base,photos});
 const titles=proposal.sections.flatMap(section=>section.pages.map(page=>page.title));
 assert.equal(new Set(titles).size,titles.length);
});

test('ALB-05.3 edits one page without regenerating the rest of the proposal',async()=>{
 const mod=await import('../domain/travel-book-proposal.mjs');
 const proposal=buildInitialTravelBookProposal({...base,photos:[
  {asset_id:id(400),status:'ready',local_date:'2026-09-10',selection_index:0,width_px:1600,height_px:1200},
  {asset_id:id(401),status:'ready',local_date:'2026-09-10',selection_index:1,width_px:1600,height_px:1200}
 ]});
 const before=JSON.stringify(proposal.sections[0].pages[0].items);
 const edited=mod.editTravelBookPage(proposal,{section_index:0,page_index:0,title:'El nostre primer dia',subtitle:'',creative_style:'scrapbook',stickers:['heart','tape']});
 assert.equal(edited.sections[0].pages[0].title,'El nostre primer dia');
 assert.equal(edited.sections[0].pages[0].subtitle,null);
 assert.equal(edited.sections[0].pages[0].creative_style,'scrapbook');
 assert.deepEqual(edited.sections[0].pages[0].stickers,['heart','tape']);
 assert.equal(JSON.stringify(edited.sections[0].pages[0].items),before);
 assert.equal(proposal.sections[0].pages[0].title==='El nostre primer dia',false);
 assert.equal(validateInitialTravelBookProposal(edited),true);
});

test('ALB-05.3 proposes a different neutral title for a page',async()=>{
 const mod=await import('../domain/travel-book-proposal.mjs');
 const proposal=buildInitialTravelBookProposal({...base,photos:[{asset_id:id(500),status:'ready',local_date:'2026-09-10',width_px:1600,height_px:1200}]});
 const page=proposal.sections[0].pages[0];
 const alternative=mod.proposeAlternativeTravelBookTitle(page,[page.title]);
 assert.ok(alternative);
 assert.notEqual(alternative,page.title);
});

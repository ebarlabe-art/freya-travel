import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyComposition,validateComposition,resourceRefs} from '../domain/travel-book-composition.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('pending physical format, page/spread identities and strict envelope',()=>{
 const d=emptyComposition(id(1),[id(2)]);assert.ok(validateComposition(d));
 assert.ok(validateComposition(emptyComposition(id(1),[id(2),id(3)])));
 for(const bad of [{...d,extra:true},{...d,schema_version:2},{...d,page_ids:[id(2),id(2)]},{...d,canvas:{unit:'px',width:1,height:1}},{...d,canvas:{unit:'mm',width:1,height:null}}])assert.equal(validateComposition(bad),false);
});
test('image crop, unique elements, finite geometry and resource extraction',()=>{
 const d=emptyComposition(id(1),[id(2)]);d.canvas={unit:'mm',width:100,height:100};
 const e={id:id(3),type:'image',geometry:{x:0,y:0,width:10,height:10,rotation:0},locks:{content:false,geometry:false},asset_id:id(4),crop:{x:0,y:0,width:1,height:1}};
 d.elements=[e];assert.ok(validateComposition(d));assert.equal(resourceRefs(d)[0].asset_id,id(4));
 d.elements=[e,e];assert.equal(validateComposition(d),false);d.elements=[e];e.crop.x=.1;assert.equal(validateComposition(d),false);e.crop.x=0;e.geometry.x=Infinity;assert.equal(validateComposition(d),false);
});
test('text sources are typed; no arbitrary payload or oversized document',()=>{
 const d=emptyComposition(id(1),[id(2)]);d.canvas={unit:'mm',width:100,height:100};
 d.elements=[{id:id(3),type:'text',role:'caption',text:'Record',source_snapshot_ids:[id(4)],geometry:{x:0,y:0,width:10,height:10,rotation:0},locks:{content:true,geometry:false}}];
 assert.ok(validateComposition(d));assert.equal(resourceRefs(d)[0].usage,'text_source');
 d.elements[0].text='x'.repeat(16001);assert.equal(validateComposition(d),false);
});
test('unknown element kind, cross-page identity shape and byte safety fail closed',()=>{
 const d=emptyComposition(id(1),[id(2)]);d.canvas={unit:'mm',width:100,height:100};
 const e={id:id(3),type:'text',role:'body',text:'x',source_snapshot_ids:[],geometry:{x:0,y:0,width:1,height:1,rotation:0},locks:{content:false,geometry:false}};
 d.elements=[{...e,type:'map'}];assert.equal(validateComposition(d),false);
 d.elements=[{...e,text:'😀'.repeat(16000)}];assert.ok(validateComposition(d));
 d.elements=Array.from({length:5},(_,i)=>({...e,id:id(10+i),text:'😀'.repeat(16000)}));assert.equal(validateComposition(d),false);
 d.elements=[{...e,geometry:{...e.geometry,width:0}}];assert.equal(validateComposition(d),false);
 d.elements=[{...e,html:'<script>'}];assert.equal(validateComposition(d),false);
});

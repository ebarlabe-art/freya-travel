import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedCanvasSize,pageWithinBounds,mountPdfViewer} from '../domain/pdf-viewer.mjs';
import {readFileSync} from 'node:fs';
test('PDF pages are strictly bounded',()=>{
  assert.equal(pageWithinBounds(-5,4),1);
  assert.equal(pageWithinBounds(9,4),4);
  assert.equal(pageWithinBounds(2,4),2);
});
test('canvas keeps iPhone memory bounded and preserves ratio',()=>{
  const s=boundedCanvasSize(4000,6000,3);
  assert.ok(s.width*s.height<=5000000);
  assert.ok(Math.abs(s.width/s.height-2/3)<0.01);
  assert.equal(boundedCanvasSize(600,900,2).width,1200);
});
test('app uses an internal paginated PDF.js reader instead of iOS iframe',()=>{
  const src=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const chunk=src.slice(src.indexOf('function showDocumentViewer('),src.indexOf("$('documentViewerClose').onclick"));
  assert.match(chunk,/mountPdfViewer/);
  assert.match(chunk,/documentViewerPdfAbort/);
  assert.match(chunk,/isPdf/);
  assert.match(chunk,/createElement\('iframe'\)/);
});
test('local PDF.js engine and worker ship in the Pages build and PWA cache',()=>{
  const pack=readFileSync(new URL('../scripts/package-pages.mjs',import.meta.url),'utf8');
  const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  for(const file of ['pdf.mjs','pdf.worker.mjs']){
    assert.ok(pack.includes(file),'Pages missing '+file);
    assert.ok(sw.includes(file),'offline cache missing '+file);
  }
});
test('the reader keeps only one canvas page and cleans up on close',()=>{
  const src=readFileSync(new URL('../domain/pdf-viewer.mjs',import.meta.url),'utf8');
  assert.match(src,/pageSlot\.replaceChildren\(canvas\)/);
  assert.match(src,/loadingTask\?\.destroy\(\)/);
  assert.match(src,/renderToken\+\+/);
  assert.match(src,/signal\?\.aborted/);
});

function element(tag){
  return {
    tag,children:[],style:{},attributes:{},clientWidth:380,
    append(...children){for(const child of children){child.parentNode=this;this.children.push(child)}},
    replaceChildren(...children){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...children)},
    contains(child){return this===child||this.children.some(c=>c.contains(child))},
    setAttribute(key,value){this.attributes[key]=value},
    getContext(){return {}}
  };
}
test('PDF reader renders and navigates all pages with bounded memory',async()=>{
  const oldDocument=globalThis.document;
  globalThis.document={createElement:element};
  const renders=[],cleanups=[];
  const root=element('div');
  let destroyed=0;
  try{
    const reader=await mountPdfViewer({
      root,src:'blob:fake',fetcher:async()=>({ok:true,arrayBuffer:async()=>new Uint8Array([37,80,68,70]).buffer}),
      pixelRatio:()=>3,
      injectedPdfjs:{getDocument:()=>({promise:Promise.resolve({
        numPages:3,
        getPage:async n=>({
          getViewport:({scale})=>({width:200*scale,height:300*scale}),
          render:({canvas})=>{renders.push({n,width:canvas.width,height:canvas.height});return {promise:Promise.resolve(),cancel(){}}},
          cleanup:()=>cleanups.push(n)
        }),
        destroy:()=>{destroyed++}
      }),destroy(){}})}
    });
    const [toolbar,scroll]=root.children;
    const [previous,count,next,smaller,larger]=toolbar.children;
    assert.match(count.textContent,/1 de 3/);
    assert.equal(renders.at(-1).n,1);
    assert.equal(previous.disabled,true);
    next.onclick();
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(renders.at(-1).n,2);
    assert.match(count.textContent,/2 de 3/);
    next.onclick();
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(renders.at(-1).n,3);
    assert.equal(next.disabled,true);
    larger.onclick();
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(renders.at(-1).n,3);
    assert.ok(renders.every(row=>row.width*row.height<=5000000));
    assert.equal(scroll.children[0].children.length,1);
    reader.dispose();
    assert.equal(root.children.length,0);
    assert.equal(destroyed>0,true);
    assert.ok(cleanups.length>0);
  }finally{globalThis.document=oldDocument}
});
test('offline loading is fetchable from an existing Blob URL and abortable',async()=>{
  const oldDocument=globalThis.document;
  globalThis.document={createElement:element};
  const root=element('div');
  try{
    const abort=new AbortController();
    const fetches=[];
    const reader=await mountPdfViewer({
      root,src:'blob:private-copy',signal:abort.signal,
      fetcher:async(url)=>{fetches.push(url);return {ok:true,arrayBuffer:async()=>new Uint8Array([37,80,68,70]).buffer}},
      injectedPdfjs:{getDocument:()=>({promise:Promise.resolve({
        numPages:1,getPage:async()=>({getViewport:({scale})=>({width:100*scale,height:200*scale}),render:()=>({promise:Promise.resolve(),cancel(){}}),cleanup(){}}),destroy(){}
      }),destroy(){}})}
    });
    assert.deepEqual(fetches,['blob:private-copy']);
    reader.dispose();
    abort.abort();
    assert.equal(root.children.length,0);
  }finally{globalThis.document=oldDocument}
});

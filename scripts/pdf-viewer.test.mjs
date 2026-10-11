import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedCanvasSize,pageWithinBounds} from '../domain/pdf-viewer.mjs';
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
  const chunk=src.slice(src.indexOf('function showDocumentViewer('),src.indexOf("document.getElementById('documentViewerClose')"));
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

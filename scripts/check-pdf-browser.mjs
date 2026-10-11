// Browser acceptance test for the actual PDF.js runtime bundled in GitHub Pages.
// Generates a minimal public synthetic three-page PDF; no user documents or external APIs.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

function samplePdf(){
  const objects=[null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 5 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 8 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 9 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  for(let i=1;i<=3;i++){
    const stream='BT /F1 30 Tf 70 700 Td (Page '+i+' of 3) Tj ET\n';
    objects.push('<< /Length '+Buffer.byteLength(stream)+' >>\nstream\n'+stream+'endstream');
  }
  let source='%PDF-1.4\n',offsets=[0];
  for(let i=1;i<objects.length;i++){
    offsets.push(Buffer.byteLength(source));
    source+=i+' 0 obj\n'+objects[i]+'\nendobj\n';
  }
  const xref=Buffer.byteLength(source);
  source+='xref\n0 '+objects.length+'\n0000000000 65535 f \n';
  for(let i=1;i<objects.length;i++)source+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  source+='trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
  return Buffer.from(source);
}
const root=fileURLToPath(new URL('../',import.meta.url)),dist=resolve(root,'dist');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=samplePdf();
const html=String.raw`<!doctype html><html lang="ca"><meta charset="utf-8"><title>Freya PDF test</title><style>
body{margin:0;background:#faf8ff;font-family:system-ui}
#viewer{height:680px;width:375px;max-width:100vw;display:grid}
.freya-pdf-viewer{display:flex;flex-direction:column;min-height:0;min-width:0}
.freya-pdf-controls{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.freya-pdf-controls button{min-height:44px}
.freya-pdf-scroll{flex:1;overflow:auto;min-height:0}
.freya-pdf-page{display:flex;justify-content:center;align-items:flex-start;min-width:min-content}
</style><div id="viewer"></div><script type="module">
import {mountPdfViewer} from './domain/pdf-viewer.mjs';
window.viewerPromise=mountPdfViewer({root:document.querySelector('#viewer'),src:'./three-pages.pdf'});
window.reader=await window.viewerPromise;
window.replaceWithBlob=async()=>{
  const bytes=await(await fetch('./three-pages.pdf')).arrayBuffer();
  window.reader.dispose();
  window.blobUrl=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
  window.reader=await mountPdfViewer({root:document.querySelector('#viewer'),src:window.blobUrl});
};
</script></html>`;
const mime={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'};
const server=createServer(async(request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(url.pathname==='/freya-travel/'){response.writeHead(200,{'Content-Type':'text/html'}).end(html);return}
  if(url.pathname==='/freya-travel/three-pages.pdf'){response.writeHead(200,{'Content-Type':'application/pdf','Content-Length':fixture.length,'Cache-Control':'no-store'}).end(fixture);return}
  if(!url.pathname.startsWith('/freya-travel/')){response.writeHead(404).end();return}
  const path=resolve(dist,url.pathname.slice('/freya-travel/'.length));
  if(!path.startsWith(dist+sep)){response.writeHead(404).end();return}
  try{const bytes=await readFile(path);response.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'}).end(bytes)}
  catch{response.writeHead(404).end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
try{
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}}),page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/freya-travel/',{waitUntil:'load'});
  const count=page.locator('.freya-pdf-count'),canvas=page.locator('canvas.freya-pdf-canvas');
  await count.getByText('Pàgina 1 de 3').waitFor({timeout:15000});
  assert.equal(await canvas.count(),1);
  await page.getByRole('button',{name:'Pàgina següent'}).click();
  await count.getByText('Pàgina 2 de 3').waitFor();
  await page.getByRole('button',{name:'Pàgina següent'}).click();
  await count.getByText('Pàgina 3 de 3').waitFor();
  assert.equal(await canvas.count(),1);
  assert.equal(await page.getByRole('button',{name:'Pàgina següent'}).isDisabled(),true);
  const before=await canvas.evaluate(c=>c.width);
  await page.getByRole('button',{name:'Amplia la pàgina'}).click();
  await page.waitForFunction(width=>document.querySelector('canvas.freya-pdf-canvas')?.width>width,before);
  await page.evaluate(()=>window.replaceWithBlob());
  await count.getByText('Pàgina 1 de 3').waitFor();
  await page.route('**/three-pages.pdf',route=>route.abort());
  await page.getByRole('button',{name:'Pàgina següent'}).click();
  await count.getByText('Pàgina 2 de 3').waitFor();
  await page.evaluate(()=>{window.reader.dispose();URL.revokeObjectURL(window.blobUrl)});
  assert.equal(await page.locator('.freya-pdf-canvas').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS real PDF.js: 3 pages, zoom, one canvas, offline Blob source, disposal');
  await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r))}

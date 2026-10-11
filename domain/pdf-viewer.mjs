// Freya Travel: private PDF reader; renders one page at a time to bound iPhone memory.
// The PDF bytes come from the existing signed URL or encrypted offline copy.
// PDF.js and its worker are local, pre-cached application assets.
export function boundedCanvasSize(width,height,ratio=1,maxPixels=5000000){
  const w=Number(width),h=Number(height),d=Number(ratio);
  if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0)throw new Error('Mida de pàgina no vàlida.');
  const density=Math.max(1,Math.min(Number.isFinite(d)?d:1,2));
  const reduction=Math.min(1,Math.sqrt(maxPixels/(w*h*density*density)));
  const factor=density*reduction;
  return {width:Math.max(1,Math.round(w*factor)),height:Math.max(1,Math.round(h*factor)),factor};
}
export function pageWithinBounds(page,count){
  return Math.max(1,Math.min(Math.max(1,count),Number(page)||1));
}
const create=(tag,className,text)=>{
  const element=document.createElement(tag);
  if(className)element.className=className;
  if(text!==undefined)element.textContent=text;
  return element;
};
export async function mountPdfViewer({root,src,signal,isCurrent=()=>true,pdfjs:injectedPdfjs=null,fetcher=fetch,pixelRatio=()=>window.devicePixelRatio||1}){
  if(!root||!src)throw new Error('Document PDF no disponible.');
  let disposed=false,loadingTask=null,pdf=null,activeRender=null,renderToken=0,pageNumber=1,zoom=1;
  const live=()=>!disposed&&!signal?.aborted&&isCurrent();
  const dispose=()=>{
    if(disposed)return;
    disposed=true;renderToken++;
    try{activeRender?.cancel()}catch(_){}
    try{loadingTask?.destroy()}catch(_){}
    try{pdf?.destroy()}catch(_){}
    // Do not clear a newer viewer mounted into the same parent after close/reopen.
    if(root.contains(toolbar))root.replaceChildren();
  };
  const toolbar=create('div','freya-pdf-controls');
  const previous=create('button','','← Anterior'),next=create('button','','Següent →');
  const counter=create('output','freya-pdf-count','Carregant PDF…');
  const smaller=create('button','','−'),larger=create('button','','+');
  for(const button of [previous,next,smaller,larger])button.type='button';
  previous.setAttribute('aria-label','Pàgina anterior');
  next.setAttribute('aria-label','Pàgina següent');
  smaller.setAttribute('aria-label','Redueix la pàgina');
  larger.setAttribute('aria-label','Amplia la pàgina');
  counter.setAttribute('aria-live','polite');
  toolbar.append(previous,counter,next,smaller,larger);
  const scroll=create('div','freya-pdf-scroll');
  const pageSlot=create('div','freya-pdf-page');
  scroll.append(pageSlot);
  root.replaceChildren(toolbar,scroll);
  const renderError=(error)=>{
    if(!live()||error?.name==='RenderingCancelledException'||error?.name==='AbortError')return;
    pageSlot.replaceChildren(create('p','freya-pdf-error','No s’ha pogut mostrar aquesta pàgina. Torna-ho a provar.'));
    counter.textContent='Error de visualització';
  };
  const updateButtons=()=>{
    previous.disabled=pageNumber<=1;
    next.disabled=!pdf||pageNumber>=pdf.numPages;
    smaller.disabled=zoom<=0.75;
    larger.disabled=zoom>=3;
    counter.textContent=pdf?'Pàgina '+pageNumber+' de '+pdf.numPages:'Carregant PDF…';
  };
  const renderPage=async()=>{
    if(!live()||!pdf)return;
    const turn=++renderToken;
    try{activeRender?.cancel()}catch(_){}
    const page=await pdf.getPage(pageNumber);
    if(!live()||turn!==renderToken)return;
    const base=page.getViewport({scale:1});
    const available=Math.max(100,root.clientWidth-30);
    const scale=(available/base.width)*zoom;
    const viewport=page.getViewport({scale});
    const dims=boundedCanvasSize(viewport.width,viewport.height,pixelRatio());
    const canvas=create('canvas','freya-pdf-canvas');
    canvas.width=dims.width;canvas.height=dims.height;
    canvas.style.width=Math.round(viewport.width)+'px';
    canvas.style.height=Math.round(viewport.height)+'px';
    const context=canvas.getContext('2d',{alpha:false});
    if(!context)throw new Error('Canvas no disponible');
    activeRender=page.render({
      canvas,canvasContext:context,viewport,
      transform:[dims.factor,0,0,dims.factor,0,0]
    });
    try{await activeRender.promise}catch(error){
      if(error?.name==='RenderingCancelledException'||!live()||turn!==renderToken)return;
      throw error;
    }
    if(!live()||turn!==renderToken)return;
    pageSlot.replaceChildren(canvas);
    scroll.scrollTop=0;scroll.scrollLeft=0;
    updateButtons();
    try{page.cleanup()}catch(_){}
  };
  const paint=()=>{void renderPage().catch(renderError)};
  previous.onclick=()=>{if(pageNumber>1){pageNumber--;updateButtons();paint()}};
  next.onclick=()=>{if(pdf&&pageNumber<pdf.numPages){pageNumber++;updateButtons();paint()}};
  smaller.onclick=()=>{zoom=Math.max(0.75,Math.round((zoom-0.25)*100)/100);updateButtons();paint()};
  larger.onclick=()=>{zoom=Math.min(3,Math.round((zoom+0.25)*100)/100);updateButtons();paint()};
  try{
    const library=injectedPdfjs||await import(new URL('../vendor/pdf.mjs',import.meta.url).href);
    if(!live())return {dispose};
    if(!injectedPdfjs)library.GlobalWorkerOptions.workerSrc=new URL('../vendor/pdf.worker.mjs',import.meta.url).href;
    const response=await fetcher(src,{signal});
    if(!response.ok)throw new Error('No s’ha pogut llegir el PDF.');
    const bytes=await response.arrayBuffer();
    if(!live())return {dispose};
    loadingTask=library.getDocument({data:new Uint8Array(bytes)});
    pdf=await loadingTask.promise;
    if(!live()){dispose();return {dispose}}
    if(!Number.isInteger(pdf.numPages)||pdf.numPages<1)throw new Error('PDF sense pàgines.');
    updateButtons();
    await renderPage();
    if(!live())dispose();
    return {dispose};
  }catch(error){
    dispose();
    throw error;
  }
}

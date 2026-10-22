import {GUIDE_SECTIONS,culturalPlaces,guidePlaceKey,emptyCulturalGuide,validateCulturalGuide,culturalNarration} from './cultural-guide.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const errors={identity_mismatch:'La font no correspon exactament a aquest lloc. No s’ha creat cap fitxa.',place_changed:'La ubicació ha canviat. Torna a obrir la visita.',not_configured:'La generació encara no està configurada. Pots escriure la fitxa manualment.',rate_limited:'S’ha assolit el límit de consultes. Torna-ho a provar més tard.',source_unavailable:'La font no està disponible. No inventarem informació.',unauthorized:'Cal validar la sessió per consultar fonts.',unavailable:'No es pot accedir a aquesta visita.'};
export function createCulturalGuideController(api){
 const {dialog,root,db,narration}=api;let state=null,epoch=0,channel=null;
 const valid=s=>state===s&&api.current(s.scope),status=text=>{const node=root.querySelector('[data-guide-status]');if(node)node.textContent=text};
 function stop(){narration.stop()}
 function cleanup(){epoch++;stop();if(channel){db.removeChannel(channel);channel=null}}
 function reset(){cleanup();state=null;if(dialog.open)dialog.close();root.replaceChildren()}
 function requestClose(notify=true){if(state?.dirty&&!confirm('Tens una fitxa sense desar al viatge. Vols tancar-la i conservar l’esborrany local?'))return false;reset();if(notify)api.onClose();return true}
 dialog.addEventListener('cancel',e=>{e.preventDefault();requestClose()});
 function cachedRows(){return Array.isArray(api.cacheRead()?.culturalGuides)?api.cacheRead().culturalGuides:[]}
 function validDocument(document,key){try{return validateCulturalGuide(document,key)}catch{return null}}
 function persistRow(row,key){const rows=cachedRows().filter(r=>r.place_key!==key);if(row)rows.push(row);api.cacheWrite({culturalGuides:rows})}
 function draft(s,remove=false){const drafts=(api.cacheRead()?.culturalGuideDrafts||[]).filter(d=>d.place_key!==s.placeKey);if(!remove)drafts.push({place_key:s.placeKey,revision:s.revision,document:s.document});return api.cacheWrite({culturalGuideDrafts:drafts})}
 function placeCurrent(s){const source=api.source(s.key);return valid(s)&&!!source&&culturalPlaces(source.row).some(p=>guidePlaceKey(p)===s.placeKey)}
 async function load(s,background=false){
  if(!placeCurrent(s))return;if(api.offline()){s.loading=false;render();return}
  const sequence=++s.loadSequence,placeKey=s.placeKey;
  const result=await db.from('trip_cultural_guides').select('*').eq('trip_id',s.scope.tripId).eq('place_key',s.placeKey).maybeSingle();
  if(!placeCurrent(s)||s.placeKey!==placeKey||sequence!==s.loadSequence)return;
  s.loading=false;s.backendReady=!result.error;
  if(result.error){render();status('No s’ha pogut actualitzar la fitxa compartida. La còpia local continua disponible; no es poden desar canvis al servidor.');return}
  const row=result.data&&validDocument(result.data.document,s.placeKey)?result.data:null;
  persistRow(row,s.placeKey);
  if(s.dirty||background&&s.editing){if((row?.revision||0)!==s.revision){s.conflict=true;render();status('La fitxa compartida ha canviat. Conservem el teu esborrany; carrega la versió compartida abans de tornar a editar.')}return}
  s.row=row;s.revision=row?.revision||0;s.document=row?structuredClone(row.document):emptyCulturalGuide(s.place);render();
 }
 async function selectPlace(s,index){
  if(!valid(s)||s.saving)return;const place=s.places[index];if(!place)return;
  if(s.dirty&&!confirm('Vols canviar de lloc? Conservarem l’esborrany local sense compartir-lo.'))return;
  cleanup();const key=guidePlaceKey(place),row=cachedRows().find(r=>r.place_key===key&&r.trip_id===s.scope.tripId&&validDocument(r.document,key));
  const savedDraft=(api.cacheRead()?.culturalGuideDrafts||[]).find(d=>d.place_key===key&&validDocument(d.document,key));
  Object.assign(s,{place,placeKey:key,row,revision:savedDraft?.revision??row?.revision??0,document:savedDraft?.document||row?.document||emptyCulturalGuide(place),editing:!!savedDraft,dirty:!!savedDraft,conflict:false,backendReady:false,loading:!api.offline(),loadSequence:(s.loadSequence||0)+1,requestSequence:(s.requestSequence||0)+1,language:'ca',busy:false,candidates:[],reviewed:false});render();
  if(!api.offline()){
   const watchedKey=key;
   channel=db.channel('culture-'+s.scope.tripId+'-'+(row?.id||'new')).on('postgres_changes',{event:'*',schema:'public',table:'trip_cultural_guides',filter:`trip_id=eq.${s.scope.tripId}`},()=>{if(placeCurrent(s)&&s.placeKey===watchedKey)void load(s,true)}).subscribe();
  }
  await load(s);
 }
 function currentDocument(s){if(!placeCurrent(s))throw Error('La ubicació ha canviat. Tanca i torna a obrir la visita.');return validateCulturalGuide(s.document,s.placeKey)}
 async function save(s){
  if(!placeCurrent(s)||api.offline()||s.saving||!s.backendReady||s.conflict)return;
  try{
   stop();const document=currentDocument(s);if(!Object.values(document.sections).some(v=>v.text.trim()))throw Error('Escriu almenys una secció abans de desar.');
   if(Object.values(document.sections).some(v=>v.text.trim()&&v.origin==='proposal')&&!root.querySelector('[data-guide-reviewed]')?.checked)throw Error('Revisa el lloc i les fonts i confirma la revisió abans de desar la proposta.');
   s.saving=true;render();status('Desant la fitxa…');
   const payload={document};
   const result=s.row?await db.from('trip_cultural_guides').update(payload).eq('trip_id',s.scope.tripId).eq('id',s.row.id).eq('revision',s.revision).select('*').maybeSingle():await db.from('trip_cultural_guides').insert({...payload,id:crypto.randomUUID(),trip_id:s.scope.tripId,place_key:s.placeKey,place:s.place,created_by:s.scope.userId}).select('*').single();
   if(!placeCurrent(s))return;
   if(result.error||!result.data){s.saving=false;if(result.error?.code==='23505'||!result.error){s.conflict=true;render();status('Una altra persona ja ha desat o canviat aquesta fitxa. El teu esborrany es conserva; carrega la versió compartida.');return}throw Error(result.error?.code==='42501'?'No tens permís per desar aquesta fitxa. Revisa l’accés al viatge.':'No s’ha pogut confirmar el desament al servidor. Conservem l’esborrany local.')}
   const row=result.data;validateCulturalGuide(row.document,s.placeKey);s.row=row;s.revision=row.revision;s.document=row.document;s.dirty=false;s.editing=false;s.saving=false;persistRow(row,s.placeKey);draft(s,true);render();status('Fitxa desada al viatge. Disponible per a lectura offline en aquest dispositiu.');
  }catch(error){if(valid(s)){s.saving=false;render();status(error?.message||'No s’ha pogut confirmar el desament. Conservem l’esborrany local.')}}
 }
 async function sourceRequest(s,action,pageid){
  if(!placeCurrent(s)||api.offline()||s.busy)return;
  const token=++s.requestSequence,placeKey=s.placeKey,language=root.querySelector('[data-guide-language]')?.value||'ca';s.language=language;s.busy=true;status(action==='search'?'Cercant fonts públiques del lloc…':'Preparant una proposta basada en la font…');
  const source=api.source(s.key),request={action,trip_id:s.scope.tripId,source_type:source.item.sourceType,source_id:source.item.sourceId,place_key:s.placeKey,language,...(pageid?{pageid}:{})};
  try{
   const {data,error}=await db.functions.invoke('cultural-guide',{body:request});if(!placeCurrent(s)||s.placeKey!==placeKey||token!==s.requestSequence)return;
   if(error||data?.error)throw Error(errors[data?.error]||'No s’ha pogut consultar la font. Pots escriure la fitxa sense enviar documents ni reserves.');
   if(action==='search'){s.candidates=Array.isArray(data?.candidates)?data.candidates.filter(c=>Number.isSafeInteger(c.pageid)&&typeof c.title==='string'&&c.language===language).slice(0,6):[];render();status(s.candidates.length?'Tria l’article que correspon al lloc. Es comprovarà la identitat abans de preparar el text.':'No hem trobat una font en aquesta llengua. Prova una altra llengua o escriu la fitxa manualment.');}
   else{
    const document=validateCulturalGuide(data.document,s.placeKey);s.document=document;s.dirty=true;s.editing=true;s.reviewed=false;draft(s);render();status('Proposta no desada. Comprova el lloc, els textos i les cites originals abans de desar. Les dades que la font no acredita queden buides.');
   }
  }catch(error){if(valid(s))status(error?.message||'La font no està disponible.')}
  finally{if(valid(s)&&token===s.requestSequence)s.busy=false}
 }
 function render(){
  const s=state;if(!s||!api.current(s.scope))return;
  const offline=api.offline();
  root.innerHTML=`<div class="cultural-guide-top"><div><small>Guia cultural en català</small><h2 id="culturalGuideHeading">${esc(s.place?.canonical_name||s.title)}</h2><p>${esc(s.place?[s.place.locality,s.place.country_code].filter(Boolean).join(' · '):'Tria el lloc de la visita')}</p></div><button type="button" data-guide-close aria-label="Tanca la guia cultural">✕</button></div><p data-guide-status role="status" aria-live="polite" class="cultural-guide-status">${offline?'📵 Consulta offline: les veus poden requerir una descàrrega prèvia al dispositiu.':s.loading?'Carregant la fitxa…':s.dirty?'Esborrany local, encara no compartit.':s.row?'Fitxa desada. Els textos i les fonts indiquen la seva procedència.':'Cap fitxa desada per a aquest lloc.'}</p><div class="guide-actions">${(s.places.length>1?s.places:[]).map((p,i)=>`<button type="button" data-guide-place="${i}" aria-pressed="${s.placeKey===guidePlaceKey(p)}">📍 ${esc(p.canonical_name)}</button>`).join('')}</div>${!s.places.length?'<p>Cal confirmar la ubicació exacta de cada monument des del planning. Una ubicació propera o un nom ambigu no són suficients per preparar la guia.</p>':''}${s.place?content(s,offline):''}`;
  root.querySelector('[data-guide-close]').onclick=()=>requestClose();
  root.querySelectorAll('[data-guide-place]').forEach(b=>b.onclick=()=>{void selectPlace(s,Number(b.dataset.guidePlace))});
  if(!s.place)return;
  root.querySelector('[data-guide-edit]')?.addEventListener('click',()=>{if(!placeCurrent(s)||api.offline())return;stop();s.editing=true;render()});
  root.querySelector('[data-guide-reload]')?.addEventListener('click',()=>{if(s.dirty&&!confirm('Vols descartar l’esborrany local i carregar la fitxa compartida?'))return;s.dirty=false;s.editing=false;s.conflict=false;draft(s,true);void load(s)});
  root.querySelector('[data-guide-save]')?.addEventListener('click',()=>{void save(s)});
  root.querySelectorAll('[data-guide-section]').forEach(input=>input.addEventListener('input',()=>{if(!placeCurrent(s)||api.offline())return;stop();const section=s.document.sections[input.dataset.guideSection];section.text=input.value;section.origin='user';s.dirty=true;s.reviewed=false;const check=root.querySelector('[data-guide-reviewed]');if(check)check.checked=false;status(draft(s)?'Esborrany local, encara no desat al viatge.':'No s’ha pogut conservar l’esborrany local. Mantén la fitxa oberta fins a desar.')}));
  root.querySelector('[data-guide-reviewed]')?.addEventListener('change',e=>{s.reviewed=e.target.checked});
  root.querySelector('[data-guide-search]')?.addEventListener('click',()=>{s.sourcesOpen=true;if(s.dirty&&!confirm('La nova proposta substituirà l’esborrany d’aquest lloc. Vols continuar?'))return;void sourceRequest(s,'search')});
  root.querySelectorAll('[data-guide-propose]').forEach(b=>b.onclick=()=>{void sourceRequest(s,'propose',Number(b.dataset.guidePropose))});
  root.querySelector('[data-guide-listen]')?.addEventListener('click',()=>{
   if(!placeCurrent(s))return;
   const text=s.place.canonical_name+'. '+culturalNarration(currentDocument(s));
   const fallback=root.querySelector('[data-guide-fallback]')?.checked===true;
   const started=narration.speak(text,{allowFallback:fallback,rate:Number(root.querySelector('[data-guide-rate]').value),onStart:({fallback})=>{if(valid(s))status(fallback?'Escoltant amb una veu alternativa; la pronunciació catalana pot variar.':'Escoltant la fitxa en català.')},onEnd:()=>{if(valid(s))status('Lectura finalitzada.')},onError:()=>{if(valid(s))status('La veu no està disponible o necessita connexió. Pots continuar llegint la fitxa.')},onStop:()=>{}});
   if(!started)status('No hi ha veu catalana disponible o encara s’està carregant. Pots continuar llegint, tornar a prémer Escolta o autoritzar una veu alternativa.');
  });
  root.querySelector('[data-guide-pause]')?.addEventListener('click',()=>{narration.pause();status('Lectura en pausa.')});
  root.querySelector('[data-guide-resume]')?.addEventListener('click',()=>{narration.resume();status('Lectura represa.')});
  root.querySelector('[data-guide-stop]')?.addEventListener('click',()=>{stop();status('Lectura aturada.')});
  root.querySelector('[data-guide-rate]')?.addEventListener('change',e=>{narration.rate(e.target.value);status('Velocitat actualitzada; es reprèn el fragment actual.')});
 }
 function content(s,offline){
  const document=s.document,disabled=offline||s.loading||s.saving;
  return `<div class="guide-actions" aria-label="Controls de lectura"><button type="button" data-guide-listen>Escolta</button><button type="button" data-guide-pause>Pausa</button><button type="button" data-guide-resume>Reprèn</button><button type="button" data-guide-stop>Atura</button><label>Velocitat <select data-guide-rate><option value="0.85">0,85×</option><option value="1" selected>1×</option><option value="1.15">1,15×</option></select></label></div><label><input type="checkbox" data-guide-fallback> Permet una veu alternativa si no hi ha veu catalana</label><div>${Object.entries(GUIDE_SECTIONS).map(([key,label])=>{const section=document.sections[key],provenance=section.origin==='proposal'?'Proposta basada en fonts · pendent de contrast':section.origin==='source'?'Transcripció d’una font':'Text aportat o editat per un membre · no verificat automàticament';return `<section class="cultural-guide-section"><h3>${esc(label)}</h3><small>${key==='suggestions'?'Recomanacions, no fets confirmats. ':''}${esc(provenance)}</small>${s.editing?`<label>${esc(label)}<textarea data-guide-section="${key}" maxlength="4000" ${disabled?'disabled':''}>${esc(section.text)}</textarea></label>`:`<p>${esc(section.text||'Sense informació acreditada en aquesta secció.')}</p>`}${section.evidence.length?`<details><summary>Cites de la font original</summary>${section.evidence.map(e=>`<blockquote>${esc(e.quote)}</blockquote>`).join('')}</details>`:''}</section>`}).join('')}</div><section class="cultural-guide-sources"><h3>Fonts i atribució</h3>${document.sources.length?document.sources.map(source=>`<p><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)}</a><br><small>${esc(source.license)}</small></p>`).join(''):'<p>Encara no hi ha fonts associades. No es presenta el text manual com a fet verificat.</p>'}</section>${!offline?`<details ${s.sourcesOpen?'open':''}><summary>Prepara una proposta amb fonts públiques</summary><p>S’envia només la identitat pública del lloc. No s’envien notes, documents personals ni reserves. La proposta no es desa fins que la revisis.</p><label>Llengua de la font<select data-guide-language><option value="ca" ${s.language==='ca'?'selected':''}>Català</option><option value="it" ${s.language==='it'?'selected':''}>Italià</option><option value="en" ${s.language==='en'?'selected':''}>Anglès</option></select></label><button type="button" data-guide-search>Cerca fonts</button>${s.candidates.map(c=>`<p>${esc(c.title)} <button type="button" data-guide-propose="${c.pageid}">Prepara la fitxa d’aquest lloc</button></p>`).join('')}</details>`:''}<div class="guide-actions">${!s.editing?`<button type="button" data-guide-edit ${disabled?'disabled':''}>Edita la fitxa</button>`:`<button type="button" data-guide-save ${disabled||!s.backendReady||s.conflict?'disabled':''}>Desa la fitxa al viatge</button>`}<button type="button" data-guide-reload ${offline||s.saving?'disabled':''}>Carrega versió compartida</button></div>${s.editing&&Object.values(document.sections).some(v=>v.text.trim()&&v.origin==='proposal')?`<label><input type="checkbox" data-guide-reviewed ${s.reviewed?'checked':''}> He comprovat que el lloc és correcte i he revisat la proposta i les fonts.</label>`:''}`;
 }
 async function open(key){
  if(state?.key===key&&dialog.open)return;
  if(state?.dirty&&!confirm('Vols canviar de visita conservant l’esborrany local?'))return;
  reset();const scope=api.scope(),source=api.source(key);if(!api.current(scope)||!source)return;
  state={scope,key,title:source.item.title,places:culturalPlaces(source.row),place:null,dirty:false,requestSequence:0};render();dialog.showModal();if(state.places.length===1)await selectPlace(state,0);
 }
 function reconcile(){if(state?.place&&!placeCurrent(state)){stop();status('La ubicació de la visita ha canviat. Aquesta fitxa conserva el lloc original. Tanca-la i torna a obrir la visita abans de desar.');root.querySelectorAll('textarea,[data-guide-save],[data-guide-search],[data-guide-propose]').forEach(node=>node.disabled=true)}}
 return {open,reset,requestClose,reconcile,isOpen:()=>!!state&&dialog.open,key:()=>state?.key};
}

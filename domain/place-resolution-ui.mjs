import {PlaceClient,placeLabel,primaryStop} from './place-resolution.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const messages={no_match:'No he trobat aquest lloc. Afegeix ciutat o país.',rate_limited:'S’han fet massa cerques. Torna-ho a provar més tard.',provider_unavailable:'Ara no podem consultar llocs. El text queda conservat.',invalid_response:'No hem pogut verificar la resposta.',conflict:'El resum ha canviat. Recarrega abans de continuar.'};
export async function mountPlaceSelector(root,{client,subject,text,briefRevision,current=()=>true,onConfirmed=()=>{}}){
 const api=new PlaceClient(client);let selected=null,revision=0,busy=false,operation=null;
 root.innerHTML=`<label>Ubicació<input maxlength="500" value="${esc(text)}"></label><button type="button" data-place-search>Cerca el lloc</button><p role="status"></p><div data-place-results></div>`;
 const status=root.querySelector('[role="status"]'),results=root.querySelector('[data-place-results]'),input=root.querySelector('input'),search=root.querySelector('button');
 const show=()=>{status.textContent=selected?`Lloc seleccionat: ${placeLabel(selected.place)}`:'Ubicació pendent de verificar';if(selected)status.textContent+=' · '+selected.place.attribution+' · Geoapify';if(selected?.place.timezone_status!=='verified'&&selected)status.textContent+=' · Tria una ubicació més concreta per poder construir el viatge.';};
 try{const rows=await api.getPlaceBinding(subject);if(!current())return;const b=rows.find(x=>x.subject_key===subject.key);if(b){selected=b.subject_current===false?null:b;revision=b.revision;}show()}catch{if(current())status.textContent='No s’ha pogut recuperar la ubicació.'}
 search.onclick=async()=>{if(busy||!current())return;busy=true;search.disabled=true;results.innerHTML='';status.textContent='Consultant ubicacions…';
 try{const data=await api.searchPlaces({text:input.value,language:'ca'});if(!current())return;status.textContent=data.candidates.length>1?'Quin lloc vols dir?':'Confirma aquest lloc';
 for(const candidate of data.candidates){const button=document.createElement('button');button.type='button';button.textContent=placeLabel(candidate.place);results.append(button);const attr=document.createElement('small');attr.textContent=candidate.place.attribution+' · Geoapify';results.append(attr);
 button.onclick=async()=>{if(busy||!current())return;busy=true;button.disabled=true;operation??=crypto.randomUUID();try{const b=await api.confirmPlace({subject,candidate_token:candidate.candidate_token,expected_revision:revision,expected_brief_revision:briefRevision(),operation_id:operation});if(!current())return;selected={...b,place:candidate.place};revision=b.revision;operation=null;results.innerHTML='';show();await onConfirmed(selected)}catch(e){if(current())status.textContent=messages[e.code]||'No s’ha pogut confirmar. Torna-ho a provar.'}finally{busy=false;button.disabled=false}};
 }
 }catch(e){if(current())status.textContent=messages[e.code]||'No s’ha pogut consultar el lloc.'}finally{busy=false;search.disabled=false}};
 return {get binding(){return selected}};
}
export async function mountProposalPlaces(root,{client,row,proposal,current}){
 root.innerHTML='<h4>Ubicacions del viatge</h4><p>Confirma els llocs. La zona horària es completarà automàticament.</p>';
 const selectors=new Map(),stops=proposal.document.candidate.route.stops;
 for(const stop of stops){const section=document.createElement('section');root.append(section);selectors.set(stop.id,await mountPlaceSelector(section,{client,subject:{brief_id:row.id,proposal_id:proposal.id,key:stop.id},text:stop.destination,briefRevision:()=>row.revision,current}));if(!current())return null;}
 const optional=new Set();
 for(const component of proposal.document.candidate.components){
 if(component.kind==='transport')continue;
 const section=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Ubicació pròpia: '+component.description;section.append(summary);const body=document.createElement('div');section.append(body);root.append(section);
 const selector=await mountPlaceSelector(body,{client,subject:{brief_id:row.id,proposal_id:proposal.id,key:component.id},text:'',briefRevision:()=>row.revision,current});selectors.set(component.id,selector);if(stops.some(s=>s.id===component.subject_id))optional.add(component.id);if(!current())return null;
 }
 const label=document.createElement('label');label.textContent='Base principal';const select=document.createElement('select');select.name='principal_stop_id';for(const s of stops){const option=document.createElement('option');option.value=s.id;option.textContent=s.destination;select.append(option)}select.value=primaryStop(proposal.document.candidate)||'';label.append(select);root.append(label);
 return {details(){const bindings={};for(const [key,selector]of selectors){const b=selector?.binding;if(!b&&optional.has(key))continue;if(!b||b.place?.timezone_status!=='verified')throw Error('Confirma una ubicació concreta per a cada parada.');bindings[key]=b.id;}if(!select.value)throw Error('Tria la base principal.');return {bindings,principal_stop_id:select.value}}};
}
export async function mountBriefPlaces(root,{client,row,current,onConfirmed}){
 root.innerHTML='';
 for(const [id,d]of Object.entries(row.document.decisions)){
 if(!['origin','destination'].includes(d.field)||d.knowledge!=='known'||!d.value.places)continue;
 for(const [index,text]of d.value.places.entries()){
 const section=document.createElement('section');root.append(section);await mountPlaceSelector(section,{client,subject:{brief_id:row.id,key:id+':'+index},text,briefRevision:()=>row.revision,current,onConfirmed});if(!current())return;
 }
 }
 if(!root.children.length)root.textContent='Indica una destinació o un origen per verificar-ne la ubicació.';
}

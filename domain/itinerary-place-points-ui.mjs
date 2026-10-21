import {MAX_POINTS,extractActivityPoints,savedActivityPoints,pointSnapshot,pointPlace,pointMapUrl,normalizePointName,matchingPointCandidate} from './itinerary-place-points.mjs';
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
// This is display-only: never change provider matches, the selected snapshot or auto-resolution.
// Only collapse equal names in the same city/country at almost the same coordinates.
const nearSamePoint=(a,b)=>{
 const north=(a.latitude-b.latitude)*111195;
 const east=(a.longitude-b.longitude)*111195*Math.cos((a.latitude+b.latitude)*Math.PI/360);
 return Number.isFinite(north)&&Number.isFinite(east)&&Math.hypot(north,east)<=120;
};
export function visiblePointCandidates(options){
 const shown=[];
 for(const p of options){
  const duplicate=shown.some(previous=>
   (p.provider_place_id&&p.provider_place_id===previous.provider_place_id)||
   (normalizePointName(p.canonical_name)&&normalizePointName(p.canonical_name)===normalizePointName(previous.canonical_name)&&
    p.country_code===previous.country_code&&
    (!p.locality||!previous.locality||normalizePointName(p.locality)===normalizePointName(previous.locality))&&nearSamePoint(p,previous))
  );
  if(!duplicate)shown.push(p);
 }
 return shown;
}
export function pointCandidateDescription(p){
 const name=normalizePointName(p.canonical_name);
 const segments=String(p.formatted_address||'').split(',').map(x=>x.trim()).filter(Boolean);
 const local=segments.find(x=>normalizePointName(x)!==name);
 const where=local||p.locality||p.country_code||'';
 return [where,p.coordinate_role==='representative_point'?'Zona aproximada':'Lloc exacte'].filter(Boolean).join(' · ');
}
const candidateStyles=`
 .activity-point-editor{font-size:14px;line-height:1.4}
 .activity-point-editor h4{margin:0 0 6px}
 .activity-point-editor p{margin:8px 0}
 .activity-point-editor button{font-size:14px;padding:9px 12px;min-height:44px;margin:0;font-weight:600}
 .activity-point-editor fieldset{padding:8px;margin:8px 0}
 .activity-point-editor legend{width:100%;padding:0}
 .activity-point-editor .point-toggle{width:100%;text-align:left;background:var(--soft);color:#3f3150}
 .activity-point-editor .point-toggle strong{display:block;font-size:14px;line-height:1.35}
 .activity-point-editor .point-toggle small{font-size:12px;font-weight:400;margin-top:3px}
 .activity-point-editor [data-point-body][hidden]{display:none}
 .activity-point-editor [data-point-body] input{font-size:16px;padding:10px;margin:6px 0}
 .activity-point-editor [data-point-feedback]{font-size:13px;overflow-wrap:anywhere}
 .activity-point-editor [data-point-feedback][data-error="true"]{color:#8c1d18;background:#fff0ed;padding:8px;border-radius:8px}
 .activity-point-editor details{margin:10px 0}
 .activity-point-editor summary{min-height:44px;padding:10px 0;cursor:pointer;color:#4f378b}
 .activity-point-editor .point-secondary{display:flex;gap:6px;flex-wrap:wrap}
 .activity-point-editor .point-secondary button{background:var(--soft);color:#4f378b}
 .activity-point-editor .point-footer{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
 .activity-point-editor .point-footer button{flex:1 1 auto}

 .activity-point-editor [data-point-results]{display:grid;gap:8px;min-width:0;margin-top:8px}
 .activity-point-editor button.point-place-option{display:block;width:100%;min-height:48px;margin:0;padding:10px 12px;text-align:left;border:1px solid #d9cbea;border-radius:12px;background:#f6f2fb;color:#332246;font-size:14px;font-weight:400;line-height:1.35;overflow-wrap:anywhere}
 .activity-point-editor .point-place-option strong{display:block;font-size:15px;line-height:1.35}
 .activity-point-editor .point-place-option small{display:block;margin-top:3px;font-size:12px;line-height:1.35;font-weight:400;color:#60566a}
 .activity-point-editor .point-place-option:focus-visible{outline:3px solid #6750a4;outline-offset:2px}
`;
export function mountActivityPointEditor({host,row,search,save,readRow=()=>row,current=()=>true}){
 document.querySelectorAll('[data-activity-point-editor]').forEach(node=>node.dispose?.());
 const root=el('section');root.dataset.activityPointEditor='';root.className='activity-point-editor';root.setAttribute('aria-label','Punts de '+row.title);
 const points=structuredClone(savedActivityPoints(row)||extractActivityPoints(row));
 const heading=el('h4','Confirma les ubicacions'),help=el('p','Selecciona el lloc correcte. Només cal revisar els punts amb dubtes.');
 const list=el('div'),status=el('p');status.setAttribute('role','status');
 const add=el('button','Afegir un altre lloc'),submit=el('button','Confirmar ubicacions'),close=el('button','Cancel·la');
 for(const b of [add,submit,close])b.type='button';
 const conflict=el('div');conflict.setAttribute('role','alert');conflict.hidden=true;
 const footer=el('div');footer.className='point-footer';footer.append(add,submit,close);
 root.append(el('style',candidateStyles),heading,help,conflict,list,status,footer);host.append(root);let busy=false,saving=false,serial=0,latest=row,conflictVersion=null;
 let selectedId=points[0]?.id||null;
 const pointStates=new Map();
 const stateFor=point=>{if(!pointStates.has(point.id))pointStates.set(point.id,{message:'',candidates:[],error:false});return pointStates.get(point.id)};
 root.dispose=()=>{serial++;root.remove()};
 root.syncRow=value=>{
  latest=value;
  const version=JSON.stringify([row.updated_at,latest?.updated_at??null]);
  if(conflictVersion===version)return;conflictVersion=version;conflict.replaceChildren();
  const changed=!latest||latest.updated_at!==row.updated_at;
  conflict.hidden=!changed;submit.disabled=busy||changed;
  if(!changed)return;
  conflict.append(el('p',latest?'L’activitat ha canviat mentre editaves. El teu esborrany es conserva. Revisa la versió actual abans de desar.':'L’activitat ja no està disponible. Conservem l’esborrany, però no es pot desar.'));
  if(!latest)return;
  const details=el('details'),summary=el('summary','Revisa els canvis de l’activitat');details.append(summary);
  details.append(el('p',latest.title),el('p','Versió actual: '+latest.updated_at));
  const remote=el('ol');for(const p of savedActivityPoints(latest)||extractActivityPoints(latest))remote.append(el('li',[p.query,p.place?.canonical_name,p.place?.formatted_address].filter(Boolean).join(' · ')));
  details.append(remote,el('p','Conservar l’esborrany substituirà només els punts de la versió revisada quan premis «Desa els punts». No canviarà els altres camps.'));
  const accept=el('button','Conserva el meu esborrany sobre aquesta versió');accept.type='button';accept.disabled=saving;
  const reviewed=latest;
  accept.onclick=()=>{if(!active()||saving)return;const now=readRow();if(!now||now.updated_at!==reviewed.updated_at){root.syncRow(now);return}row=now;root.syncRow(now);status.textContent='Versió revisada. El teu esborrany encara no s’ha desat.'};
  details.append(accept);conflict.append(details);
 };
 const active=()=>root.isConnected&&current();
 const action=(text,run)=>{const b=el('button',text);b.type='button';b.disabled=busy;b.onclick=run;return b};
 function render(){
  list.replaceChildren();add.disabled=busy||points.length>=MAX_POINTS;submit.disabled=busy||!latest||latest.updated_at!==row.updated_at;close.disabled=saving;
  points.forEach((point,i)=>{
   const state=stateFor(point),box=el('fieldset'),legend=el('legend');
   const toggle=el('button');toggle.type='button';toggle.className='point-toggle';toggle.dataset.pointToggle='';toggle.setAttribute('aria-label','Edita el punt '+(i+1));toggle.setAttribute('aria-expanded',String(selectedId===point.id));toggle.disabled=saving;
   const title=el('strong'),badge=el('small');
   const updateSummary=()=>{title.textContent=(i+1)+'. '+(point.place?.canonical_name||point.query||'Punt nou');badge.textContent=state.loading?'Cercant…':state.error?'Cerca no disponible':state.empty?'Sense coincidències':state.candidates.length?'Tria una coincidència':point.place?(point.status==='approximate'?'Zona aproximada':'Ubicació verificada'):'Pendent de verificar'};
   updateSummary();toggle.append(title,badge);legend.append(toggle);box.append(legend);
   toggle.onclick=()=>{if(!active()||saving)return;selectedId=selectedId===point.id?null:point.id;render()};
   const body=el('div');body.dataset.pointBody='';body.hidden=selectedId!==point.id;box.append(body);
   const input=el('input');input.value=point.query;input.maxLength=500;input.setAttribute('aria-label','Nom del punt '+(i+1));input.disabled=busy;
   const hint=el('small','Si no trobes el lloc correcte, pots modificar el nom.');
   const feedback=el('p');feedback.dataset.pointFeedback='';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');feedback.textContent=state.message;feedback.dataset.error=String(state.error);
   const results=el('div');results.dataset.pointResults='';
   input.oninput=()=>{point.query=input.value;point.place=null;point.status='pending';state.candidates=[];state.empty=false;state.error=false;state.message='Nom modificat. Cerca i confirma el lloc abans de desar-lo com a verificat.';results.replaceChildren();body.querySelector('[data-point-place-info]')?.remove();feedback.textContent=state.message;feedback.dataset.error='false';updateSummary()};
   const find=action('Buscar ubicació',async()=>{
    if(!active()||busy)return;
    const query=point.query.trim();
    if(!query){state.message='Escriu un nom de lloc.';state.error=true;render();return}
    const request=++serial;busy=true;state.loading=true;state.error=false;state.empty=false;state.candidates=[];state.message='Cercant el punt…';render();
    try{
     const options=await search(query);if(!active()||request!==serial)return;
     // Never display other saints/landmarks as matches to this requested name.
     const exactMatches=options.filter(p=>matchingPointCandidate(query,p,{city:row.city||undefined}));
     state.candidates=visiblePointCandidates(exactMatches).map(pointPlace);state.empty=state.candidates.length===0;
     state.message=state.candidates.length?'Quin d’aquests llocs vols visitar?':'No hem trobat el lloc. Prova un altre nom.';
    }catch(e){if(active()&&request===serial){state.error=true;state.message=e.message||'La cerca no està disponible. Torna-ho a provar.'}}
    finally{if(active()&&request===serial){busy=false;state.loading=false;render()}}
   });
   const edit=el('details');edit.append(el('summary','Canviar el nom de la cerca'),input,hint);body.append(edit,find,feedback,results);
   for(const p of state.candidates){
    const button=action('',()=>{if(!active()||busy)return;point.place=p;point.status=p.coordinate_role==='exact_location'?'resolved':'approximate';state.candidates=[];state.message='Ubicació seleccionada. Prem «Confirmar ubicacions» per desar-la.';state.error=false;render()});
    button.className='point-place-option';button.append(el('strong',p.canonical_name),el('small',pointCandidateDescription(p)));results.append(button);
   }
   if(point.place){
    const info=el('details');info.dataset.pointPlaceInfo='';info.append(el('summary','Detalls de la ubicació'));
    if(point.place.formatted_address)info.append(el('p',point.place.formatted_address));
    const map=el('a','Veure al mapa');map.href=pointMapUrl(point.place);map.target='_blank';map.rel='noopener';info.append(map);const technical=el('details');technical.append(el('summary','Informació tècnica'),el('small',point.place.attribution+' · Geoapify'),el('small','Coordenades: '+point.place.latitude.toFixed(5)+', '+point.place.longitude.toFixed(5)));info.append(technical);body.append(info);
   }
   const secondary=el('details');secondary.dataset.pointActions='';secondary.append(el('summary','Opcions avançades'));
   const actions=el('div');actions.className='point-secondary';
   const up=action('Puja el punt '+(i+1),()=>{[points[i-1],points[i]]=[points[i],points[i-1]];render()});up.disabled=busy||i===0;
   const down=action('Baixa el punt '+(i+1),()=>{[points[i+1],points[i]]=[points[i],points[i+1]];render()});down.disabled=busy||i===points.length-1;
   actions.append(up,down,action('Elimina el punt '+(i+1),()=>{points.splice(i,1);pointStates.delete(point.id);selectedId=points[Math.min(i,points.length-1)]?.id||null;render()}));secondary.append(actions);body.append(secondary);list.append(box);
  });
 }
 add.onclick=()=>{if(busy||!active()||points.length>=MAX_POINTS)return;const point={id:crypto.randomUUID(),query:'',status:'pending',place:null};points.push(point);selectedId=point.id;render();list.lastElementChild.querySelector('input').focus()};
 close.onclick=()=>{if(!saving)root.dispose()};
 submit.onclick=async()=>{
  if(busy||!active())return;
  root.syncRow(readRow());if(!latest||latest.updated_at!==row.updated_at)return;
  try{const snapshot=pointSnapshot(row,points);saving=true;busy=true;render();status.textContent='Desant els punts…';await save(snapshot,row);if(active())root.dispose()}
  catch(e){if(active())status.textContent=e.message||'No s’han pogut desar. Revisa el planning abans de repetir.'}
  finally{saving=false;if(active()){busy=false;root.syncRow(readRow());render()}}
 };
 render();heading.tabIndex=-1;heading.focus({preventScroll:true});root.scrollIntoView({block:'nearest'});
 return root;
}

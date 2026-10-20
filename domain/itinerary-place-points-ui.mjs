import {MAX_POINTS,extractActivityPoints,savedActivityPoints,pointSnapshot,pointPlace,pointMapUrl} from './itinerary-place-points.mjs';
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
export function mountActivityPointEditor({host,row,search,save,readRow=()=>row,current=()=>true}){
 document.querySelectorAll('[data-activity-point-editor]').forEach(node=>node.dispose?.());
 const root=el('section');root.dataset.activityPointEditor='';root.className='activity-point-editor';root.setAttribute('aria-label','Punts de '+row.title);
 const points=structuredClone(savedActivityPoints(row)||extractActivityPoints(row));
 const heading=el('h4','Punts de l’activitat'),help=el('p','Ordena fins a 12 llocs de la visita. Les zones són aproximades; no impliquen cap reserva. Els canvis només es desen quan ho confirmes.');
 const list=el('div'),status=el('p');status.setAttribute('role','status');
 const add=el('button','Afegeix un punt'),submit=el('button','Desa els punts'),close=el('button','Cancel·la');
 for(const b of [add,submit,close])b.type='button';
 const conflict=el('div');conflict.setAttribute('role','alert');conflict.hidden=true;
 root.append(heading,help,conflict,list,status,add,submit,close);host.append(root);let busy=false,saving=false,serial=0,latest=row,conflictVersion=null;
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
   const box=el('fieldset'),legend=el('legend',(i+1)+'. '+(point.place?.canonical_name||point.query||'Punt nou'));box.append(legend);
   const input=el('input');input.value=point.query;input.maxLength=500;input.setAttribute('aria-label','Nom del punt '+(i+1));input.disabled=busy;box.append(input);
   const results=el('div');results.className='stack';
   input.oninput=()=>{serial++;point.query=input.value;point.place=null;point.status='pending';results.replaceChildren();status.textContent='Nom modificat: cerca i confirma el lloc abans de desar-lo com a verificat.'};
   const find=action('Cerca aquest punt',async()=>{
    if(!active()||busy)return;const query=point.query.trim();if(!query){status.textContent='Escriu un nom de lloc.';return}
    const request=++serial;busy=true;render();status.textContent='Cercant el punt…';
    try{
     const options=await search(query);if(!active()||request!==serial)return;
     busy=false;render();status.textContent=options.length?'Confirma el lloc correcte. Cap candidat s’ha desat encara.':'Cap coincidència verificable. El punt queda pendent.';
     const target=list.children[i].querySelector('[data-point-results]');
     for(const candidate of options){
      const p=pointPlace(candidate),button=action([p.canonical_name,p.locality,p.country_code,p.coordinate_role==='representative_point'?'Zona aproximada':'Lloc exacte',p.formatted_address].filter(Boolean).join(' · '),()=>{
       if(!active()||busy)return;point.place=p;point.status=p.coordinate_role==='exact_location'?'resolved':'approximate';render();status.textContent='Punt seleccionat. Prem «Desa els punts» per confirmar els canvis.';
      });target.append(button);
     }
    }catch(e){if(active())status.textContent=e.message||'La cerca no està disponible.'}
    finally{if(active()){busy=false;add.disabled=points.length>=MAX_POINTS;submit.disabled=!latest||latest.updated_at!==row.updated_at;close.disabled=false;if(!list.querySelector('[data-point-results] button'))render()}}
   });box.append(find);
   if(point.place){
    box.append(el('p',point.place.coordinate_role==='representative_point'?'Zona aproximada identificada':'Ubicació exacta identificada'));
    if(point.place.formatted_address)box.append(el('p',point.place.formatted_address));
    const map=el('a','Veure al mapa');map.href=pointMapUrl(point.place);map.target='_blank';map.rel='noopener';box.append(map,el('small',point.place.attribution+' · Geoapify'),el('small','Coordenades: '+point.place.latitude.toFixed(5)+', '+point.place.longitude.toFixed(5)));
   }else box.append(el('p','Ubicació pendent de verificar'));
   const up=action('Puja el punt '+(i+1),()=>{[points[i-1],points[i]]=[points[i],points[i-1]];render()});up.disabled=busy||i===0;
   const down=action('Baixa el punt '+(i+1),()=>{[points[i+1],points[i]]=[points[i],points[i+1]];render()});down.disabled=busy||i===points.length-1;
   box.append(up,down,action('Elimina el punt '+(i+1),()=>{points.splice(i,1);render()}));results.dataset.pointResults='';box.append(results);list.append(box);
  });
 }
 add.onclick=()=>{if(busy||!active()||points.length>=MAX_POINTS)return;points.push({id:crypto.randomUUID(),query:'',status:'pending',place:null});render();list.lastElementChild.querySelector('input').focus()};
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

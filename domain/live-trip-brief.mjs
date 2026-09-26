import {interestCatalog, hotelAmenityCatalog, createFreeInterest, normalizeInterestLabel, resolveBriefDecision, prepareBriefPatch} from './trip-brief.mjs';

export const strengths={hard:'🔒 Imprescindible',preference:'❤️ Preferència',flexible:'↔ Flexible'};
export const blocks={destination:'📍 Destinació',dates:'📅 Dates',origin:'✈️ Origen',travelers:'👥 Viatgers',budget:'💰 Pressupost',pace:'⚖️ Ritme',interests:'✨ Interessos',multidestination:'🧭 Multidestinació',experience:'🚶 Experiències',flights:'✈️ Vols',baggage:'🧳 Equipatge',hotel:'🏨 Hotel',amenities:'🏊 Extres de l’hotel',notes:'💬 La teva idea'};
export const styles={independent:'Pel nostre compte',audio_guide:'Audioguia',guided_visit:'Visita guiada',organized_excursion:'Excursió organitzada',independent_excursion:'Excursió pel nostre compte',combination:'Barreja / depèn'};
export const dayparts=[['Matí · 06–12 h',{min:'06:00',max:'11:59'}],['Migdia · 12–15 h',{min:'12:00',max:'14:59'}],['Tarda · 15–20 h',{min:'15:00',max:'19:59'}],['Vespre · 20–24 h',{min:'20:00',max:'23:59'}]];
export const choices={
 pace:[['Tranquil','relaxed'],['Equilibrat','balanced'],['Aprofitar els dies','active']],
 'destination.multidestination':[['Sí',true],['No',false]],
 'flight.departure_window':dayparts,'flight.arrival_window':dayparts,
 'flight.max_stops':[['Directe',0],['Màxim 1 escala',1]],
 'hotel.comfort':[['Econòmic','economic'],['Confortable','comfortable'],['Especial','special']],
 'hotel.location':[['Cèntric','central'],['Ben comunicat','well_connected']],
 'hotel.room':[['Doble',{type:'double'}],['Twin',{type:'twin'}],['Familiar',{type:'family'}]],
 'hotel.breakfast':[['Sí',true],['No cal',false]],
 'hotel.cancellation':[['Gratuïta','free'],['Reemborsable','refundable']],
};
export const titles={'flight.departure_window':'Horari d’anada','flight.arrival_window':'Horari de tornada','flight.max_stops':'Escales','hotel.comfort':'Confort','hotel.location':'Ubicació','hotel.room':'Habitació','hotel.breakfast':'Esmorzar','hotel.cancellation':'Cancel·lació'};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const globalDecision=(row,field)=>resolveBriefDecision(row.document,field);
export function blockFor(field){
 if(field.startsWith('interest.')||field==='interests')return 'interests';
 if(field.startsWith('hotel.amenit'))return 'amenities';
 if(field.startsWith('hotel.'))return 'hotel';
 if(field.startsWith('flight.'))return 'flights';
 if(field.startsWith('dates'))return 'dates';
 if(field==='destination.multidestination')return 'multidestination';
 if(field==='experience.styles')return 'experience';return field;
}
const dateLabel=value=>new Intl.DateTimeFormat('ca-ES',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
export function decisionLabel(d){
 const f=d.field,v=d.value,name=interestCatalog[f.slice(9)]||hotelAmenityCatalog[f.slice(14)]||d.label||titles[f]||blocks[blockFor(f)]||'Preferència addicional';
 if(d.knowledge==='indifferent')return `${name}: m’és igual`;
 if(d.knowledge!=='known')return '';
 if(f.startsWith('interest.')||f.startsWith('hotel.amenity.'))return name;
 if(f==='destination')return v.mode==='open'?'Destinació oberta':v.places.join(' + ');
 if(f==='origin')return 'Origen: '+v.places.join(' + ');
 if(f==='dates')return (v.mode==='window'?'Entre ':'')+dateLabel(v.start||v.earliest)+' – '+dateLabel(v.end||v.latest);
 if(f==='dates.flexibility_days')return `Flexibilitat: ±${v} dies`;
 if(f==='budget'){if(v.mode==='price_discovery')return 'Vull saber quant costa';const money=n=>new Intl.NumberFormat('ca-ES',{style:'currency',currency:v.currency}).format(n);return `${v.mode==='maximum'?'Màxim':'Objectiu'} ${money(v.amount)}`+(v.mode==='target_stretch'?` · marge ${money(v.stretch)}`:'')}
 if(f==='destination.multidestination')return 'Multidestinació: '+(v?'sí':'no');
 if(f==='experience.styles')return v.map(x=>styles[x]).join(' · ');
 if(f==='interests'||f==='hotel.amenities')return v.join(' · ');
 if(f==='notes')return v;
 if(f==='baggage'){const names={personal:'personal',cabin:'cabina',checked:'facturada',other:'especial'};const parts=[];if(v.per_traveler)parts.push(`${Object.keys(v.per_traveler).length} viatgers amb equipatge`);if(v.shared)parts.push('Compartit: '+v.shared.map(b=>`${b.quantity} ${names[b.kind]}`).join(', '));return parts.join(' · ')}
 const option=choices[f]?.find(([,value])=>same(value,v));if(option)return `${titles[f]||''}${titles[f]?': ':''}${option[0]}`;
 if(f.startsWith('flight.')&&v&&typeof v==='object')return `${name}: ${v.min||'…'} – ${v.max||'…'}${v.time_zone?' · '+v.time_zone:''}`;
 if(f==='hotel.room')return `${name}: ${v.type}${v.rooms?' · '+v.rooms+' habitacions':''}`;
 return name+': '+(typeof v==='object'?'preferència desada':String(v));
}
export function liveProjection(row){
 const items=[];
 const travelers=Object.values(row.document.travelers),adults=travelers.filter(t=>t.kind==='adult').length,children=travelers.filter(t=>t.kind==='child');
 if(travelers.length)items.push({id:'travelers',block:'travelers',label:`${adults} adults`+(children.length?` · ${children.length} infants (${children.map(t=>t.age===undefined?'edat pendent':t.age+' anys').join(', ')})`:''),strength:null});
 for(const [id,d] of Object.entries(row.document.decisions)){
  if(d.origin!=='explicit_user'||d.knowledge==='unknown')continue;
  const label=decisionLabel(d);if(label)items.push({id,field:d.field,block:blockFor(d.field),label:(d.scope==='global'?'':`${row.document.scopes[d.scope]?.label||'Preferència específica'} · `)+label,strength:d.strength,scoped:d.scope!=='global'});
 }
 return items;
}
export function nextBlock(row,mode){
 const order=mode==='destination'?['destination','dates','travelers','interests']:mode==='idea'?['notes','interests','dates','travelers']:['interests','dates','travelers','origin'];
 const present=new Set(Object.values(row.document.decisions).map(d=>blockFor(d.field)));if(Object.keys(row.document.travelers).length)present.add('travelers');
 return order.find(key=>!present.has(key))||null;
}
// Partial patches only. Stable decision IDs and every unrelated scope/value survive.
export function fieldCommand(row,field,{knowledge='known',value,strength,label,remove=false}={}){
 const previous=globalDecision(row,field),old=previous?.decision;
 const id=previous?.id||'d_'+crypto.randomUUID().replaceAll('-','');
 const set={},removed={};
 if(remove){if(!old)throw Error('Aquesta preferència ja no existeix.');removed.decisions=[id]}
 else{
  const decision={field,scope:'global',origin:'explicit_user',knowledge};
  if(field.startsWith('interest.free.'))decision.label=label??old?.label;
  if(knowledge!=='unknown')decision.strength=strength||old?.strength||'preference';
  if(knowledge==='known')decision.value=value;
  if(same(decision,old))return null;
  set.decisions={[id]:decision};
 }
 const candidate=structuredClone(row.document);Object.assign(candidate.decisions,set.decisions);for(const key of removed.decisions||[])delete candidate.decisions[key];
 validateFamilies(candidate);
 return prepareBriefPatch({briefId:row.id,expectedRevision:row.revision,set,remove:removed,confirmHard:old?.strength==='hard'?[id]:[]});
}
export function validateFamilies(doc){
 const decisions=Object.values(doc.decisions),global=decisions.filter(d=>d.scope==='global');
 for(const [legacy,prefix] of [['interests','interest.'],['hotel.amenities','hotel.amenity.']]){
  if(global.some(d=>d.field===legacy)&&decisions.some(d=>d.field.startsWith(prefix))||global.some(d=>d.field.startsWith(prefix))&&decisions.some(d=>d.field===legacy))throw Error('Aquesta família ja utilitza una altra representació. Edita el grup existent.');
 }
 const interests=global.filter(d=>d.field.startsWith('interest.'));
 if(interests.length>30)throw Error('Màxim 30 interessos per viatge.');
 for(const d of interests){
  if(!d.field.startsWith('interest.free.'))continue;
  const key=normalizeInterestLabel(d.label);
  if(!key||[...d.label].length>80)throw Error('L’interès ha de tenir entre 1 i 80 caràcters.');
  for(const other of decisions.filter(x=>x!==d)){
   if(other.field.startsWith('interest.free.')&&normalizeInterestLabel(other.label)===key&&other.field!==d.field)throw Error('Aquest interès ja existeix. Edita el que tens seleccionat.');
   const native=other.field.slice(9);if(interestCatalog[native]&&[normalizeInterestLabel(interestCatalog[native]),native.replaceAll('_',' ')].includes(key))throw Error('Aquest interès ja existeix al catàleg seleccionat.');
  }
 }
}
export function freeInterestCommand(row,label){const d=createFreeInterest(label);return fieldCommand(row,d.field,d)}
export function travelersCommand(row,adults,ages){
 if(!Number.isInteger(adults)||adults<0||adults+ages.length<1||adults+ages.length>30||ages.some(age=>age!==undefined&&(!Number.isInteger(age)||age<0||age>17)))throw Error('Indica entre 1 i 30 viatgers i edats d’infants entre 0 i 17.');
 const old=row.document.travelers,set={},remove=[];
 for(const kind of ['adult','child']){
  const entries=Object.entries(old).filter(([,v])=>v.kind===kind),count=kind==='adult'?adults:ages.length;
  for(let i=0;i<Math.max(entries.length,count);i++){
   if(i>=count){remove.push(entries[i][0]);continue}
   const id=entries[i]?.[0]||'t_'+crypto.randomUUID().replaceAll('-','');
   const value={kind,...(kind==='child'&&ages[i]!==undefined?{age:ages[i]}:{})};if(!same(value,old[id]))set[id]=value;
  }
 }
 for(const d of Object.values(row.document.decisions))if(d.field==='baggage'&&d.knowledge==='known'&&remove.some(id=>d.value.per_traveler?.[id]))throw Error('Retira primer l’equipatge dels viatgers que vols eliminar.');
 return prepareBriefPatch({briefId:row.id,expectedRevision:row.revision,set:{travelers:set},remove:{travelers:remove}});
}
export function baggageValue(row,personal,cabin,checked,shared){
 const ids=Object.keys(row.document.travelers);if(!ids.length)throw Error('Indica primer els viatgers.');
 for(const n of [personal,cabin,checked,shared])if(!Number.isInteger(n)||n<0||n>20)throw Error('Indica quantitats entre 0 i 20.');
 if(shared&&(ids.length<2||checked))throw Error('Per compartir, calen almenys dos viatgers i escollir facturada compartida o individual.');
 const bags=[['personal',personal],['cabin',cabin],['checked',checked]].filter(([,n])=>n).map(([kind,quantity])=>({kind,quantity}));
 if(!bags.length&&!shared)throw Error('Selecciona equipatge o indica que t’és igual.');
 return {...(bags.length?{per_traveler:Object.fromEntries(ids.map(id=>[id,structuredClone(bags)]))}:{}),...(shared?{shared:[{kind:'checked',quantity:shared}]}:{})};
}

export function personalBaggageValue(row,values){
 const previous=globalDecision(row,'baggage')?.decision;
 const old=previous?.knowledge==='known'?previous.value:{};
 const quantity=value=>{const n=Number(value);if(value===''||!Number.isInteger(n)||n<0||n>20)throw Error('Indica quantitats entre 0 i 20.');return n;};
 const per_traveler={};
 for(const id of Object.keys(row.document.travelers)){
  const before=old.per_traveler?.[id]||[],bags=before.filter(b=>!['personal','cabin','checked'].includes(b.kind));
  for(const kind of ['personal','cabin','checked']){
   const matches=before.filter(b=>b.kind===kind),n=quantity(values[id+'_'+kind]);
   if(matches.length>1)throw Error('Hi ha diverses peces detallades del mateix tipus. Es conserven sense simplificar-les.');
   if(n)bags.push({...matches[0],kind,quantity:n});
  }
  if(bags.length)per_traveler[id]=bags;
 }
 const shared=(old.shared||[]).filter(b=>b.kind!=='checked'),checked=(old.shared||[]).filter(b=>b.kind==='checked'),n=quantity(values.shared);
 if(checked.length>1)throw Error('Hi ha diverses maletes compartides detallades. Es conserven sense simplificar-les.');
 if(n){if(Object.keys(row.document.travelers).length<2||Object.values(per_traveler).some(bags=>bags.some(b=>b.kind==='checked')))throw Error('Per compartir, calen almenys dos viatgers i resoldre les facturades individuals.');shared.push({...checked[0],kind:'checked',quantity:n});}
 if(!Object.keys(per_traveler).length&&!shared.length)throw Error('Selecciona equipatge o indica que t’és igual.');
 return {...(Object.keys(per_traveler).length?{per_traveler}:{}),...(shared.length?{shared}:{})};
}

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const input=(name,label,value='',type='text',attrs='')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
const options=(values,current)=>values.map(([value,label])=>`<option value="${esc(value)}" ${String(current)===String(value)?'selected':''}>${esc(label)}</option>`).join('');
const select=(name,label,values,current)=>`<label>${label}<select name="${name}">${options(values,current)}</select></label>`;
export class LiveBriefEditor{
 constructor(root,{save,openNotes,canSwitch=()=>true,isBlocked=()=>false}){this.root=root;this.save=save;this.openNotes=openNotes;this.canSwitch=canSwitch;this.isBlocked=isBlocked;this.active=null;this.dirty=false;this.locked=false;this.activeInterest=null}
 update(row,mode){const changed=this.row?.id!==row.id;this.row=row;this.lastAttempt=null;if(changed)this.active=nextBlock(row,mode);this.dirty=false;this.render();}
 clear(){this.row=null;this.active=null;this.dirty=false;this.root.innerHTML='';this.openNotes(false)}
 setLocked(locked){this.locked=locked;this.root.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=locked)}
 open(block,field=null){if(!this.canSwitch()||this.dirty&&!confirm('Descartar els canvis d’aquest bloc?'))return;this.active=block;this.activeInterest=field;this.dirty=false;this.render();this.root.querySelector('[data-editor-heading]')?.focus()}
 render(){
  if(!this.row)return;const row=this.row,items=liveProjection(row),visible=items.slice(0,6),extra=items.slice(6);
  const item=x=>`<button type="button" data-edit="${esc(x.block)}" data-decision="${esc(x.field)}" title="${esc(x.label)}"${x.scoped?' data-scoped="true"':''}><span>${x.strength?strengths[x.strength].split(' ')[0]+' ':''}${esc(x.label)}</span><small>Editar</small></button>`;
  this.root.innerHTML=`<section class="live-card" aria-label="El viatge que estàs dissenyant"><h2>El viatge que estàs dissenyant</h2>${visible.map(item).join('')}${extra.length?`<details><summary>Veure ${extra.length} preferències més</summary>${extra.map(item).join('')}</details>`:''}${!items.length?'<p>Encara no has afegit preferències.</p>':''}</section>
  <label class="live-picker">${items.length?'Completa o edita el viatge':'Comencem per…'}<select data-block aria-label="Bloc del viatge"><option value="">Tria un aspecte</option>${options(Object.entries(blocks),this.active)}</select></label>
  <section class="live-editor">${this.active?`<h2 tabindex="-1" data-editor-heading>${blocks[this.active]}</h2>${this.active==='notes'?'':this.editorHtml()}`:'<p>Les dades desades són a la targeta. Tria un aspecte per continuar.</p>'}</section><p data-live-error role="alert"></p>`;
  this.openNotes(this.active==='notes');
  this.root.querySelector('[data-block]').onchange=e=>this.open(e.target.value||null);
  this.root.querySelectorAll('[data-edit]').forEach(el=>el.onclick=()=>{if(el.dataset.scoped){this.error('Aquesta preferència és específica d’una part del viatge. Es conserva; l’edició per destinació arribarà més endavant.');return}this.open(el.dataset.edit,el.dataset.decision)});
  this.root.querySelectorAll('[data-choice]').forEach(el=>el.onclick=()=>this.choose(el));
  this.root.querySelectorAll('[data-force]').forEach(el=>el.onchange=()=>{const d=globalDecision(row,el.dataset.force)?.decision;this.submit(()=>fieldCommand(row,d.field,{...d,strength:el.value}))});
  this.root.querySelectorAll('[data-remove]').forEach(el=>el.onclick=()=>this.submit(()=>fieldCommand(row,el.dataset.remove,{remove:true})));
  this.root.querySelectorAll('form').forEach(form=>{form.oninput=()=>{this.dirty=true};form.onsubmit=e=>{e.preventDefault();if(form.reportValidity())this.formSubmit(form)}});
  this.root.querySelectorAll('[data-state]').forEach(el=>el.onclick=()=>this.submit(()=>fieldCommand(row,el.dataset.field,{knowledge:el.dataset.state})));
  const budget=this.root.querySelector('form[data-form=budget]');if(budget){const sync=()=>{for(const name of ['amount','currency','stretch'])budget.elements[name].closest('label').hidden=budget.elements.mode.value==='price_discovery'||name==='stretch'&&budget.elements.mode.value!=='target_stretch';};budget.elements.mode.addEventListener('change',sync);sync();}
  this.root.querySelector('[data-date-mode]')?.addEventListener('change',e=>{const window=e.target.value==='window';const form=e.target.form;form.elements.start.previousSibling.textContent=window?'A partir de':'Inici';form.elements.end.previousSibling.textContent=window?'Fins a':'Final'});
  this.setLocked(this.locked);
 }
 review(){
  const command=this.lastAttempt;if(!command){this.error('Revisa el text que havies escrit abans de recarregar.');return;}
  const labels=Object.values(command.p_set.decisions||{}).map(d=>d.knowledge==='unknown'?`${blocks[blockFor(d.field)]||'Preferència'}: encara no ho sé`:decisionLabel(d));
  for(const id of command.p_remove.decisions||[])labels.push('Eliminar: '+decisionLabel(this.row.document.decisions[id]));
  if(command.p_set.travelers||command.p_remove.travelers)labels.push('Canvi en els viatgers del bloc obert');
  const panel=this.root.querySelector('[data-live-error]');panel.innerHTML='<strong>Canvis que has intentat desar (no aplicats)</strong><ul>'+labels.map(label=>'<li>'+esc(label)+'</li>').join('')+'</ul><p>Recarrega el viatge i torna a aplicar només els canvis que vulguis.</p>';panel.tabIndex=-1;panel.focus();
 }
 error(message){this.root.querySelector('[data-live-error]').textContent=message}
 async submit(prepare,{fromForm=false}={}){
  if(this.locked)return;
  const ownerRow=this.row;
  try{if(this.dirty&&!fromForm)throw Error('Desa o descarta primer els canvis del bloc obert.');const command=prepare();if(!command)return;if(command.p_confirm_hard.length&&!confirm('Modificaràs una preferència imprescindible. Confirmes aquest canvi?')){if(!fromForm&&this.root.querySelector)this.render();return;}
   this.lastAttempt=structuredClone(command);this.setLocked(true);await this.save(command);
  }catch(error){if(this.row===ownerRow)this.error(error.message)}finally{if(this.row)this.setLocked(this.isBlocked())}
 }
 stateButtons(field){const d=globalDecision(this.row,field)?.decision;return `<div class="live-chips">${[['unknown','Encara no ho sé'],['indifferent','M’és igual']].map(([state,label])=>`<button type="button" data-state="${state}" data-field="${field}" aria-pressed="${d?.knowledge===state}">${label}</button>`).join('')}</div>`}
 force(field){const d=globalDecision(this.row,field)?.decision;return d&&d.knowledge!=='unknown'?`<label>Importància de ${esc(interestCatalog[field.slice(9)]||hotelAmenityCatalog[field.slice(14)]||d.label||titles[field]||blocks[blockFor(field)])}<select data-force="${esc(field)}">${options(Object.entries(strengths),d.strength)}</select></label>`:''}
 simple(field){const d=globalDecision(this.row,field)?.decision;return `<fieldset><legend>${esc(titles[field]||blocks[blockFor(field)])}</legend><div class="live-chips">${choices[field].map(([label,value],i)=>`<button type="button" data-choice="${i}" data-field="${field}" aria-pressed="${d?.knowledge==='known'&&same(d.value,value)}">${label}</button>`).join('')}</div>${this.stateButtons(field)}${this.force(field)}</fieldset>`}
 family(prefix,catalog,legacy){
  const old=globalDecision(this.row,legacy)?.decision;
  if(old)return `<p>Aquests interessos o extres es van desar com un grup. Pots editar-lo mantenint-ne la importància.</p>${this.textForm(legacy,'Un element per línia',old.value?.join('\n')||'',true)}${this.force(legacy)}`;
  if(Object.values(this.row.document.decisions).some(d=>d.field===legacy))return '<p>Hi ha preferències anteriors en una part del viatge. Es conserven; no afegirem una segona representació.</p>';
  return `<div class="live-chips">${Object.entries(catalog).map(([key,label])=>{const f=prefix+key,d=globalDecision(this.row,f)?.decision;return `<button type="button" data-choice="family" data-field="${f}" aria-pressed="${d?.knowledge==='known'}">${label}</button>`}).join('')}</div>`+Object.values(this.row.document.decisions).filter(d=>d.scope==='global'&&d.field.startsWith(prefix)).map(d=>`<details class="live-interest" ${this.activeInterest===d.field?'open':''}><summary>${d.strength?strengths[d.strength].split(' ')[0]:''} ${esc(catalog[d.field.slice(prefix.length)]||d.label)} · Editar</summary>${this.force(d.field)}<button type="button" data-remove="${esc(d.field)}">Eliminar ${esc(catalog[d.field.slice(prefix.length)]||d.label)}</button></details>`).join('')+(prefix==='interest.'?this.textForm('free','Altres interessos (màxim 80 caràcters)','','',80):'');
 }
 textForm(field,label,value,multiline=false,max=120){return `<form data-form="${field}">${multiline?`<label>${label}<textarea name="text" rows="3" maxlength="${field==='notes'?2000:3000}">${esc(value)}</textarea></label>`:input('text',label,value,'text',`maxlength="${max}" required`)}<button type="submit">${field==='free'?'Afegeix l’interès':'Desa aquest canvi'}</button></form>`}
 editorHtml(){
  const row=this.row,block=this.active,field=block==='multidestination'?'destination.multidestination':block==='experience'?'experience.styles':block,d=globalDecision(row,field)?.decision,v=d?.knowledge==='known'?d.value:{};
  if(block==='interests')return this.family('interest.',interestCatalog,'interests');
  if(block==='amenities')return this.family('hotel.amenity.',hotelAmenityCatalog,'hotel.amenities');
  if(block==='pace'||block==='multidestination')return this.simple(field);
  if(block==='flights')return ['flight.departure_window','flight.arrival_window','flight.max_stops'].map((f,i)=>`<details ${i===0?'open':''}><summary>${titles[f]}</summary>${this.simple(f)}</details>`).join('')+'<p>Les franges s’expressen en hora local del lloc de sortida o arribada. Encara no busquem vols.</p>';
  if(block==='hotel')return Object.keys(choices).filter(f=>f.startsWith('hotel.')).map((f,i)=>`<details ${i===0?'open':''}><summary>${titles[f]}</summary>${this.simple(f)}</details>`).join('')+'<p>Altres preferències d’allotjament? Afegeix-les a La teva idea.</p>';
  if(block==='destination'||block==='origin')return this.textForm(field,block==='origin'?'Ciutat o aeroport, un per línia':'Destinacions, una per línia',v.places?.join('\n')||'',true)+this.stateButtons(field)+this.force(field);
  if(block==='dates')return `<form data-form="dates">${select('mode','Tipus de dates',[['exact','Dates exactes'],['window','Finestra flexible']],v.mode||'exact').replace('<select','<select data-date-mode')}${input('start',v.mode==='window'?'A partir de':'Inici',v.start||v.earliest,'date','required min="2000-01-01" max="2099-12-31"')}${input('end',v.mode==='window'?'Fins a':'Final',v.end||v.latest,'date','required min="2000-01-01" max="2099-12-31"')}<button>Desa les dates</button></form>${this.stateButtons(field)}${this.force(field)}`;
  if(block==='budget')return `<form data-form="budget">${select('mode','Pressupost',[['price_discovery','Vull saber quant costa'],['target','Tinc un objectiu'],['maximum','Tinc un màxim'],['target_stretch','Objectiu + marge']],v.mode||'price_discovery')}${input('amount','Import objectiu o màxim',v.amount,'number','min="0" max="100000000" step="0.01"')}${input('stretch','Marge addicional (només Objectiu + marge)',v.stretch,'number','min="0" max="100000000" step="0.01"')}${input('currency','Moneda (EUR, USD…)',v.currency||'EUR','text','pattern="[A-Z]{3}" maxlength="3"')}<button>Desa el pressupost</button></form>${this.stateButtons(field)}${this.force(field)}`;
  if(block==='travelers'){
   const travelers=Object.values(row.document.travelers),children=travelers.filter(t=>t.kind==='child');
   return `<form data-form="travelers">${input('adults','Adults',travelers.length?travelers.filter(t=>t.kind==='adult').length:'','number','required min="0" max="30"')}${input('children','Infants',children.length,'number','required min="0" max="30"')}${input('ages','Edats separades per comes; ? si encara no la saps',children.map(t=>t.age??'?').join(', '),'text','placeholder="4, 8, ?"')}<p>Sense noms ni dades personals.</p><button>Desa els viatgers</button></form>`;
  }
  if(block==='experience')return `<div class="live-chips">${Object.entries(styles).map(([value,label])=>`<button type="button" data-choice="style" data-field="experience.styles" data-value="${value}" aria-pressed="${Array.isArray(v)&&v.includes(value)}">${label}</button>`).join('')}</div>${this.stateButtons(field)}${this.force(field)}<p>La importància s’aplica al conjunt d’estils.</p>`;
  if(block==='baggage'){
   const arrays=Object.values(v.per_traveler||{}),uniform=(!arrays.length||Object.keys(v.per_traveler).length===Object.keys(row.document.travelers).length)&&arrays.every(a=>same(a,arrays[0]))&&(!v.shared||v.shared.length<=1&&v.shared.every(b=>b.kind==='checked'&&!b.weight_kg&&!b.note))&&arrays.every(a=>new Set(a.map(b=>b.kind)).size===a.length&&a.every(b=>['personal','cabin','checked'].includes(b.kind)&&!b.weight_kg&&!b.note));
   const personalForm=`<details ${!uniform?'open':''}><summary>Personalitza per viatger</summary><form data-form="baggage_personal">${Object.entries(row.document.travelers).map(([id,t],i)=>`<details><summary>${t.kind==='adult'?'Adult':'Infant'} ${i+1}${t.kind==='child'&&t.age!==undefined?' · '+t.age+' anys':''}</summary>${['personal','cabin','checked'].map((kind,j)=>input(id+'_'+kind,['Personal','Cabina','Facturada'][j],v.per_traveler?.[id]?.find(b=>b.kind===kind)?.quantity||0,'number','min="0" max="20" required')).join('')}</details>`).join('')}${input('shared','Facturades compartides',v.shared?.filter(b=>b.kind==='checked').reduce((n,b)=>n+b.quantity,0)||0,'number','min="0" max="20" required')}<button>Desa l’equipatge per viatger</button></form></details>`;
   if(!uniform)return personalForm+this.stateButtons(field)+this.force(field);
   const amount=kind=>arrays[0]?.find(b=>b.kind===kind)?.quantity||0;
   return `<form data-form="baggage"><p>Quantitats per persona, per a tots els viatgers indicats.</p>${['personal','cabin','checked'].map((kind,i)=>input(kind,['Personal per persona','Cabina per persona','Facturada per persona'][i],amount(kind),'number','min="0" max="20" required')).join('')}${input('shared','Facturades compartides',v.shared?.reduce((n,b)=>n+b.quantity,0)||0,'number','min="0" max="20" required')}<button>Desa l’equipatge</button></form>${this.stateButtons(field)}${this.force(field)}${personalForm}`;
  }
  return '';
 }
 choose(el){const field=el.dataset.field,d=globalDecision(this.row,field)?.decision;
  if(el.dataset.choice==='family'&&d?.knowledge==='known'){this.open(this.active,field);return;}
  this.submit(()=>{
   if(el.dataset.choice==='family')return fieldCommand(this.row,field,d?.knowledge==='known'?{remove:true}:{value:true});
   if(el.dataset.choice==='style'){const values=d?.knowledge==='known'?[...d.value]:[];const i=values.indexOf(el.dataset.value);if(i<0)values.push(el.dataset.value);else values.splice(i,1);return fieldCommand(this.row,field,values.length?{value:values}:{remove:true})}
   const selected=choices[field][Number(el.dataset.choice)][1];
   const value=typeof selected==='object'&&d?.knowledge==='known'?{...d.value,...selected}:selected;
   return fieldCommand(this.row,field,{value});
  });
 }
 formSubmit(form){this.submit(()=>formCommand(this.row,form.dataset.form,Object.fromEntries(new FormData(form))),{fromForm:true})}
}
const validDate=v=>/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export function formCommand(row,field,values){
  const previous=globalDecision(row,field)?.decision,prior=previous?.knowledge==='known'?previous.value:{};
  if(field==='free')return freeInterestCommand(row,values.text);
  if(field==='travelers'){const count=Number(values.children),tokens=values.ages.trim()?values.ages.split(',').map(s=>s.trim()):Array(count).fill('?');if(tokens.length!==count)throw Error('Indica una edat o ? per cada infant.');return travelersCommand(row,Number(values.adults),tokens.map(x=>x==='?'?undefined:x===''?NaN:Number(x)))}
  let value;
  if(field==='dates'){if(!validDate(values.start)||!validDate(values.end)||values.start>values.end)throw Error('Revisa l’ordre de les dates.');value=values.mode==='exact'?{mode:'exact',start:values.start,end:values.end}:{mode:'window',earliest:values.start,latest:values.end}}
  else if(field==='budget'){value={...(prior.includes?{includes:prior.includes}:{}),mode:values.mode};if(values.mode!=='price_discovery'){if(values.amount===''||values.mode==='target_stretch'&&values.stretch==='')throw Error('Indica els imports.');if(!/^[A-Z]{3}$/.test(values.currency)||!Number.isFinite(Number(values.amount))||Number(values.amount)<0||Number(values.amount)>100000000)throw Error('Revisa l’import i la moneda.');Object.assign(value,{amount:Number(values.amount),currency:values.currency});if(values.mode==='target_stretch'){value.stretch=Number(values.stretch);if(!Number.isFinite(value.stretch)||value.stretch<0||value.stretch>100000000)throw Error('Revisa el marge addicional.');}}}
  else if(field==='baggage_personal')return fieldCommand(row,'baggage',{value:personalBaggageValue(row,values)});
  else if(field==='baggage')value=baggageValue(row,...['personal','cabin','checked','shared'].map(k=>Number(values[k])));
  else {const list=values.text.split('\n').map(s=>s.trim()).filter(Boolean);if(!list.length||list.length>30||new Set(list).size!==list.length||list.some(s=>[...s].length>(field==='interests'||field==='hotel.amenities'?80:120)))throw Error('Revisa els elements: sense duplicats, màxim 30.');value=field==='destination'?{mode:prior.mode==='partial'?'partial':'known',places:list}:field==='origin'?{places:list}:list}
  return fieldCommand(row,field,{value});
}

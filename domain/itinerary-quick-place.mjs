// Direct, non-destructive place lookup for an existing itinerary card.
// The parent owns authorization, optimistic writes and agenda refresh.
const clean=value=>String(value??'').trim();
function usable(place){
 return place&&clean(place.canonical_name)&&clean(place.canonical_name).length<=200&&
  place.coordinate_role==='exact_location'&&Number.isFinite(place.latitude)&&Number.isFinite(place.longitude);
}
export function mountQuickItineraryPlace({host,row,query,search,save,current,initialOptions=null}){
 if(!host||!row||typeof search!=='function'||typeof save!=='function')throw Error('Missing place picker contract');
 document.querySelectorAll('[data-quick-itinerary-place]').forEach(existing=>existing.remove());
 const section=document.createElement('section');section.dataset.quickItineraryPlace=row.id;
 section.className='itinerary-quick-place';
 section.style.cssText='margin:10px 0 0;padding:14px;border:1px solid var(--line);border-radius:14px;max-width:100%;min-width:0;overflow-wrap:anywhere;';
 section.setAttribute('aria-label','Cerca la ubicació de '+row.title);
 const heading=document.createElement('div');heading.className='topbar';
 const title=document.createElement('strong');title.textContent='📍 Ubicació: '+row.title;
 const close=document.createElement('button');close.type='button';close.className='ghost';close.textContent='Tanca';
 heading.append(title,close);
 const label=document.createElement('label');label.textContent='Nom del lloc';
 label.style.cssText='display:block;margin:8px 0;';
 const input=document.createElement('input');input.type='search';input.maxLength=500;input.autocomplete='off';
 input.value=clean(query);input.placeholder='Lloc i ciutat';input.setAttribute('aria-label','Cerca el lloc');
 input.style.cssText='display:block;width:100%;max-width:100%;';
 label.append(input);
 const searchButton=document.createElement('button');searchButton.type='button';searchButton.className='secondary';
 searchButton.textContent='🔎 Cerca llocs';
 const status=document.createElement('p');status.setAttribute('role','status');
 status.style.cssText='margin:10px 0;';
 const choices=document.createElement('div');choices.className='stack';choices.dataset.quickPlaceResults='';
 section.append(heading,label,searchButton,status,choices);host.append(section);
 let serial=0,busy=false;
 const active=()=>section.isConnected&&(!current||current());
 const closePanel=()=>{serial++;section.remove()};
 close.onclick=closePanel;
 function display(options){
  if(!active())return;
  const exact=(Array.isArray(options)?options:[]).filter(usable).slice(0,5);
  choices.replaceChildren();
  if(!exact.length){
   status.textContent='No he trobat un lloc prou concret. Prova un altre nom o edita la ubicació manualment.';
   return;
  }
  status.textContent=exact.length===1?'He trobat una ubicació concreta. Confirma-la per vincular-la a aquesta activitat.':'Hi ha diverses ubicacions possibles. Tria la correcta.';
  exact.forEach(place=>{
   const button=document.createElement('button');button.type='button';button.className='secondary';
   button.textContent=(exact.length===1?'✓ Confirma: ':'📍 ')+
    [place.canonical_name,place.administrative_area,place.country_code].filter(Boolean).join(' · ');
   button.style.cssText='text-align:left;white-space:normal;overflow-wrap:anywhere;';
   button.onclick=async()=>{
    if(!active()||busy)return;
    busy=true;searchButton.disabled=true;input.disabled=true;
    choices.querySelectorAll('button').forEach(item=>item.disabled=true);
    status.textContent='Desant la ubicació…';
    try{
     const ok=await save(place);
     if(ok){closePanel();return}
     if(active())status.textContent='El viatge ha canviat. Actualitza el planning abans de tornar-ho a provar.';
    }catch(error){
     if(active())status.textContent=error?.message||'No s’ha pogut desar la ubicació. Torna-ho a provar.';
    }finally{
     if(active()){
      busy=false;searchButton.disabled=false;input.disabled=false;
      choices.querySelectorAll('button').forEach(item=>item.disabled=false);
     }
    }
   };
   choices.append(button);
  });
 }
 async function run(){
  if(!active()||busy)return;
  const value=clean(input.value);if(!value){status.textContent='Escriu un lloc i una ciutat.';return}
  const request=++serial;busy=true;searchButton.disabled=true;choices.replaceChildren();status.textContent='Buscant ubicacions…';
  try{
   const response=await search(value);
   if(!active()||request!==serial)return;
   if(response?.error){status.textContent=response.error;return}
   display(response?.options);
  }catch(error){if(active()&&request===serial)status.textContent=error?.message||'La cerca no està disponible.'}
  finally{if(active()&&request===serial){busy=false;searchButton.disabled=false}}
 }
 searchButton.onclick=()=>{void run()};
 input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void run()}};
 input.focus({preventScroll:true});
 section.scrollIntoView({block:'nearest',behavior:'smooth'});
 if(Array.isArray(initialOptions)&&initialOptions.length)display(initialOptions);
 else void run();
 return {close:closePanel,section};
}

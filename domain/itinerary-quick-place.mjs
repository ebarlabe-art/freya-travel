// Direct, non-destructive place lookup for an existing itinerary card.
// The parent owns authorization, optimistic writes and agenda refresh.
const clean=value=>String(value??'').trim();
function usable(place){
 return place&&clean(place.canonical_name)&&clean(place.canonical_name).length<=200&&
  place.coordinate_role==='exact_location'&&Number.isFinite(place.latitude)&&Number.isFinite(place.longitude);
}

// Candidate relevance is a visual suggestion only: no writes or route geometry.
// Compare the full activity meaning, not only the first keyword used for geocoding.
const canonicalWords={
 teatro:'theater',teatre:'theater',theatre:'theater',theater:'theater',anatòmic:'anatomical',
 anatomico:'anatomical',anatomica:'anatomical',anatomical:'anatomical',
 palazzo:'palace',palau:'palace',palacio:'palace',piazza:'square',placa:'square',
 plaza:'square',square:'square',castell:'castle',castillo:'castle',castle:'castle',
 basilica:'basilica',basílica:'basilica',museum:'museum',museu:'museum',museo:'museum'
};
const genericWords=new Set('a al alla alle amb and at barcelona bologna bolonya ca catalunya de del della delle dell des di el els en entrada horaris i in la las le les lloc on or per subjecta the to una un visita visit visites disponibilitat aprox aproximada opcional possible proposat reservar amb sota avui aturada passeig pel pels punt entorn proper zona'.split(' '));
function words(value){
 const clean=String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .toLocaleLowerCase('ca').replace(/[’']/g,' ').replace(/[^a-z0-9]+/g,' ');
 return [...new Set(clean.split(' ').filter(word=>word.length>2&&!genericWords.has(word))
  .map(word=>canonicalWords[word]||word))];
}
export function prioritizeItineraryPlaces(row,query,places){
 const title=String(row?.title||'').split(/[(.;]/)[0].slice(0,200);
 const context=words(title),focus=words(String(query||'').split(',')[0]);
 const candidates=places.filter(usable);
 const ranked=candidates.map((place,index)=>{
  const name=words(place.canonical_name);
  const match=context.filter(token=>name.includes(token)).length;
  const focused=focus.filter(token=>name.includes(token)).length;
  const street=/^(?:via|viale|street|carrer|calle|road)\b/i.test(place.canonical_name);
  const score=3*focused/Math.max(1,focus.length)+
   3*match/Math.max(1,context.length)+
   (context.length>=2&&match>=2?1:0)-(street?1:0);
  return {place,index,match,focused,score};
 }).sort((a,b)=>b.score-a.score||a.index-b.index);
 const first=ranked[0],second=ranked[1];
 // Do not collapse ambiguous matches with same relevance. User confirms all writes.
 const strong=!!first&&focus.length>0&&first.focused===focus.length&&
   (first.match>=2||(focus.length>=2&&first.focused>=2))&&
   (!second||first.score-second.score>=1.25)&&
   !/^(?:via|viale|street|carrer|calle|road)\b/i.test(first.place.canonical_name);
 return {recommended:strong?first.place:null,
  choices:ranked.map(item=>item.place)};
}

export function mountQuickItineraryPlace({host,row,query,search,save,current,initialOptions=null}){
 if(!host||!row||typeof search!=='function'||typeof save!=='function')throw Error('Missing place picker contract');
 document.querySelectorAll('[data-quick-itinerary-place]').forEach(existing=>existing.remove());
 const section=document.createElement('section');section.dataset.quickItineraryPlace=row.id;
 section.className='itinerary-quick-place';
 section.style.cssText='margin:10px 0 0;padding:14px;border:1px solid var(--line);border-radius:14px;max-width:100%;min-width:0;overflow-wrap:anywhere;';
 section.setAttribute('aria-label','Cerca la ubicació de '+row.title);
 const heading=document.createElement('div');heading.className='itinerary-quick-place-heading';
 heading.style.cssText='display:flex;align-items:flex-start;flex-wrap:wrap;justify-content:space-between;gap:10px;min-width:0;width:100%';
 const title=document.createElement('strong');title.textContent='📍 Ubicació: '+row.title;
 title.style.cssText='min-width:0;flex:1 1 220px;overflow-wrap:anywhere';
 const close=document.createElement('button');close.type='button';close.className='ghost';close.textContent='✕ Tanca';
 close.style.cssText='flex:0 0 auto;min-width:84px;white-space:nowrap;align-self:flex-start';
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
  const {recommended,choices:ranked}=prioritizeItineraryPlaces(row,query,exact);
  status.textContent=recommended?'He reconegut la ubicació més probable per a aquesta activitat. Confirma-la, o consulta les alternatives si no és correcta.':
   exact.length===1?'He trobat una ubicació concreta. Confirma-la per vincular-la a aquesta activitat.':
   'Hi ha diverses ubicacions possibles. Tria la correcta.';
  const altBox=recommended&&ranked.length>1?document.createElement('details'):null;
  if(altBox){
   const summary=document.createElement('summary');summary.textContent='Mostra altres ubicacions ('+(ranked.length-1)+')';
   summary.style.cssText='cursor:pointer;min-height:44px;padding:10px 0';
   altBox.append(summary);
  }
  ranked.forEach(place=>{
   const button=document.createElement('button');button.type='button';button.className='secondary';
   button.textContent=(place===recommended||exact.length===1?'✓ Confirma: ':'📍 ')+
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
   if(altBox&&place!==recommended)altBox.append(button);
   else choices.append(button);
  });
  if(altBox)choices.append(altBox);
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

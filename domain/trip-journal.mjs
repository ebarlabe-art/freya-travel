const copies={
 title:['Diari de viatge','Diario de viaje','Travel journal','Carnet de voyage','Diario di viaggio'],
 private:['Privat · només per a tu','Privado · solo para ti','Private · only for you','Privé · pour vous uniquement','Privato · solo per te'],
 text:['Escriu un record','Escribe un recuerdo','Write a memory','Écrire un souvenir','Scrivi un ricordo'],
 record:['Enregistra veu','Graba voz','Record audio','Enregistrer la voix','Registra voce'],
 stop:['Atura','Detén','Stop','Arrêter','Ferma'],
 save:['Desa el record','Guarda el recuerdo','Save memory','Enregistrer le souvenir','Salva il ricordo'],
 draft:['Esborrany desat al dispositiu','Borrador guardado en el dispositivo','Draft saved on this device','Brouillon enregistré sur cet appareil','Bozza salvata sul dispositivo'],
 restore:['Recupera l’esborrany','Recupera el borrador','Recover draft','Récupérer le brouillon','Recupera la bozza'],
 discard:['Descarta l’esborrany','Descarta el borrador','Discard draft','Supprimer le brouillon','Elimina la bozza'],
 another:['Nou record','Nuevo recuerdo','New memory','Nouveau souvenir','Nuovo ricordo'],
 local:['Desat al dispositiu · pendent de sincronitzar','Guardado en el dispositivo · pendiente de sincronizar','Saved on this device · pending sync','Enregistré sur cet appareil · synchronisation en attente','Salvato sul dispositivo · sincronizzazione in attesa'],
 synced:['Sincronitzat','Sincronizado','Synced','Synchronisé','Sincronizzato'],
 pending:['Hi ha canvis pendents de sincronitzar.','Hay cambios pendientes de sincronizar.','Some changes are pending sync.','Des modifications sont en attente de synchronisation.','Alcune modifiche sono in attesa di sincronizzazione.'],
 conflict:['El record ha canviat en un altre dispositiu. La còpia d’aquí es conserva.','El recuerdo ha cambiado en otro dispositivo. Se conserva la copia local.','The memory changed on another device. This device’s copy is kept.','Le souvenir a changé sur un autre appareil. La copie locale est conservée.','Il ricordo è cambiato su un altro dispositivo. La copia locale è conservata.'],
 syncFail:['No s’ha pogut sincronitzar el diari.','No se ha podido sincronizar el diario.','The journal couldn’t sync.','Impossible de synchroniser le carnet.','Impossibile sincronizzare il diario.'],
 localFail:['No s’ha pogut desar al dispositiu.','No se ha podido guardar en el dispositivo.','Couldn’t save on this device.','Impossible d’enregistrer sur cet appareil.','Impossibile salvare sul dispositivo.'],
 retry:['Reintenta','Reintenta','Retry','Réessayer','Riprova'],
 empty:['Encara no hi ha cap record.','Aún no hay recuerdos.','No memories yet.','Aucun souvenir pour le moment.','Non ci sono ancora ricordi.'],
 edit:['Edita el text','Edita el texto','Edit text','Modifier le texte','Modifica il testo'],
 remove:['Elimina el record','Elimina el recuerdo','Delete memory','Supprimer le souvenir','Elimina il ricordo'],
 confirmRemove:['Vols eliminar aquest record?','¿Quieres eliminar este recuerdo?','Delete this memory?','Supprimer ce souvenir ?','Eliminare questo ricordo?'],
 confirmDiscard:['Vols descartar aquest esborrany?','¿Quieres descartar este borrador?','Discard this draft?','Supprimer ce brouillon ?','Eliminare questa bozza?'],
 listen:['Escolta','Escucha','Listen','Écouter','Ascolta'],
 original:['Descarrega l’àudio original','Descarga el audio original','Download original audio','Télécharger l’audio original','Scarica l’audio originale'],
 mic:['Cal permís per fer servir el micròfon.','Hace falta permiso para usar el micrófono.','Microphone permission is required.','L’accès au microphone est nécessaire.','Serve il permesso per usare il microfono.'],
 unavailable:['Aquest navegador no pot enregistrar veu. Encara pots escriure.','Este navegador no puede grabar voz. Puedes escribir.','This browser can’t record audio. You can still write.','Ce navigateur ne peut pas enregistrer la voix. Vous pouvez écrire.','Questo browser non può registrare la voce. Puoi scrivere.'],
 interrupted:['Enregistrament interromput. Escolta i revisa el fragment recuperat.','Grabación interrumpida. Escucha y revisa el fragmento recuperado.','Recording interrupted. Listen to the recovered clip before saving.','Enregistrement interrompu. Écoutez et vérifiez le fragment récupéré.','Registrazione interrotta. Ascolta e controlla il frammento recuperato.'],
 emptyAudio:['Sense àudio recuperable. Pots tornar a començar.','No hay audio recuperable. Puedes volver a empezar.','No audio could be recovered. You can start again.','Aucun enregistrement récupérable. Vous pouvez recommencer.','Nessun audio recuperabile. Puoi ricominciare.'],
 playbackFail:['No s’ha pogut obrir l’àudio en aquest dispositiu.','No se ha podido abrir el audio en este dispositivo.','Couldn’t open the audio on this device.','Impossible d’ouvrir l’audio sur cet appareil.','Impossibile aprire l’audio sul dispositivo.'],
 long:['Enregistrament massa gran per sincronitzar. La còpia local es conserva.','Grabación demasiado grande para sincronizar. Se conserva la copia local.','Recording is too large to sync. The local copy is kept.','Enregistrement trop volumineux pour la synchronisation. La copie locale est conservée.','Registrazione troppo grande per la sincronizzazione. La copia locale è conservata.'],
 limit:['Fins a 2 minuts per enregistrament','Hasta 2 minutos por grabación','Up to 2 minutes per recording','Jusqu’à 2 minutes par enregistrement','Fino a 2 minuti per registrazione'],
 saving:['Desant al dispositiu…','Guardando en el dispositivo…','Saving on this device…','Enregistrement sur cet appareil…','Salvataggio sul dispositivo…']
};
const languageIndex=['ca','es','en','fr','it'];
const formats=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];
const maxDuration=120000,maxAudio=4*1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder();
const metadataKey=id=>'entry:'+id;
const draftKey=id=>'draft:'+id;
const audioKey=id=>'audio:'+id;

export function journalDay(date,zone){
  try{
    const fields=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(part=>[part.type,part.value]));
    return fields.year+'-'+fields.month+'-'+fields.day;
  }catch(_){return journalDay(date,'UTC')}
}
export function journalAudioFormat(Recorder){
  return formats.find(format=>Recorder?.isTypeSupported?.(format))||'';
}
export function journalOperation(entry,patch,id){
  const operation={id,base:entry.operation_id??null,body:patch.body,deleted:!!patch.deleted};
  // Deleting a voice memory must not upload its discarded original. Its
  // creation ID still identifies any creation already accepted by the server.
  if(operation.deleted&&entry.audio_mime)
    return {...entry,...patch,audio_mime:null,duration_ms:null,operation_id:id,pending:[operation]};
  return {...entry,...patch,operation_id:id,pending:[...(entry.pending||[]),operation]};
}
function durationText(milliseconds){
  const seconds=Math.floor((milliseconds||0)/1000);
  return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
}
function canonicalMime(mime){return String(mime).split(';')[0].toLowerCase()}
function encode(value){return encoder.encode(JSON.stringify(value))}
function decode(bytes){return JSON.parse(decoder.decode(bytes))}

export function mountTripJournal(host,{store,remote,current,connected,language,zone,deletionChannel}){
  const tr=key=>copies[key][Math.max(0,languageIndex.indexOf(language))];
  const dayFormat=new Intl.DateTimeFormat(language,{dateStyle:'full',timeZone:'UTC'});
  const entries=new Map(),drafts=new Map();
  const abort=new AbortController();
  const channel=deletionChannel&&typeof BroadcastChannel==='function'?new BroadcastChannel(deletionChannel):null;
  let queue=Promise.resolve(),draft=null,capture=null,requesting=false,disposed=false,ready=false,syncing=false;
  let previewUrl='',entryUrl='',editingBusy=false,localError=false,retryAudio=null;
  host.innerHTML=`<p class="muted">${tr('private')}</p>
    <form class="doc-card journal-form"><label for="journalText">${tr('text')}</label>
      <textarea id="journalText" maxlength="12000" rows="4" disabled></textarea>
      <div class="doc-actions"><button type="button" data-journal-record disabled>${tr('record')}</button>
      <button type="button" class="secondary" data-journal-stop hidden>${tr('stop')}</button>
      <output data-journal-duration aria-live="off"></output></div>
      <p class="muted" data-journal-limit>${tr('limit')}</p>
      <audio data-journal-preview controls preload="metadata" hidden></audio>
      <a data-journal-preview-download hidden>${tr('original')}</a>
      <div class="doc-actions"><button type="submit" disabled>${tr('save')}</button>
      <button type="button" class="secondary" data-journal-new hidden>${tr('another')}</button>
      <button type="button" class="secondary" data-journal-discard hidden>${tr('discard')}</button></div>
      <p data-journal-local role="status"></p></form>
    <div data-journal-drafts class="doc-grid"></div>
    <p data-journal-sync role="status"></p>
    <button type="button" class="secondary" data-journal-retry hidden>${tr('retry')}</button>
    <div data-journal-entries class="doc-grid"></div>`;
  const find=selector=>host.querySelector(selector),form=find('form'),text=find('textarea'),preview=find('[data-journal-preview]'),status=find('[data-journal-local]'),syncStatus=find('[data-journal-sync]'),retry=find('[data-journal-retry]');
  const live=()=>current()&&!disposed;
  const show=(node,value)=>{if(live())node.textContent=value};
  function serial(work){
    const next=queue.then(()=>{if(current())return work()});
    queue=next.catch(()=>{});
    return next;
  }
  function localFailure(){
    localError=true;
    show(status,tr('localFail'));
    if(live())retry.hidden=false;
  }
  function renderControls(){
    if(!live())return;
    const locked=!ready||!!capture||requesting||editingBusy;
    text.disabled=locked;
    find('[data-journal-record]').disabled=locked||!!draft?.target||!!draft?.audio_mime;
    find('[data-journal-stop]').hidden=!capture;
    find('[data-journal-stop]').disabled=!!capture?.stopping;
    find('[type="submit"]').disabled=locked||!draft||retryAudio?.id===draft.id||(!draft.body.trim()&&!draft.audio_mime);
    find('[data-journal-discard]').hidden=!draft||locked;
    find('[data-journal-new]').hidden=!draft||locked;
    find('[data-journal-duration]').textContent=draft?.audio_mime?durationText(draft.duration_ms):'';
  }
  function newDraft(){
    const now=new Date();
    return {id:crypto.randomUUID(),local_day:journalDay(now,zone),captured_at:now.toISOString(),body:''};
  }
  function attachPreview(blob){
    const download=find('[data-journal-preview-download]');
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl='';
    preview.removeAttribute('src');
    download.removeAttribute('href');
    preview.hidden=!blob;
    download.hidden=!blob;
    if(blob){
      previewUrl=URL.createObjectURL(blob);preview.src=previewUrl;download.href=previewUrl;
      download.download='freya-record.'+({'audio/mp4':'m4a','audio/webm':'webm','audio/ogg':'ogg'}[blob.type]||'audio');
    }
  }
  function printDraft(value){
    draft=value;
    text.value=draft?.body||'';
    attachPreview(null);
    if(draft?.audio_mime){
      const selected=draft.id;
      store.read(audioKey(selected)).then(bytes=>{
        if(live()&&draft?.id===selected&&bytes)attachPreview(new Blob([bytes],{type:draft.audio_mime}));
      }).catch(()=>show(status,tr('playbackFail')));
    }
    renderControls();
    renderDrafts();
  }
  function renderDrafts(){
    if(!live())return;
    const list=find('[data-journal-drafts]');list.replaceChildren();
    for(const value of drafts.values()){
      if(value.id===draft?.id)continue;
      const button=document.createElement('button');button.type='button';button.className='secondary';
      button.textContent=tr('restore')+' · '+dayFormat.format(new Date(value.local_day+'T12:00:00Z'));
      button.onclick=()=>{if(!capture&&!requesting&&!editingBusy)printDraft(value)};
      list.append(button);
    }
  }
  function listButton(label,click){
    const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=tr(label);button.onclick=click;return button;
  }
  function clearEntryPlayback(){
    for(const box of host.querySelectorAll('[data-journal-playback]')){
      const player=box.querySelector('audio');
      player.pause();player.removeAttribute('src');player.load();
      box.remove();
    }
    if(entryUrl){URL.revokeObjectURL(entryUrl);entryUrl=''}
  }
  function renderEntries(){
    if(!live())return;
    const list=find('[data-journal-entries]');
    clearEntryPlayback();
    list.replaceChildren();
    const visible=[...entries.values()].filter(entry=>!entry.deleted).sort((one,two)=>
      two.local_day.localeCompare(one.local_day)||Date.parse(two.captured_at)-Date.parse(one.captured_at));
    let day='';
    for(const entry of visible){
      if(entry.local_day!==day){
        day=entry.local_day;
        const heading=document.createElement('h3');heading.textContent=dayFormat.format(new Date(day+'T12:00:00Z'));list.append(heading);
      }
      const card=document.createElement('article');card.className='doc-card';
      const copy=document.createElement('p');copy.className='journal-body';copy.textContent=entry.body;copy.hidden=!entry.body;card.append(copy);
      const summary=document.createElement('small');summary.className='muted';
      summary.textContent=(entry.audio_mime?'🎙️ '+durationText(entry.duration_ms)+' · ':'')+tr(entry.pending?.length?'local':'synced');card.append(summary);
      const actions=document.createElement('div');actions.className='doc-actions';card.append(actions);
      if(entry.audio_mime)actions.append(listButton('listen',async()=>{
        try{
          let bytes=await store.read(audioKey(entry.id));
          if(!bytes&&connected()){
            bytes=await remote.audio(entry.id);
            if(bytes)await serial(()=>{
              if(!entries.get(entry.id)?.deleted)return store.write([[audioKey(entry.id),bytes]]);
            });
          }
          if(!live()||!card.isConnected||entries.get(entry.id)?.deleted)return;
          if(!bytes)throw Error('audio unavailable');
          const saved=await store.read(metadataKey(entry.id));
          if(!saved||decode(saved).deleted||!live()||!card.isConnected)return;
          clearEntryPlayback();
          entryUrl=URL.createObjectURL(new Blob([bytes],{type:entry.audio_mime}));
          const player=document.createElement('audio');player.controls=true;player.src=entryUrl;
          const download=document.createElement('a');download.href=entryUrl;
          download.download='freya-'+entry.id+'.'+({'audio/mp4':'m4a','audio/webm':'webm','audio/ogg':'ogg'}[entry.audio_mime]||'audio');
          download.textContent=tr('original');
          const box=document.createElement('div');box.dataset.journalPlayback='';box.append(player,download);card.append(box);
        }catch(_){show(status,tr('playbackFail'))}
      }));
      else actions.append(listButton('edit',()=>{
        if(capture||requesting||editingBusy)return;
        printDraft({...newDraft(),target:entry.id,body:entry.body,local_day:entry.local_day,captured_at:entry.captured_at});
      }));
      actions.append(listButton('remove',()=>{
        if(!confirm(tr('confirmRemove')))return;
        serial(async()=>{
          const prior=entries.get(entry.id);
          if(!prior||prior.deleted)return;
          const updated=journalOperation(prior,{body:'',deleted:true},crypto.randomUUID());
          await store.write([[metadataKey(entry.id),encode(updated)]],prior.audio_mime?[audioKey(entry.id)]:[]);
          entries.set(entry.id,updated);renderEntries();
          if(!disposed)channel?.postMessage(entry.id);
          show(syncStatus,tr('pending'));void synchronize();
        }).catch(localFailure);
      }));
      list.append(card);
    }
    if(!visible.length){const empty=document.createElement('p');empty.textContent=tr('empty');list.append(empty)}
  }
  async function persistDraft(value,blob){
    const rows=[[draftKey(value.id),encode(value)]];
    if(blob)rows.push([audioKey(value.id),new Uint8Array(await blob.arrayBuffer())]);
    await store.write(rows);
    if(blob&&retryAudio?.blob===blob)retryAudio=null;
    drafts.set(value.id,value);
    if(live()&&draft?.id===value.id){show(status,tr('draft'));localError=false;renderDrafts()}
  }
  text.oninput=()=>{
    if(!draft)draft=newDraft();
    draft.body=text.value;
    const value={...draft};
    show(status,tr('saving'));renderControls();
    serial(()=>persistDraft(value)).catch(localFailure);
  };
  find('[data-journal-new]').onclick=()=>{printDraft(null);show(status,'')};
  find('[data-journal-discard]').onclick=()=>{
    if(!draft||!confirm(tr('confirmDiscard')))return;
    const item=draft;editingBusy=true;renderControls();
    serial(async()=>{
      await store.write([], [draftKey(item.id),...(item.audio_mime?[audioKey(item.id)]:[])]);
      if(retryAudio?.id===item.id)retryAudio=null;
      drafts.delete(item.id);printDraft(null);show(status,'');
    }).catch(localFailure).finally(()=>{editingBusy=false;renderControls()});
  };
  form.onsubmit=event=>{
    event.preventDefault();
    if(!draft||capture||requesting||editingBusy||retryAudio?.id===draft.id||(!draft.body.trim()&&!draft.audio_mime))return;
    const value={...draft};editingBusy=true;renderControls();show(status,tr('saving'));
    serial(async()=>{
      const {target,interrupted,...data}=value;
      const original=target?entries.get(target):data;
      if(!original||original.deleted||target&&original.audio_mime)throw Error('entry unavailable');
      if(data.audio_mime&&!await store.read(audioKey(data.id)))throw Error('audio draft unavailable');
      const entry=journalOperation(original,{body:data.body,deleted:false},crypto.randomUUID());
      await store.write([[metadataKey(entry.id),encode(entry)]],[draftKey(value.id)]);
      entries.set(entry.id,entry);drafts.delete(value.id);printDraft(null);renderEntries();show(status,tr('local'));
      void synchronize();
    }).catch(localFailure).finally(()=>{editingBusy=false;renderControls()});
  };
  function stop(interrupted=false){
    if(!capture||capture.stopping)return;
    capture.stopping=true;capture.interrupted=interrupted;
    if(capture.recorder.state!=='inactive')capture.recorder.stop();
    renderControls();
  }
  find('[data-journal-stop]').onclick=()=>stop();
  find('[data-journal-record]').onclick=async()=>{
    const Recorder=globalThis.MediaRecorder,format=journalAudioFormat(Recorder);
    if(!format||!navigator.mediaDevices?.getUserMedia){show(status,tr('unavailable'));return}
    requesting=true;renderControls();
    let stream;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!live()){stream.getTracks().forEach(track=>track.stop());return}
      const recorder=new Recorder(stream,{mimeType:format,audioBitsPerSecond:64000});
      const value=draft||newDraft();draft=value;draft.audio_mime=canonicalMime(recorder.mimeType||format);
      const active={recorder,stream,chunks:[],size:0,started:performance.now(),stopping:false};
      capture=active;
      const elapsed=()=>Math.max(1,Math.min(150000,Math.round(performance.now()-active.started)));
      recorder.ondataavailable=event=>{
        if(!event.data.size||!current())return;
        active.chunks.push(event.data);active.size+=event.data.size;
        const snapshot={...value,duration_ms:elapsed(),interrupted:true};
        const blob=new Blob(active.chunks,{type:value.audio_mime});
        serial(()=>persistDraft(snapshot,blob)).catch(localFailure);
        if(active.size>=maxAudio)stop(true);
      };
      recorder.onstop=()=>{
        clearInterval(active.timer);stream.getTracks().forEach(track=>track.stop());
        capture=null;
        if(!active.chunks.length){delete value.audio_mime;show(status,tr('emptyAudio'));renderControls();return}
        const interrupted=!!active.interrupted||!active.stopping;
        Object.assign(value,{duration_ms:elapsed(),interrupted});
        const blob=new Blob(active.chunks,{type:value.audio_mime});
        retryAudio={id:value.id,blob};
        if(live()&&draft?.id===value.id)attachPreview(blob);
        serial(()=>persistDraft({...value},blob)).then(()=>{
          if(interrupted)show(status,tr('interrupted'));
          renderControls();
        }).catch(localFailure);
        renderControls();
      };
      recorder.onerror=()=>stop(true);
      for(const track of stream.getTracks())track.addEventListener('ended',()=>stop(true),{once:true});
      recorder.start(2500);
      active.timer=setInterval(()=>{
        show(find('[data-journal-duration]'),durationText(elapsed()));
        if(elapsed()>=maxDuration)stop();
      },250);
    }catch(error){
      stream?.getTracks().forEach(track=>track.stop());
      capture=null;
      if(draft?.audio_mime&&!draft.duration_ms)delete draft.audio_mime;
      show(status,tr(error?.name==='NotAllowedError'||error?.name==='NotFoundError'?'mic':'unavailable'));
    }finally{requesting=false;renderControls()}
  };
  async function synchronize(){
    if(syncing||!ready||!live()||!connected())return;
    syncing=true;retry.hidden=true;
    let syncError='';
    try{
      for(const entry of entries.values()){
        while(live()&&connected()&&entries.get(entry.id)?.pending?.length){
          const latest=entries.get(entry.id),operation=latest.pending[0];
          let bytes=null;
          if(!operation.base&&latest.audio_mime){
            bytes=await store.read(audioKey(latest.id));
            if(entries.get(entry.id)?.pending?.[0]?.id!==operation.id)continue;
            if(!bytes||bytes.byteLength>maxAudio){syncError='long';break}
          }
          try{
            const accepted=await remote.save(latest,operation,bytes);
            if(accepted!==operation.id)throw Error('journal acknowledgement missing');
          }catch(error){
            if(entries.get(entry.id)?.pending?.[0]?.id!==operation.id)continue;
            throw error;
          }
          await serial(async()=>{
            const currentEntry=entries.get(entry.id);
            if(currentEntry?.pending?.[0]?.id!==operation.id)return;
            const next={...currentEntry,pending:currentEntry.pending.slice(1)};
            await store.write([[metadataKey(next.id),encode(next)]]);
            entries.set(next.id,next);
          });
        }
      }
      if(live()&&connected()){
        const rows=await remote.list();
        await serial(async()=>{
          const changes=rows.filter(row=>!entries.get(row.id)?.pending?.length&&entries.get(row.id)?.operation_id!==row.operation_id);
          if(changes.length)await store.write(changes.map(row=>[metadataKey(row.id),encode(row)]),
            changes.filter(row=>row.deleted).map(row=>audioKey(row.id)));
          for(const row of changes){
            entries.set(row.id,row);
            if(row.deleted&&!disposed)channel?.postMessage(row.id);
          }
        });
      }
    }catch(error){syncError=error?.code==='40001'?'conflict':'syncFail'}
    finally{
      syncing=false;
      if(live()){
        const pending=[...entries.values()].some(entry=>entry.pending?.length);
        show(syncStatus,syncError?tr(syncError):pending?tr('pending'):'');retry.hidden=!syncError&&!localError;
        if(!pending&&!syncError&&status.textContent===tr('local'))show(status,tr('synced'));
        renderEntries();
      }
    }
  }
  retry.onclick=()=>{
    if(!ready){void initialize();return}
    if(localError&&draft){
      const value={...draft},blob=retryAudio?.id===draft.id?retryAudio.blob:null;
      serial(()=>persistDraft(value,blob)).then(renderControls).catch(localFailure);
    }
    void synchronize();
  };
  window.addEventListener('online',()=>void synchronize(),{signal:abort.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop(true)},{signal:abort.signal});
  window.addEventListener('pagehide',()=>stop(true),{signal:abort.signal});
  if(channel)channel.onmessage=event=>{
    const id=event.data;
    if(typeof id!=='string'||!live()||!entries.has(id))return;
    clearEntryPlayback();
    serial(async()=>{
      const bytes=await store.read(metadataKey(id));
      if(!bytes)return;
      const entry=decode(bytes);
      if(!entry.deleted)return;
      entries.set(id,entry);renderEntries();
    }).catch(localFailure);
  };
  const initialize=()=>serial(async()=>{
    for(const label of await store.labels()){
      if(label.startsWith('audio:'))continue;
      const bytes=await store.read(label);
      if(!bytes)continue;
      const value=decode(bytes);
      (label.startsWith('draft:')?drafts:entries).set(value.id,value);
    }
    if(!live())return;
    ready=true;
    const recovered=[...drafts.values()].at(-1);
    printDraft(recovered||null);renderEntries();
    if(recovered)show(status,tr(recovered.interrupted?'interrupted':'draft'));
    if([...entries.values()].some(entry=>entry.pending?.length))show(syncStatus,tr('pending'));
    void synchronize();
  }).catch(localFailure);
  const initialized=initialize();
  return {initialized,reconnect:synchronize,dispose(){
    stop(true);capture?.stream.getTracks().forEach(track=>track.stop());
    disposed=true;abort.abort();channel?.close();attachPreview(null);
    clearEntryPlayback();
  }};
}

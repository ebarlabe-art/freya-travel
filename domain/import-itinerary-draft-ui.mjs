// UI orchestration for an encrypted uncommitted PDF review.
// Neither this module nor the storage writes to Supabase.
import {saveImportDraft,loadImportDraft,discardImportDraft,discardUserImportDrafts} from './import-itinerary-draft.mjs';
export {discardImportDraft,discardUserImportDrafts};
const scope=s=>({userId:s.userId,tripId:s.tripId});
export async function pause(s,c){
 if(!c.current(s))return;
 if(s.busy||s.preparing||s.planningBusy){c.status('Acaba la comprovació abans de sortir.');return}
 if(!s.review||!s.reconciliation||s.saveCompleted||s.reconciliation.pendingRequest){c.close();return}
 try{
  s.busy=true;c.status('Guardant la revisió xifrada en aquest dispositiu…');
  await saveImportDraft(scope(s),{
   documentId:s.documentId,review:s.review,
   reconciliation:{existing:s.reconciliation.existing,decisions:s.reconciliation.decisions,retire:s.reconciliation.retire},
   flash:s.flash||{deferred:[],history:[],targets:{}},
   fileMeta:s.file?{name:s.file.name,type:s.file.type,size:s.file.size,lastModified:s.file.lastModified}:null
  },s.file,{current:()=>c.current(s)});
  if(!c.current(s))return;
  c.close();c.button('↩ Reprèn la proposta');c.message('Revisió guardada xifrada durant 24 hores en aquest dispositiu. Cap canvi desat al viatge.');
 }catch(error){if(c.current(s))c.status('No s’ha pogut desar la revisió, que continua oberta: '+(error?.message||'Torna-ho a provar.'))}
 finally{if(c.current(s)){s.busy=false;c.render()}}
}
const identity=rows=>JSON.stringify(rows.map(x=>[x.id,x.updated_at,x.status,x.is_fixed,x.photo_count,x.link_count]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
export async function resume(s,c){
 const saved=await loadImportDraft(scope(s));if(!c.current(s))return true;
 if(!saved)return false;
 const d=saved.data;
 if(d.review.scope?.tripId!==s.tripId||d.review.scope?.userId!==s.userId||d.review.scope?.documentId!==d.documentId)throw Error('La revisió no correspon a aquest viatge.');
 const rows=await c.readCurrent(s);if(!c.current(s))return true;
 if(!Array.isArray(rows))throw Error('No s’ha pogut contrastar el planning actual.');
 const stale=identity(rows)!==identity(d.reconciliation.existing);
 const [reviewApi,saveApi,reconcileApi,planningApi,flashApi]=await c.modules();
 if(!c.current(s))return true;
 const existing=rows.map(c.decorateRow);
 Object.assign(s,{
  api:reviewApi,saveApi,documentId:d.documentId,review:d.review,file:saved.file,
  reconciliation:{api:reconcileApi,existing,decisions:stale?[]:d.reconciliation.decisions||[],retire:stale?[]:d.reconciliation.retire||[],pendingRequest:null,unified:true},
  planningApi,flashApi,flash:stale?{deferred:[],history:[],targets:{}}:d.flash||{deferred:[],history:[],targets:{}},
  reviewedConflicts:[],selectedConflict:null,planning:null,unified:true
 });
 if(stale){
  const snapshot=reviewApi.summarizeItineraryReview(s.review,existing);
  s.reconciliation.decisions.push(...planningApi.automaticEquivalentDecisions(snapshot,existing,[]));
  s.reconciliation.decisions.push(...flashApi.prepareFlashDecisions(snapshot,s.reconciliation,c.planningContext(s)));
 }
 c.showReview();
 c.resumeMessage(stale);
 c.render();
 return true;
}
export async function discard(s){await discardImportDraft(scope(s))}

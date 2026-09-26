import {prepareBriefPatch, applyBriefPatch, readBrief, resolveBriefDecision} from './trip-brief.mjs';

export const builderModes = {
  inspire: {title:'✨ Inspira’m', description:'No sé on anar. Ajuda’m a trobar el viatge.', prompt:'Quin viatge et ve de gust? No cal que sàpigues la destinació.'},
  destination: {title:'📍 Ja sé on vull anar', description:'Tinc destinació. Ajuda’m a construir-lo.', prompt:'On t’agradaria anar i què hi voldries fer?'},
  idea: {title:'🧭 Tinc una idea', description:'Sé més o menys què vull. Ajuda’m a donar-li forma.', prompt:'Explica’ns la idea que tens al cap.'},
};
export function briefKnownFacts(row) {
  const facts=[];
  for (const field of ['destination','dates','origin']) {
    const resolved=resolveBriefDecision(row.document,field);
    const d=resolved?.decision;
    if (!d || d.knowledge!=='known' || resolved.requiresConfirmation) continue;
    if ((field==='destination'||field==='origin') && d.value.places?.length) facts.push(d.value.places.join(' + '));
    if (field==='dates') facts.push(d.value.mode==='exact'?`${d.value.start} – ${d.value.end}`:`${d.value.earliest} – ${d.value.latest} (marge)`);
  }
  return facts;
}
export function briefLabel(row) {return briefKnownFacts(row).join(' · ')||'Viatge en preparació'}
export function briefNotes(row) {return resolveBriefDecision(row.document,'notes')}
export async function listOpenBriefs(client,owner,current=()=>true) {
  const rows=[];
  for(let offset=0;;offset+=100){
    const {data,error}=await client.from('trip_briefs').select('*').eq('owner_id',owner).is('trip_id',null).order('updated_at',{ascending:false}).order('id',{ascending:true}).range(offset,offset+99);
    if(error)throw error;if(!current())return [];
    rows.push(...(data||[]).filter(row=>row.owner_id===owner&&row.trip_id===null&&row.schema_version===1));
    if((data||[]).length<100)break;
  }
  return rows.sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||a.id.localeCompare(b.id));
}
export async function loadOwnedBrief(client,owner,id) {
  const row=await readBrief(client,id);
  if(!row||row.owner_id!==owner||row.trip_id!==null||row.schema_version!==1){const error=new Error('Aquest esborrany ja no està disponible.');error.code='BRIEF_UNAVAILABLE';throw error}
  return row;
}
export function notesPatch(row,text,confirmHard=false) {
  const previous=briefNotes(row),id=previous?.id||`notes_${crypto.randomUUID().replaceAll('-','')}`;
  if(text.length>2000)throw new Error('El text pot tenir com a màxim 2.000 caràcters.');
  if(previous?.decision.strength==='hard'&&!confirmHard)throw new Error('Cal confirmar el canvi de les notes protegides.');
  return prepareBriefPatch({briefId:row.id,expectedRevision:row.revision,
    set:text.trim()?{decisions:{[id]:{field:'notes',scope:'global',knowledge:'known',origin:'explicit_user',strength:previous?.decision.strength||'preference',value:text}}}:{},
    remove:!text.trim()&&previous?{decisions:[id]}:{},
    confirmHard:previous?.decision.strength==='hard'?[id]:[]});
}
export function withBriefTimeout(promise,ms=30000){
  let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('La resposta triga massa. Reintenta la mateixa operació.')),ms)})]).finally(()=>clearTimeout(timer));
}
// Only identifiers, mode and a pending immutable TB-01 command live in tab storage.
// Persist before sending so refresh/lost responses reuse the original operation ID.
export class BuilderSession {
  constructor(client,owner,storage){
    this.client=client;this.owner=owner;this.storage=storage;this.key=`freya-builder-v1:${owner}`;
    const stored=storage.getItem(this.key);
    try{this.state=JSON.parse(stored)||{}}catch{throw new Error('No es pot llegir l’operació local pendent. No s’ha iniciat cap esborrany nou.')}
    if(typeof this.state!=='object'||Array.isArray(this.state))throw new Error('Estat local del Builder no vàlid.');
  }
  persist(){this.storage.setItem(this.key,JSON.stringify(this.state))}
  route(id,mode='resume'){this.state.route={id,mode};this.persist()}
  clearRoute(){delete this.state.route;this.persist()}
  prepareStart(mode){
    if(!builderModes[mode])throw new Error('Mode desconegut.');
    if(this.state.pending)throw new Error('Verifica primer l’operació pendent abans de començar un altre viatge.');
    this.state.pending={kind:'create',mode,command:prepareBriefPatch()};this.persist();return this.state.pending;
  }
  prepareSave(row,text,confirmed){
    if(this.state.pending)throw new Error('Hi ha un desament pendent de verificar.');
    this.state.pending={kind:'notes',mode:this.state.route?.mode||'resume',command:notesPatch(row,text,confirmed)};this.persist();
  }
  async execute(){
    const pending=this.state.pending;if(!pending)throw new Error('No hi ha cap operació pendent.');
    this.persist(); // Fail closed if the pending identity cannot survive refresh.
    const result=await withBriefTimeout(applyBriefPatch(this.client,pending.command));
    const row=result.brief;
    if(row?.owner_id!==this.owner||row.schema_version!==1||row.trip_id!==null)throw new Error('Resposta del Brief no vàlida.');
    const next={...this.state,route:{id:row.id,mode:pending.mode}};delete next.pending;
    this.storage.setItem(this.key,JSON.stringify(next));this.state=next;return row;
  }
  discardRejected(){delete this.state.pending;this.persist()}
}

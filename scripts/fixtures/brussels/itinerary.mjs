// Fictional programme with the same two-table structure as the reported case.
const schedule=[
 ['Dimarts 1 de desembre',[
  ['08:30–09:00','Trobada del grup'],['09:15–09:45','Trasllat al centre institucional'],
  ['10:00–10:30','Acreditacions'],['10:45–11:30','Sessió sobre institucions europees'],
  ['11:45–12:30','Visita a l’hemicicle'],['13:00–14:00','Pausa per dinar'],
  ['14:30–15:15','Taula sobre política europea'],['15:30–16:15','Visita a l’exposició fictícia'],
  ['16:45','Tornada a l’allotjament'],['17:30','Trobada de conclusió']
 ]],
 ['Dimecres 2 de desembre',[
  ['08:45–09:15','Trobada del segon dia'],['09:30–10:15','Passeig pel barri institucional'],
  ['10:30–11:15','Taller sobre procediment legislatiu'],['11:30–12:15','Conversa amb l’equip pedagògic'],
  ['12:45–13:45','Pausa del migdia'],['14:00–14:45','Debat de conclusions'],
  ['15:00–15:30','Trasllat de tornada']
 ]]
];
export const brusselsTranscript={complete:true,warnings:[],pages:[],blocks:[]};
for(const [index,[heading,entries]] of schedule.entries()){
 const page=index+1;
 const lines=page===1?['Brussel·les, 1 i 2 de desembre 2026']:[];
 lines.push(heading,'Hora | Activitat | Informació complementària');
 for(const [position,[time,title]] of entries.entries()){
  const excerpt=position===0?'Lloc: Seu de demostració | Adreça: 10 Carrer de Mostra | Ciutat: Brussel·les | Notes: Arribeu cinc minuts abans. | Enllaç: https://example.org/programa':
   position===1?'Notes: Sortida conjunta.':'Ciutat: Brussel·les';
  lines.push([time,title,excerpt].join(' | '));
  brusselsTranscript.blocks.push({page,heading,time,title,excerpt,role:'activity'});
 }
 brusselsTranscript.pages.push({page,text:lines.join('\n')});
}
export const brusselsSource={kind:'document',document_id:'17200000-0000-4000-8000-000000000006',file_name:'programa-sintetic-brusselles.pdf',mime_type:'application/pdf'};
export const brusselsTrip={id:'17200000-0000-4000-8000-000000000001',name:'Brussel·les sintètic',start_date:'2026-12-01',end_date:'2026-12-02',time_zone:'Europe/Brussels'};
export const verifiedBrusselsStops=[{canonical_name:'Brussel·les',time_zone:'Europe/Brussels'}];

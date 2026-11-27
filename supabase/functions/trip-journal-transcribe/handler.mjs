const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId=value=>typeof value==='string'&&uuid.test(value);
const languages=new Set(['ca','es','en','fr','it']);
const extensions=new Map([['audio/mp4','m4a'],['audio/webm','webm'],['audio/ogg','ogg']]);
const headers={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Cache-Control':'no-store',
  'Content-Type':'application/json'
};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});

export async function transcribeRecording(record,language,apiKey,request=fetch){
  const extension=extensions.get(record.mime);
  if(!extension||typeof record.audio!=='string'||record.audio.length>5592408||
      !Number.isInteger(record.duration)||record.duration<1||record.duration>150000)throw Error('invalid_audio');
  const bytes=Uint8Array.from(atob(record.audio),unit=>unit.charCodeAt(0));
  if(!bytes.length||bytes.length>4*1024*1024)throw Error('invalid_audio');
  const form=new FormData();
  form.append('file',new Blob([bytes],{type:record.mime}),'recording.'+extension);
  form.append('model','gpt-transcribe');
  form.append('response_format','json');
  if(language)form.append('languages[]',language);
  const reply=await request('https://api.openai.com/v1/audio/transcriptions',{
    method:'POST',headers:{Authorization:'Bearer '+apiKey},body:form,signal:AbortSignal.timeout(65000)
  });
  if(!reply.ok)throw Error('provider_failed');
  const result=await reply.json(),text=typeof result?.text==='string'?result.text.trim():'';
  if(!text||text.length>12000||text.includes('\0'))throw Error('invalid_transcript');
  const detected=Array.isArray(result.languages)?result.languages[0]?.code:null;
  return {text,language:typeof detected==='string'&&/^[a-z]{2,3}$/.test(detected)?detected:null};
}

export function createJournalTranscriptionHandler({authorize,rpc,transcribe}){
  return async request=>{
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(request.method!=='POST')return json({error:'method'},405);
    try{
      const actor=await authorize(request.headers.get('authorization'));
      if(!actor)return json({error:'auth'},401);
      if(Number(request.headers.get('content-length'))>65536)return json({error:'invalid'},400);
      let input;
      try{
        const raw=await request.text();
        if(raw.length>65536)throw Error('invalid');
        input=JSON.parse(raw);
      }catch{return json({error:'invalid'},400)}
      if(!input||!validId(input.entry)||!validId(input.trip)||!validId(input.id))return json({error:'invalid'},400);
      const scope={p_actor:actor,p_trip:input.trip,p_entry:input.entry};
      if(input.action==='transcribe'){
        if((input.epoch!==null&&!validId(input.epoch))||(input.language!==null&&!languages.has(input.language))||
            typeof input.requestedAt!=='string'||!Number.isFinite(Date.parse(input.requestedAt)))return json({error:'invalid'},400);
        if(!transcribe)return json({status:'unavailable'});
        const job=await rpc('claim_trip_journal_transcription_v1',{...scope,p_request:input.id,p_epoch:input.epoch,
          p_requested_at:new Date(input.requestedAt).toISOString()});
        if(job.status!=='claimed')return json({status:job.status});
        let result;
        try{result=await transcribe(job,input.language)}catch{result=null}
        const status=await rpc('finish_trip_journal_transcription_v1',{...scope,p_request:input.id,
          p_text:result?.text??null,p_language:result?.language??null});
        return json({status});
      }
      if(!['edit','remove_audio','remove_transcript'].includes(input.action)||!validId(input.base)||
          (input.action==='edit'&&(typeof input.text!=='string'||!input.text.trim()||input.text.length>12000||input.text.includes('\0')))){
        return json({error:'invalid'},400);
      }
      const id=await rpc('mutate_trip_journal_transcript_v1',{...scope,p_operation:input.id,p_base:input.base,
        p_action:input.action,p_text:input.action==='edit'?input.text:null});
      return json({id});
    }catch(error){
      if(error?.code==='40001')return json({error:'conflict'},409);
      if(error?.code==='42501')return json({error:'access'},403);
      return json({error:'unavailable'},503);
    }
  };
}

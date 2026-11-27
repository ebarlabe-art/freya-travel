import {createJournalTranscriptionHandler,transcribeRecording} from './handler.mjs';

const url=Deno.env.get('SUPABASE_URL')||'';
const anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const key=Deno.env.get('OPENAI_API_KEY')||'';

Deno.serve(createJournalTranscriptionHandler({
  async authorize(auth:string|null){
    if(!url||!anon||!auth?.startsWith('Bearer '))return null;
    const response=await fetch(url+'/auth/v1/user',{
      headers:{Authorization:auth,apikey:anon},signal:AbortSignal.timeout(8000)
    });
    if(response.status===401||response.status===403)return null;
    if(!response.ok)throw Error('auth_unavailable');
    return (await response.json())?.id||null;
  },
  async rpc(name:string,args:Record<string,unknown>){
    if(!url||!service)throw Error('database_unavailable');
    const response=await fetch(url+'/rest/v1/rpc/'+name,{
      method:'POST',headers:{Authorization:'Bearer '+service,apikey:service,'Content-Type':'application/json'},
      body:JSON.stringify(args),signal:AbortSignal.timeout(8000)
    });
    if(!response.ok){
      const error=await response.json().catch(()=>null);
      throw {code:error?.code};
    }
    return response.json();
  },
  transcribe:key?(audio:unknown,language:string|null)=>transcribeRecording(audio,language,key):null
}));

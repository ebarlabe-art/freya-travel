// Build-time configuration only. No credentials are logged or written into source.
// Supabase publishable keys are public by design; NEVER supply service_role.
const PRODUCTION_SUPABASE_HOST='otueskpksylzvkhldoft.supabase.co';
const URL_MARKER=/const SUPABASE_URL='[^']+';/g;
const KEY_MARKER=/const SUPABASE_KEY='[^']+';/g;
function fail(){throw new Error('El build de Freya PROVES necessita un backend Supabase de proves independent i una clau publica valida. No s’ha canviat cap fitxer.');}
export function configurePagesBackend(html,environment={}){
 if(typeof html!=='string')fail();
 const mode=(environment.FREYA_BACKEND_ENV||'production').trim();
 const url=(environment.FREYA_STAGING_SUPABASE_URL||'').trim();
 const key=(environment.FREYA_STAGING_SUPABASE_PUBLISHABLE_KEY||'').trim();
 if(!['production','staging'].includes(mode))fail();
 if(mode==='production'){
  if(url||key)fail(); // avoid accidental production builds with ignored staging parameters
  return html;
 }
 if(!url||!key)fail();
 let parsed;
 try{parsed=new URL(url);}catch{fail();}
 if(parsed.protocol!=='https:'||!/^[-a-z0-9]+\.supabase\.co$/.test(parsed.hostname)||
  parsed.hostname===PRODUCTION_SUPABASE_HOST||parsed.pathname!=='/'||
  parsed.search||parsed.hash||parsed.username||parsed.password)fail();
 if(!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key))fail();
 const urlMatches=html.match(URL_MARKER)||[],keyMatches=html.match(KEY_MARKER)||[];
 if(urlMatches.length!==1||keyMatches.length!==1||
  !urlMatches[0].includes(PRODUCTION_SUPABASE_HOST))fail();
 return html
  .replace(URL_MARKER,'const SUPABASE_URL='+JSON.stringify(parsed.origin)+';')
  .replace(KEY_MARKER,'const SUPABASE_KEY='+JSON.stringify(key)+';');
}

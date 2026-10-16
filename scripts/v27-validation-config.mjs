// Used only by the explicit validation build; never changes the public entry.
export const protectedRefs=['otueskpksylzvkhldoft','waatqrqyddurultrazbn'];
export const productionWorker='https://travel-book-derivatives-production.up.railway.app/process';
export function validationConfig(env){
  const ref=env.FREYA_VALIDATION_PROJECT_REF;
  if(!/^[a-z]{20}$/.test(ref||'')||protectedRefs.includes(ref))throw Error('A separate validation project ref is required');
  const url=`https://${ref}.supabase.co`;
  if(env.FREYA_VALIDATION_SUPABASE_URL!==url)throw Error('Validation URL must match the approved project ref exactly');
  const key=env.FREYA_VALIDATION_PUBLISHABLE_KEY;
  if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key||''))throw Error('Only a validation publishable key is accepted');
  return {ref,url,key};
}
export function validationEntry(html,config){
  const oldKey=html.match(/const SUPABASE_KEY='([^']+)';/)?.[1];
  if(!oldKey||oldKey===config.key)throw Error('Validation key must differ from the public entry key');
  const urlMarker=/const SUPABASE_URL='[^']+';/g;
  if([...html.matchAll(urlMarker)].length!==1)throw Error('Unexpected Supabase URL entry');
  if(!html.includes(productionWorker))throw Error('Production worker guard needs review');
  return html.replace(urlMarker,`const SUPABASE_URL='${config.url}';`)
    .replace(`const SUPABASE_KEY='${oldKey}';`,`const SUPABASE_KEY='${config.key}';`)
    .replace("if(last.state==='derivative_pending'){","if(last.state==='derivative_pending'){throw Error('Photo derivatives unavailable in V27 validation');")
    .replaceAll(productionWorker,config.url+'/functions/v1/validation-disabled-worker')
    .replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="connect-src 'self' ${config.url} wss://${config.ref}.supabase.co; form-action 'self'; base-uri 'self'">`)
    .replace('<title>','<title>VALIDACIÓ V27 — ');
}

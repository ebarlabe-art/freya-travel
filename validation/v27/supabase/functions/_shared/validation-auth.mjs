// Validation overlay only. Auth API verifies current signing keys and user JWTs.
const ref = Deno.env.get('VALIDATION_PROJECT_REF') || '';
const url = Deno.env.get('SUPABASE_URL') || '';
const key = Deno.env.get('SUPABASE_ANON_KEY') || '';
const origin = Deno.env.get('VALIDATION_ORIGIN') || '';
if (!/^[a-z]{20}$/.test(ref) || ['otueskpksylzvkhldoft','waatqrqyddurultrazbn'].includes(ref) ||
    url !== `https://${ref}.supabase.co` || !key || !/^https:\/\/[^/]+\.pages\.dev$/.test(origin)) {
  throw new Error('Invalid isolated validation configuration');
}
/** @param {(request: Request) => Response | Promise<Response>} handler */
export function serveValidated(handler) {
  Deno.serve(async request => {
    const callerOrigin = request.headers.get('origin');
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Vary': 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json'
    };
    const deny = (status) => new Response(JSON.stringify({error: status === 403 ? 'forbidden' : 'unauthorized'}), {status,headers});
    if (callerOrigin && callerOrigin !== origin) return deny(403);
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (request.method !== 'POST') return new Response(null,{status:405,headers});
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return deny(401);
    try {
      const checked = await fetch(url+'/auth/v1/user', {
        headers: {Authorization:authorization,apikey:key}, signal:AbortSignal.timeout(8000)
      });
      if (!checked.ok || !(await checked.json()).id) return deny(401);
      const response = await handler(request);
      const updated = new Headers(response.headers);
      for (const [name,value] of Object.entries(headers)) updated.set(name,value);
      return new Response(response.body,{status:response.status,headers:updated});
    } catch {
      return new Response(JSON.stringify({error:'unavailable'}),{status:503,headers});
    }
  });
}

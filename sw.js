const CACHE='freya-travel-release-6444-v35';
const CACHE_FAMILY='freya-travel-release-6444-';
const ASSETS=['./domain/itinerary-route.mjs','./domain/itinerary-route-ui.mjs','./domain/itinerary-quick-place.mjs','./domain/itinerary-place-points.mjs','./domain/itinerary-place-points-ui.mjs','./vendor/supabase.js','./domain/place-resolution.mjs','./domain/place-resolution-ui.mjs','./domain/proposal-handoff.mjs','./domain/tb-confirmation.mjs','./domain/tb-budget.mjs','./domain/tb-build.mjs','./domain/travel-search.mjs','./domain/live-trip-brief.mjs','./domain/travel-builder.mjs','./domain/trip-brief.mjs','./domain/import-proposal.mjs','./domain/import-itinerary-proposal.mjs','./domain/import-itinerary-review.mjs','./domain/import-itinerary-write.mjs','./domain/travel-book-proposal.mjs','./domain/travel-book-batch.mjs','./domain/travel-book-editor-state.mjs','./domain/travel-book-composition.mjs','./domain/import-proposal.js','./domain/proposal-refinement.js','./domain/proposal-builder.js','./domain/live-trip-brief.js','./domain/travel-builder.js','./domain/trip-brief.js','./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./itinerary.html','./freya-travel-v1.5/index.html','./freya-travel-v1.5/itinerary.html'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(CACHE_FAMILY)&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
// A connected-but-stalled request or HTTP error must not hide a cached shell/SDK.
async function shellResponse(request,fallbackKey){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4000);
  try{
    const response=await fetch(request,{cache:'no-cache',signal:controller.signal});
    if(!response.ok)throw new Error('Shell unavailable');
    try{const cache=await caches.open(CACHE);await cache.put(fallbackKey,response.clone())}catch(_){}
    return response;
  }catch(error){
    const cache=await caches.open(CACHE),cached=await cache.match(fallbackKey,{ignoreSearch:true});
    if(cached)return cached;
    throw error;
  }finally{clearTimeout(timer)}
}
self.addEventListener('message',event=>{
  if(event.data?.type==='FREYA_BOOT_VERSION')event.ports?.[0]?.postMessage({cache:CACHE});
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const request=event.request;
  const url=new URL(request.url);
  const isSameOrigin=url.origin===self.location.origin;
  if(!isSameOrigin||!url.pathname.startsWith(new URL('./',self.location.href).pathname))return;
  const isNavigation=request.mode==='navigate'||request.destination==='document';
  const isIndexRequest=isSameOrigin && (url.pathname.endsWith('/index.html') || url.pathname === '/' || url.pathname === '/freya-travel/' || url.pathname === '/freya-travel');
  if(isNavigation || isIndexRequest){
    const rootItineraryPath=new URL('./itinerary.html',self.location.href).pathname;
    const nestedIndexPath=new URL('./freya-travel-v1.5/index.html',self.location.href).pathname;
    const nestedAppPath=new URL('./freya-travel-v1.5/',self.location.href).pathname;
    const nestedItineraryPath=new URL('./freya-travel-v1.5/itinerary.html',self.location.href).pathname;
    const isNestedIndex=url.pathname===nestedIndexPath||url.pathname===nestedAppPath||url.pathname===nestedAppPath.slice(0,-1);
    const fallbackKey=url.pathname===rootItineraryPath?'./itinerary.html':url.pathname===nestedItineraryPath?'./freya-travel-v1.5/itinerary.html':isNestedIndex?'./freya-travel-v1.5/index.html':'./index.html';
    event.respondWith(shellResponse(request,fallbackKey));
    return;
  }
  const isCodeAsset=['script','worker','sharedworker'].includes(request.destination)||/\.(?:m?js|css)$/i.test(url.pathname);
  if(isCodeAsset){
    event.respondWith(shellResponse(request,request));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(request,copy));
    return response;
  })).catch(()=>undefined));
});

const APP_ROOT=new URL('./',self.location.href);
function safeAppUrl(value){
  try{
    const url=new URL(value||APP_ROOT.href,APP_ROOT.href);
    return url.origin===self.location.origin&&url.pathname.startsWith(APP_ROOT.pathname)?url.href:APP_ROOT.href;
  }catch(_){return APP_ROOT.href}
}

self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?event.data.json():{}}catch(_){payload={body:event.data?.text()||''}}
  const notification=payload.notification&&typeof payload.notification==='object'?payload.notification:payload;
  const url=safeAppUrl(notification.navigate||payload.url||payload.data?.url);
  const title=typeof notification.title==='string'&&notification.title.trim()?notification.title:'Freya Travel';
  const body=typeof notification.body==='string'&&notification.body.trim()?notification.body:'Tens una nova notificació de Freya Travel.';
  event.waitUntil(self.registration.showNotification(title,{body,icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',data:{url}}));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=safeAppUrl(event.notification.data?.url);
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windowClients=>{
    for(const client of windowClients){
      try{
        const current=new URL(client.url);
        if(current.origin!==self.location.origin||!current.pathname.startsWith(APP_ROOT.pathname))continue;
        if('navigate' in client)await client.navigate(url);
        return client.focus();
      }catch(_){ }
    }
    return self.clients.openWindow(url);
  }));
});

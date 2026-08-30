const CACHE='freya-travel-v6.4.9-activity-deeplinks';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./itinerary.html','./freya-travel-v1.5/itinerary.html'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const request=event.request;
  const url=new URL(request.url);
  const isSameOrigin=url.origin===self.location.origin;
  if(!isSameOrigin)return;
  const isNavigation=request.mode==='navigate'||request.destination==='document';
  const isIndexRequest=isSameOrigin && (url.pathname.endsWith('/index.html') || url.pathname === '/' || url.pathname === '/freya-travel/' || url.pathname === '/freya-travel');
  if(isNavigation || isIndexRequest){
    const rootItineraryPath=new URL('./itinerary.html',self.location.href).pathname;
    const nestedItineraryPath=new URL('./freya-travel-v1.5/itinerary.html',self.location.href).pathname;
    const fallbackKey=url.pathname===rootItineraryPath?'./itinerary.html':url.pathname===nestedItineraryPath?'./freya-travel-v1.5/itinerary.html':'./index.html';
    event.respondWith(fetch(request).then(response=>{
      if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(fallbackKey,copy))}
      return response;
    }).catch(()=>caches.match(fallbackKey).then(cached=>cached||caches.match('./'))));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(request,copy));
    return response;
  })).catch(()=>undefined));
});

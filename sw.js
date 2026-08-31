const CACHE='freya-travel-v6.4.12-vapid-v2';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./itinerary.html','./freya-travel-v1.5/index.html','./freya-travel-v1.5/itinerary.html'];
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
    const nestedIndexPath=new URL('./freya-travel-v1.5/index.html',self.location.href).pathname;
    const nestedAppPath=new URL('./freya-travel-v1.5/',self.location.href).pathname;
    const nestedItineraryPath=new URL('./freya-travel-v1.5/itinerary.html',self.location.href).pathname;
    const isNestedIndex=url.pathname===nestedIndexPath||url.pathname===nestedAppPath||url.pathname===nestedAppPath.slice(0,-1);
    const fallbackKey=url.pathname===rootItineraryPath?'./itinerary.html':url.pathname===nestedItineraryPath?'./freya-travel-v1.5/itinerary.html':isNestedIndex?'./freya-travel-v1.5/index.html':'./index.html';
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

const LEGACY_CACHE='freya-travel-v1.5';

self.addEventListener('install',event=>{
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.delete(LEGACY_CACHE)
      .then(()=>self.registration.unregister())
  );
});

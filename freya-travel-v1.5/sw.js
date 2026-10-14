// Retire only this compatibility worker; preserve all local caches and drafts.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.registration.unregister()));

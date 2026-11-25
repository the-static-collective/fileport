// Deliberately no Cache Storage, offline API replay, background sync or fetch proxy.
import {isShareNavigation,shareResponse} from "./share-draft.js";
self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("fetch",event=>{
 if(isShareNavigation(event.request,self.location.origin))event.respondWith(shareResponse(event.request));
});

/* SimRun offline cache.
   The application shell is precached from the manifest generated at build time,
   so the app opens without a network after one visit. Basemap resources are
   stored as they are viewed and served cache-first within a bounded entry count.
   Routing, elevation and search are never cached: they always use the network. */
const MAP_CACHE='simrun-map-v1';
const MAP_HOST='tiles.openfreemap.org';
const MAP_LIMIT=1500;
const digest=text=>{let hash=5381;for(let i=0;i<text.length;i++)hash=((hash<<5)+hash+text.charCodeAt(i))>>>0;return hash.toString(36);};
const shellCacheName=files=>`simrun-shell-${digest([...files].sort().join('|'))}`;
const shellName=async()=>(await caches.keys()).find(name=>name.startsWith('simrun-shell-'))||null;
const manifestFiles=async()=>{
 try{const response=await fetch('./sw-manifest.json',{cache:'no-store'});return response.ok?(await response.json()).files||[]:null;}catch{return null;}
};
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const files=await manifestFiles();
  if(files&&files.length){
   const cache=await caches.open(shellCacheName(files));
   await Promise.all(files.map(async path=>{
    try{const response=await fetch(path,{cache:'reload'});if(response.ok)await cache.put(path,response);}catch{}
   }));
  }
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const files=await manifestFiles();
  // Only prune when the manifest is readable, so an offline update cannot drop a usable cache.
  if(files&&files.length){
   const keep=new Set([shellCacheName(files),MAP_CACHE]);
   for(const name of await caches.keys())if((name.startsWith('simrun-shell-')||name.startsWith('simrun-map-'))&&!keep.has(name))await caches.delete(name);
  }
  await self.clients.claim();
 })());
});
const trim=async cache=>{const keys=await cache.keys();if(keys.length<=MAP_LIMIT)return;for(const key of keys.slice(0,keys.length-MAP_LIMIT))await cache.delete(key);};
async function navigation(request){
 const name=await shellName();
 if(name){const cached=await (await caches.open(name)).match('index.html');if(cached)return cached;}
 try{return await fetch(request);}catch{return new Response('SimRun is offline and its app shell is not cached on this device yet.',{status:503,headers:{'Content-Type':'text/plain'}});}
}
async function shell(request){
 const name=await shellName();
 if(!name)return fetch(request);
 const cache=await caches.open(name);
 const cached=await cache.match(request,{ignoreSearch:true});
 if(cached)return cached;
 try{const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;}catch{return new Response('',{status:503});}
}
async function basemap(request){
 const cache=await caches.open(MAP_CACHE);
 const cached=await cache.match(request);
 if(cached)return cached;
 try{const response=await fetch(request);if(response.ok){await cache.put(request,response.clone());await trim(cache);}return response;}catch{return Response.error();}
}
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 let url;
 try{url=new URL(request.url);}catch{return;}
 if(url.origin===self.location.origin){
  if(url.pathname.endsWith('/sw.js')||url.pathname.endsWith('/sw-manifest.json'))return;
  event.respondWith(request.mode==='navigate'?navigation(request):shell(request));
  return;
 }
 if(url.hostname===MAP_HOST)event.respondWith(basemap(request));
});
self.addEventListener('message',event=>{
 const port=event.ports&&event.ports[0],data=event.data||{};
 if(!port)return;
 if(data.type==='simrun-cache-status'){
  event.waitUntil((async()=>{
   const name=await shellName();
   const shellCount=name?(await (await caches.open(name)).keys()).length:0;
   port.postMessage({shell:shellCount,map:(await (await caches.open(MAP_CACHE)).keys()).length,limit:MAP_LIMIT});
  })());
 }else if(data.type==='simrun-clear-map'){
  event.waitUntil((async()=>{await caches.delete(MAP_CACHE);port.postMessage({cleared:true});})());
 }
});

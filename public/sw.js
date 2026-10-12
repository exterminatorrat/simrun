/* SimRun offline cache.
   The application shell is precached from the manifest generated at build time,
   so the app opens without a network after one visit. Basemap resources are
   stored as they are viewed and served cache-first within a bounded entry count.
   Routing, elevation and search are never cached: they always use the network. */
const MAP_CACHE='simrun-map-v1';
// Route-corridor tiles live in their own cache and are never trimmed by ordinary browsing.
const CORRIDOR_CACHE='simrun-corridor-v1';
const MAP_HOSTS=new Set(['tiles.openfreemap.org','tile.waymarkedtrails.org']);
const CORRIDOR_INDEX=new URL('__simrun-corridor-index__.json',self.location.href).href;
const MAP_LIMIT=1500;
const CORRIDOR_LIMIT=100;
const CORRIDOR_TILE_LIMIT=600;
const activeCorridorDownloads=new Map();
// Only the worker script itself is left to the network; the application's own
// compiled src/sw.js module is part of the shell and must be served from cache.
const WORKER_PATH=new URL('sw.js',self.location.href).pathname;
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
 const corridor=await caches.open(CORRIDOR_CACHE);
 const stored=await corridor.match(request);
 if(stored)return stored;
 const cache=await caches.open(MAP_CACHE);
 const cached=await cache.match(request);
 if(cached)return cached;
 try{const response=await fetch(request);if(response.ok){await cache.put(request,response.clone());await trim(cache);}return response;}catch{return Response.error();}
}
const mapTileHost=hostname=>MAP_HOSTS.has(hostname)||hostname.endsWith('.tile.opentopomap.org');
const safePost=(port,data)=>{try{port.postMessage(data);}catch{}};
async function readCorridors(cache){
 const response=await cache.match(CORRIDOR_INDEX);
 if(!response)return [];
 try{const rows=await response.json();return Array.isArray(rows)?rows:[];}catch{return [];}
}
async function writeCorridors(cache,rows){await cache.put(CORRIDOR_INDEX,new Response(JSON.stringify(rows),{headers:{'Content-Type':'application/json'}}));}
async function cacheBytes(cache,skipIndex=false){
 let bytes=0;
 for(const request of await cache.keys()){
  if(skipIndex&&request.url===CORRIDOR_INDEX)continue;
  const response=await cache.match(request);if(!response)continue;
  const length=Number(response.headers.get('content-length'));
  bytes+=Number.isFinite(length)&&length>0?length:(await response.clone().arrayBuffer()).byteLength;
 }
 return bytes;
}
async function corridorCacheStatus(cache){
 const records=await readCorridors(cache);
 return records.map(({id,name,bounds,tileCount,estimatedBytes,createdAt})=>({id,name,bounds,tileCount,estimatedBytes,createdAt}));
}
async function corridorOnly(request){
 const cache=await caches.open(CORRIDOR_CACHE);
 const cached=await cache.match(request);
 if(cached)return cached;
 try{return await fetch(request);}catch{return Response.error();}
}
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 let url;
 try{url=new URL(request.url);}catch{return;}
 if(url.origin===self.location.origin){
  if(url.pathname===WORKER_PATH||url.pathname.endsWith('/sw-manifest.json'))return;
  event.respondWith(request.mode==='navigate'?navigation(request):shell(request));
  return;
 }
 if(mapTileHost(url.hostname))event.respondWith(basemap(request));
 else event.respondWith(corridorOnly(request));
});
self.addEventListener('message',event=>{
 const port=event.ports&&event.ports[0],data=event.data||{};
 if(!port)return;
 if(data.type==='simrun-cache-status'){
  event.waitUntil((async()=>{
   const name=await shellName(),mapCache=await caches.open(MAP_CACHE),corridorCache=await caches.open(CORRIDOR_CACHE);
   const shellCount=name?(await (await caches.open(name)).keys()).length:0,mapCount=(await mapCache.keys()).length+(await corridorCache.keys()).filter(request=>request.url!==CORRIDOR_INDEX).length;
   const bytes=await cacheBytes(mapCache)+await cacheBytes(corridorCache,true);
   safePost(port,{shell:shellCount,map:mapCount,limit:MAP_LIMIT,bytes,corridors:await corridorCacheStatus(corridorCache)});
  })());
 }else if(data.type==='simrun-clear-map'){
  event.waitUntil((async()=>{await caches.delete(MAP_CACHE);await caches.delete(CORRIDOR_CACHE);safePost(port,{cleared:true});})());
 }else if(data.type==='simrun-corridor-delete'){
  event.waitUntil((async()=>{
   const cache=await caches.open(CORRIDOR_CACHE),records=await readCorridors(cache),removed=records.filter(record=>record.id===data.id),remaining=records.filter(record=>record.id!==data.id),retained=new Set(remaining.flatMap(record=>Array.isArray(record.urls)?record.urls:[]));
   for(const record of removed)for(const url of Array.isArray(record.urls)?record.urls:[])if(!retained.has(url))await cache.delete(url);
   await writeCorridors(cache,remaining);safePost(port,{deleted:removed.length>0});
  })());
 }else if(data.type==='simrun-corridor-cancel'){
  const controller=activeCorridorDownloads.get(data.id);
  if(controller)controller.abort();safePost(port,{cancelled:!!controller});
 }else if(data.type==='simrun-corridor-download'){
  event.waitUntil((async()=>{
   const raw=Array.isArray(data.urls)?data.urls.slice(0,CORRIDOR_TILE_LIMIT):[],urls=[...new Set(raw.filter(url=>typeof url==='string'&&url.startsWith('https://')))],info=data.record;
   if(!info||typeof info.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(info.id)||typeof info.name!=='string'||!info.bounds){safePost(port,{type:'complete',result:{stored:0,failed:raw.length,bytes:0,cancelled:false,quota:false}});return;}
   const controller=new AbortController(),id=info.id;activeCorridorDownloads.set(id,controller);
   const cache=await caches.open(CORRIDOR_CACHE),storedUrls=[];let stored=0,failed=0,bytes=0,quota=false,cancelled=false;
   for(let index=0;index<urls.length;index++){
    if(controller.signal.aborted){cancelled=true;break;}
    const url=urls[index];
    try{
     const existing=await cache.match(url);
     if(existing){bytes+=(await existing.clone().arrayBuffer()).byteLength;stored++;storedUrls.push(url);}
     else {
      const response=await fetch(url,{mode:'cors',signal:controller.signal});
      if(response.ok){const size=(await response.clone().arrayBuffer()).byteLength;await cache.put(url,response);bytes+=size;stored++;storedUrls.push(url);}else failed++;
     }
    }catch(error){
     failed++;
     if(controller.signal.aborted){cancelled=true;}
     else if(error&&typeof error==='object'&&'name' in error&&error.name==='QuotaExceededError')quota=true;
    }
    safePost(port,{type:'progress',progress:{done:index+1,total:urls.length,stored,failed,bytes,quota}});
    if(cancelled||quota)break;
   }
   if(storedUrls.length){
    const records=await readCorridors(cache),record={id,name:info.name.slice(0,80),bounds:info.bounds,tileCount:storedUrls.length,estimatedBytes:bytes,createdAt:typeof info.createdAt==='number'?info.createdAt:Date.now(),urls:storedUrls};
    const combined=[...records.filter(item=>item.id!==id),record],trimmed=combined.slice(-CORRIDOR_LIMIT),retained=new Set(trimmed.flatMap(item=>Array.isArray(item.urls)?item.urls:[]));
    for(const item of combined.slice(0,-CORRIDOR_LIMIT))for(const url of Array.isArray(item.urls)?item.urls:[])if(!retained.has(url))await cache.delete(url);
    await writeCorridors(cache,trimmed);
   }
   activeCorridorDownloads.delete(id);safePost(port,{type:'complete',result:{stored,failed,bytes,cancelled,quota}});
  })());
 }
});

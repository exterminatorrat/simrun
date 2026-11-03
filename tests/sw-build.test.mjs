import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function navigationFor(pathname,entries){
 const source=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
 const handlers={},store=new Map(Object.entries(entries).map(([key,body])=>[key,new Response(body)]));
 const cache={match:async (key)=>store.get(String(key))?.clone(),put:async (key,value)=>{store.set(String(key),value);},keys:async ()=>[...store.keys()]};
 const context={
  self:{location:{origin:'https://simrun.test',href:'https://simrun.test/sw.js'},addEventListener:(type,fn)=>{handlers[type]=fn;},skipWaiting:()=>{},clients:{claim:()=>{}}},
  caches:{open:async ()=>cache,keys:async ()=>['simrun-shell-test'],delete:async ()=>{}},
  fetch:async ()=>new Response('network'),
  Response,Request,URL,console,setTimeout,clearTimeout
 };
 context.self.self=context.self;
 vm.runInNewContext(source,context);
 let pending=null;
 handlers.fetch({request:{method:'GET',url:`https://simrun.test${pathname}`,mode:'navigate'},respondWith:value=>{pending=value;}});
 assert.ok(pending,'the worker must answer same-origin navigations');
 const response=await pending;
 return {status:response.status,body:await response.text()};
}

test('the built service worker carries a content build id',async()=>{
 const sw=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
 assert.doesNotMatch(sw,/__SIMRUN_BUILD__/,'the placeholder must be replaced during the build');
 assert.match(sw,/const BUILD='[0-9a-f]{16}'/,'the build id is a content hash');
 assert.match(sw,/simrun-shell-\$\{BUILD\}-/,'the shell cache name must include the build id');
});

test('a navigation serves its own cached document, not always the app shell',async()=>{
 const about=await navigationFor('/about.html',{'index.html':'APP SHELL','about.html':'ABOUT PAGE'});
 assert.equal(about.body,'ABOUT PAGE');
 const privacy=await navigationFor('/privacy.html',{'index.html':'APP SHELL','privacy.html':'PRIVACY PAGE'});
 assert.equal(privacy.body,'PRIVACY PAGE');
});

test('the root and unknown routes fall back to the cached app shell',async()=>{
 const root=await navigationFor('/',{'index.html':'APP SHELL','about.html':'ABOUT PAGE'});
 assert.equal(root.body,'APP SHELL');
 const deep=await navigationFor('/no/such/page',{'index.html':'APP SHELL'});
 assert.equal(deep.body,'APP SHELL');
});

test('a query string does not hide the cached document',async()=>{
 const about=await navigationFor('/about.html?from=settings',{'index.html':'APP SHELL','about.html':'ABOUT PAGE'});
 assert.equal(about.body,'ABOUT PAGE');
});

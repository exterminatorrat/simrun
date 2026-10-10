import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=name=>readFile(new URL(`../dist/${name}`,import.meta.url),'utf8');
test('the build emits a precache manifest covering the app shell',async()=>{
 const {files}=JSON.parse(await read('sw-manifest.json'));
 for(const required of ['index.html','app.css','favicon.png','src/main.js','src/map.js','src/sw.js','vendor/maplibre-gl-csp.js','vendor/maplibre-gl-csp-worker.js','vendor/maplibre-gl.css'])assert.ok(files.includes(required),`manifest is missing ${required}`);
 assert.ok(!files.includes('sw.js')&&!files.includes('sw-manifest.json'));
 assert.equal(new Set(files).size,files.length);
});
test('the service worker caches the shell and only viewed basemap resources',async()=>{
 const worker=await read('sw.js');
 assert.match(worker,/tiles\.openfreemap\.org/);
 assert.match(worker,/simrun-map-v1/);
 assert.match(worker,/self\.addEventListener\('fetch'/);
 assert.match(worker,/request\.mode==='navigate'/);
 // The application's own compiled src/sw.js must be cached, so the worker may
 // only skip its own script path and must not match every path ending in sw.js.
 assert.match(worker,/url\.pathname===WORKER_PATH/);
 assert.ok(!/endsWith\('\/sw\.js'\)/.test(worker));
 assert.match(worker,/tile\.waymarkedtrails\.org/);
 assert.match(worker,/endsWith\('\.tile\.opentopomap\.org'\)/);
 assert.match(worker,/await trim\(cache\)/);
 assert.match(worker,/if\(mapTileHost\(url\.hostname\)\)event\.respondWith\(basemap\(request\)\)/);
 assert.match(worker,/simrun-corridor-delete/);
 assert.match(worker,/simrun-corridor-cancel/);
});
test('offline registration is a no-op without service worker support',async()=>{
 const {registerOfflineCache,offlineSupported,offlineStatus}=await import('../dist/src/sw.js');
 const supported=offlineSupported();
 assert.equal(typeof supported,'boolean');
 assert.doesNotThrow(()=>registerOfflineCache());
 if(!supported)assert.equal(await offlineStatus(),null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {lon2tile,lat2tile,tileRange,corridorTiles,corridorTileCount} from '../dist/src/offline.js';

const path=[{lat:0,lon:0},{lat:0.02,lon:0.03},{lat:0.04,lon:0.05}];

test('lon2tile and lat2tile hit slippy-map anchors',()=>{
 for(const z of [1,5,10,17]) {
  assert.equal(lon2tile(0,z),2**(z-1));
  assert.equal(lat2tile(0,z),2**(z-1));
  assert.equal(lat2tile(85.0511287798066,z),0);
  assert.equal(lat2tile(89,z),0);
  assert.equal(lon2tile(180,z),2**z-1);
  assert.equal(lon2tile(-180,z),0);
 }
});
test('tileRange covers a box inclusively',()=>{
 assert.deepEqual(tileRange({minLat:-0.001,maxLat:-0.0001,minLon:0.001,maxLon:0.002},2),{x0:2,x1:2,y0:2,y1:2});
});
test('a wider buffer grows the covering tile range and count',()=>{
 const raw=corridorTileCount(path,0,14),wide=corridorTileCount(path,1000,14);
 assert.ok(wide>raw);
});
test('corridorTiles is deterministic, unique, row-major, and counts the full cover',()=>{
 const a=corridorTiles(path,1000,13,100000),b=corridorTiles(path,1000,13,100000);
 assert.deepEqual(a,b);
 assert.equal(a.capped,false);
 assert.equal(a.tiles.length,a.count);
 assert.equal(new Set(a.tiles.map(t=>`${t.x}/${t.y}/${t.z}`)).size,a.tiles.length);
 const pos=a.tiles.map(t=>[t.y,t.x]);
 assert.deepEqual(pos,[...pos].sort((p,q)=>p[0]-q[0]||p[1]-q[1]));
 const xs=a.tiles.map(t=>t.x),ys=a.tiles.map(t=>t.y);
 assert.equal(a.count,(Math.max(...xs)-Math.min(...xs)+1)*(Math.max(...ys)-Math.min(...ys)+1));
 assert.ok(a.tiles.every(t=>t.z===13));
});
test('a small maxTiles caps the list but preserves the full count',()=>{
 const full=corridorTiles(path,1000,13,100000),capped=corridorTiles(path,1000,13,3);
 assert.equal(capped.capped,true);
 assert.equal(capped.tiles.length,3);
 assert.equal(capped.count,full.count);
 assert.deepEqual(capped.tiles,full.tiles.slice(0,3));
});
test('zoom 0 collapses the world to a single tile',()=>{
 assert.deepEqual(tileRange({minLat:-85.0511287798066,maxLat:85.0511287798066,minLon:-180,maxLon:180},0),{x0:0,x1:0,y0:0,y1:0});
});
test('invalid corridor inputs throw',()=>{
 assert.throws(()=>corridorTiles([],100,10,100));
 assert.throws(()=>corridorTiles(path,100,0,100));
 assert.throws(()=>corridorTiles(path,100,-1,100));
 assert.throws(()=>corridorTiles(path,100,23,100));
 assert.throws(()=>corridorTileCount(path,100,0));
});
test('a long route at a high zoom is capped',()=>{
 const long=[{lat:0,lon:0},{lat:0.01,lon:0.9}];
 const r=corridorTiles(long,200,20,50);
 assert.equal(r.capped,true);
 assert.equal(r.tiles.length,50);
 assert.ok(r.count>50);
 assert.equal(corridorTileCount(long,200,20),r.count);
});

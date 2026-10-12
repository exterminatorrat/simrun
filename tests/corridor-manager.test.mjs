import test from 'node:test';
import assert from 'node:assert/strict';
import {corridorBounds,removeCorridorRecord,upsertCorridorRecord,validateCorridorRecords} from '../dist/src/offline.js';

const bounds={minLat:46,maxLat:47,minLon:8,maxLon:9};
const record=(id,urls)=>({id,name:`Route ${id}`,bounds,tileCount:urls.length,estimatedBytes:1024,createdAt:100,urls});

test('corridor bounds include the route buffer and remain valid coordinates',()=>{
 const box=corridorBounds([{lat:46.5,lon:8.5},{lat:46.6,lon:8.6}],1000);
 assert.ok(box.minLat<46.5&&box.maxLat>46.6&&box.minLon<8.5&&box.maxLon>8.6);
});

test('corridor records validate, replace by id, and preserve shared tiles on delete',()=>{
 const first=record('first',['https://tiles.example/a','https://tiles.example/shared']);
 const second=record('second',['https://tiles.example/shared','https://tiles.example/b']);
 assert.equal(validateCorridorRecords([first,{...first,id:'invalid',urls:['http://bad.example/tile']}]).length,1);
 const updated=upsertCorridorRecord([first],{...first,name:'Renamed'});
 assert.equal(updated.length,1);assert.equal(updated[0].name,'Renamed');
 const removed=removeCorridorRecord([first,second],'first');
 assert.deepEqual(removed.records.map(item=>item.id),['second']);
 assert.deepEqual(removed.orphanedUrls,['https://tiles.example/a']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,startTime} from '../dist/src/model.js';
import {generateBatch,MAX_BATCH_VARIANTS} from '../dist/src/batch.js';

function activity(sport='run') {
 const a=defaults();a.path=[{lat:0,lon:0,ele:0},{lat:0,lon:.045,ele:0}];a.waypoints=a.path;a.source='routed';
 a.settings={...a.settings,sport,start:'2024-01-02T03:04',utcOffset:0,seed:1202,pace:300,speed:24};
 return a;
}

test('batch variants are deterministic, seeded, offset, and do not mutate their input',()=>{
 const source=activity(),before=JSON.stringify(source),batch=generateBatch(source,5),again=generateBatch(source,5);
 assert.deepEqual(batch,again);
 assert.equal(JSON.stringify(source),before);
 assert.equal(batch.length,5);
 assert.equal(new Set(batch.map(item=>item.id)).size,5);
 assert.equal(new Set(batch.map(item=>item.settings.seed)).size,5);
 assert.deepEqual(batch.map(item=>startTime(item.settings)-startTime(source.settings)),[0,900000,1800000,2700000,3600000]);
 for(const item of batch){assert.ok(Math.abs(item.settings.pace/source.settings.pace-1)<=.020001);assert.ok(item.settings.seed!==source.settings.seed);}
});

test('cycling batch changes speed and scales per-segment targets consistently',()=>{
 const source=activity('ride');source.settings={...source.settings,paceStrategy:'segments',paceSegments:[20,24,28]};
 const batch=generateBatch(source,3);
 assert.ok(batch.every(item=>Math.abs(item.settings.speed/source.settings.speed-1)<=.020001));
 assert.ok(batch.every(item=>item.settings.paceSegments.every((value,index)=>Math.abs(value/source.settings.paceSegments[index]-1)<=.020001)));
 assert.ok(batch.every(item=>item.settings.paceStrategy==='segments'));
});

test('batch generation enforces the variant and spacing caps',()=>{
 const source=activity();
 assert.equal(MAX_BATCH_VARIANTS,20);
 assert.throws(()=>generateBatch(source,0));
 assert.throws(()=>generateBatch(source,21));
 assert.throws(()=>generateBatch(source,2,0));
 assert.throws(()=>generateBatch(source,2,1441));
});

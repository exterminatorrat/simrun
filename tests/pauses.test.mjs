import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults, simulate, computeSplits, validateActivity} from '../dist/src/model.js';
import {exportGPX} from '../dist/src/gpx.js';

const path=[{lon:0,lat:0,ele:0},{lon:0.045,lat:0,ele:0}];
const base=()=>{const a=defaults();a.path=path;a.source='routed';a.settings.seed=7;return a;};

test('rest stops add elapsed time while moving time excludes them',()=>{
 const moving=simulate(base());
 const a=base();a.pauses={rests:[{distance:2500,seconds:120}]};
 const s=simulate(a);
 assert.ok(Math.abs(s.duration-(moving.duration+120))<.01);
 assert.equal(s.distance,moving.distance);
 assert.ok(s.points.every((p,i)=>i===0||p.time>s.points[i-1].time));
});

test('rest stops emit co-located zero-speed brackets at the stop distance',()=>{
 const a=base();a.pauses={rests:[{distance:2500,seconds:90}]};
 const s=simulate(a);
 const stops=s.points.filter(p=>p.speed===0);
 assert.equal(stops.length,2);
 assert.ok(Math.abs(stops[0].distance-2500)<1);
 assert.equal(stops[1].time-stops[0].time,90000);
 assert.ok(Math.abs(stops[1].distance-stops[0].distance)<1e-9);
});

test('splits report stopped time without adding stop boundaries',()=>{
 const a=base();a.pauses={rests:[{distance:2500,seconds:120}]};a.splits={auto:1000,markers:[]};
 const s=simulate(a),splits=computeSplits(a,s);
 const hit=splits.find(sp=>sp.start<2500&&sp.end>=2500);
 assert.equal(hit.stopped,true);
 assert.ok(splits.filter(sp=>sp.stopped).length===1);
 assert.ok(Math.abs(splits.reduce((n,sp)=>n+sp.duration,0)-s.duration)<.5);
});

test('rest stops round-trip through validation and reject bad values',()=>{
 const a=base();a.pauses={rests:[{distance:2500,seconds:120}]};
 assert.deepEqual(validateActivity(a).pauses,{rests:[{distance:2500,seconds:120}]});
 assert.equal(validateActivity({...a,pauses:undefined}).pauses,undefined);
 for(const pauses of [{rests:[{distance:0,seconds:0}]},{rests:[{distance:100,seconds:-5}]},{rests:'x'}])assert.throws(()=>validateActivity({...a,pauses}));
});

test('GPX notes simulated rest stops',()=>{
 const a=base();a.pauses={rests:[{distance:2500,seconds:120}]};
 assert.match(exportGPX(a,simulate(a)),/simulated rest stops/);
});

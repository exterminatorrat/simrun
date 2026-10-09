import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults, simulate, splitBoundaries, computeSplits} from '../dist/src/model.js';
import {exportGPX} from '../dist/src/gpx.js';

const path=[{lon:0,lat:0,ele:0},{lon:0.045,lat:0,ele:0}];
const base=()=>{const a=defaults();a.path=path;a.source='routed';return a;};

test('workout steps drive per-step speed and total duration',()=>{
 const a=base();a.workout={steps:[{kind:'work',distance:2500,pace:300},{kind:'work',distance:2503.78,pace:240}]};
 const s=simulate(a);
 assert.ok(Math.abs(s.duration-(2.5*300+2.50378*240))<1);
 const first=s.points.filter(p=>p.distance<2000),second=s.points.filter(p=>p.distance>3000);
 const mean=rows=>rows.reduce((n,p)=>n+p.speed,0)/rows.length;
 assert.ok(mean(second)>mean(first)*1.15);
});

test('workout step boundaries become split boundaries',()=>{
 const a=base();a.workout={steps:[{kind:'work',distance:2500,pace:300},{kind:'work',distance:2503.78,pace:240}]};
 const s=simulate(a);
 const bounds=splitBoundaries(a,s.distance);
 assert.ok(bounds.some(v=>Math.abs(v-2500)<1));
 assert.equal(computeSplits(a,s).length,2);
});

test('a workout that mismatches the route by more than 0.5% is scaled',()=>{
 const a=base();a.workout={steps:[{kind:'work',distance:4000,pace:300},{kind:'work',distance:4000,pace:300}]};
 const s=simulate(a);
 assert.ok(Math.abs(s.distance-5003.78)<1);
 assert.ok(s.duration>0);
});

test('GPX notes structured workout steps',()=>{
 const a=base();a.workout={steps:[{kind:'work',distance:5003.78,pace:300}]};
 assert.match(exportGPX(a,simulate(a)),/structured workout steps/);
});

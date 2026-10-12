import test from 'node:test';
import assert from 'node:assert/strict';
import {generateRoundTrip,roundTripWaypoints} from '../dist/src/roundtrip.js';
import {distance} from '../dist/src/geometry.js';

const start={lat:0,lon:0};
const routeAt=(point,meters)=>{const mid={lat:point.lat+meters/2/111320,lon:point.lon};return [point,mid,point];};

test('round trips converge with deterministic closed candidate waypoints and no more than four provider calls',async()=>{
 const first=roundTripWaypoints(start,5000,25,17),same=roundTripWaypoints(start,5000,25,17),other=roundTripWaypoints(start,5000,25,18);
 assert.deepEqual(first,same);assert.notDeepEqual(first,other);assert.deepEqual(first[0],first.at(-1));
 let calls=0;const profiles=[];const router={async route(points,profile){calls++;profiles.push(profile);const perimeter=points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0),factor=calls===1?1.3:1;return routeAt(points[0],perimeter*factor);}};
 const result=await generateRoundTrip(router,start,5000,25,17,'road',new AbortController().signal);
 assert.equal(result.withinTolerance,true);assert.ok(result.calls>=2&&result.calls<=4);assert.equal(calls,result.calls);assert.ok(Math.abs(result.achievedMeters-5000)<=result.toleranceMeters);assert.ok(profiles.every(profile=>profile==='road'));
});

test('round-trip result reports the closest real route after four misses',async()=>{
 let calls=0;const router={async route(points){calls++;return routeAt(points[0],1150);}};
 const result=await generateRoundTrip(router,start,1000,0,4,'walk',new AbortController().signal,25);
 assert.equal(calls,4);assert.equal(result.calls,4);assert.equal(result.withinTolerance,false);assert.ok(Math.abs(result.achievedMeters-1150)<2);assert.equal(result.toleranceMeters,25);
});

test('provider failure and cancellation never produce a straight-line route',async()=>{
 let calls=0;const failure=new Error('road network unavailable');
 await assert.rejects(generateRoundTrip({async route(){calls++;throw failure;}},start,4000,0,1,'road',new AbortController().signal),/road network unavailable/);
 assert.equal(calls,1);
 const controller=new AbortController();controller.abort(new Error('cancelled'));
 await assert.rejects(generateRoundTrip({async route(){calls++;return routeAt(start,4000);}},start,4000,0,1,'road',controller.signal),/cancelled/);
 assert.equal(calls,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {cumulative,distance} from '../dist/src/geometry.js';
import {MAX_ROUTE_POINTS,MAX_ROUTE_WAYPOINTS,mergeRoutes,simplifyFreehand,simplifyRoute,splitRouteAtPoint,trimRouteBetweenWaypoints,trimRouteByDistance} from '../dist/src/routeops.js';

const a={lat:0,lon:0},b={lat:0,lon:.01},c={lat:0,lon:.02},d={lat:0,lon:.03};

test('trim by distance returns interpolated ends and preserves the requested geometry range',()=>{
 const path=[a,b,c],total=cumulative(path).at(-1),trimmed=trimRouteByDistance(path,total*.25,total*.75);
 assert.equal(trimmed.length,3);
 assert.ok(Math.abs(cumulative(trimmed).at(-1)-total*.5)<.01);
 assert.ok(Math.abs(trimmed[0].lon-.005)<1e-8);
 assert.ok(Math.abs(trimmed.at(-1).lon-.015)<1e-8);
});

test('trim by waypoint range follows their order along the route',()=>{
 const path=[a,b,c,d],trimmed=trimRouteBetweenWaypoints(path,b,c);
 assert.deepEqual(trimmed,[b,c]);
 assert.ok(Math.abs(cumulative(trimmed).at(-1)-distance(b,c))<.01);
});

test('split at a point shares the split coordinate and conserves route distance',()=>{
 const path=[a,b,c],total=cumulative(path).at(-1),[left,right]=splitRouteAtPoint(path,{lat:0,lon:.015});
 assert.equal(left.at(-1).lon,right[0].lon);
 assert.ok(Math.abs(cumulative(left).at(-1)+cumulative(right).at(-1)-total)<.01);
 assert.deepEqual(left[0],a);
 assert.deepEqual(right.at(-1),c);
});

test('merge requires a provider-routed connector for gaps and enforces the maximum gap',()=>{
 const first=[a,b],second=[c,d],connector=[b,{lat:.001,lon:.015},c];
 assert.throws(()=>mergeRoutes(first,second,{maxGapMeters:5000}),/Route the gap through the provider/);
 const merged=mergeRoutes(first,second,{maxGapMeters:5000,connector});
 assert.deepEqual(merged,[a,b,connector[1],c,d]);
 assert.throws(()=>mergeRoutes(first,second,{maxGapMeters:100}),/too far apart/);
 assert.throws(()=>mergeRoutes(first,second,{maxGapMeters:5000,connector:[a,b]}),/does not reach/);
});

test('merge joins touching routes without duplicating their shared point',()=>{
 const merged=mergeRoutes([a,b],[b,c],{maxGapMeters:0});
 assert.deepEqual(merged,[a,b,c]);
});

test('Douglas-Peucker simplification respects its tolerance and freehand waypoint limit',()=>{
 const straight=Array.from({length:12},(_,i)=>({lat:0,lon:i*.001}));
 assert.deepEqual(simplifyRoute(straight,1),[straight[0],straight.at(-1)]);
 const bend=[a,{lat:.00005,lon:.005},b];
 assert.equal(simplifyRoute(bend,2).length,3);
 assert.equal(simplifyRoute(bend,10).length,2);
 const zigzag=Array.from({length:60},(_,i)=>({lat:i%2?.0001:-.0001,lon:i*.0001}));
 assert.throws(()=>simplifyFreehand(zigzag,.1),/at most 50 points/);
 assert.equal(MAX_ROUTE_WAYPOINTS,50);
});

test('route operations reject invalid coordinates, ranges and point limits',()=>{
 assert.throws(()=>trimRouteByDistance([a,{lat:91,lon:1}],0,5),/invalid coordinate/);
 assert.throws(()=>trimRouteByDistance([a,b],-1,10),/range/);
 assert.throws(()=>splitRouteAtPoint([a,b],{lat:91,lon:0}),/invalid coordinate/);
 assert.throws(()=>simplifyRoute([a,b],0),/tolerance/);
 assert.throws(()=>mergeRoutes([a], [b,c], {maxGapMeters:100}),/at least two points/);
 assert.throws(()=>trimRouteByDistance(Array.from({length:MAX_ROUTE_POINTS+1},()=>a),0,1),/100,000 points/);
});

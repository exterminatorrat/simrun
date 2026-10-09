import test from 'node:test';
import assert from 'node:assert/strict';
import {importGeoJSON,importRouteFile,parseKmlCoordinates} from '../dist/src/import.js';
const feature=(coords,props={})=>({type:'Feature',properties:props,geometry:{type:'LineString',coordinates:coords}});
test('GeoJSON LineString import keeps geometry, elevation and ride inference',()=>{
 const r=importGeoJSON(JSON.stringify(feature([[121.47,31.23,15],[121.48,31.24,20]],{name:'Morning Ride'})));
 assert.equal(r.activity.source,'imported');assert.equal(r.activity.path.length,2);assert.equal(r.activity.name,'Morning Ride');assert.equal(r.activity.settings.sport,'ride');
 assert.equal(r.activity.path[0].ele,15);assert.match(r.notice,/resimulated/);assert.match(r.notice,/timestamps were missing/);
});
test('GeoJSON MultiLineString keeps the largest segment and announces the gap',()=>{
 const r=importGeoJSON(JSON.stringify({type:'FeatureCollection',features:[feature([[0,0],[0,.01]]),feature([[1,1],[1,1.01],[1,1.02]])]}));
 assert.equal(r.activity.path.length,3);assert.match(r.notice,/largest of 2 disjoint segments/);
});
test('GeoJSON accepts bare geometry and rejects non-routes',()=>{
 assert.equal(importGeoJSON(JSON.stringify({type:'LineString',coordinates:[[0,0],[0,.01]]})).activity.path.length,2);
 assert.throws(()=>importGeoJSON(JSON.stringify({type:'Point',coordinates:[0,0]})),/at least two points/);
 assert.throws(()=>importGeoJSON('not json'),/not valid GeoJSON/);
 assert.throws(()=>importGeoJSON(JSON.stringify(feature([[200,0],[0,0]]))),/invalid coordinates/);
});
test('route file dispatch uses the extension and sniffs unknown names',()=>{
 assert.equal(importRouteFile(JSON.stringify(feature([[0,0],[0,.01]])),'route.geojson').activity.source,'imported');
 assert.throws(()=>importRouteFile('mystery','route.txt'),/Unsupported route file/);
});
test('KML coordinate tuples parse lon,lat and optional altitude',()=>{
 const pts=parseKmlCoordinates('121.47,31.23,15\n 121.48,31.24,20 121.49,31.25');
 assert.equal(pts.length,3);assert.equal(pts[0].ele,15);assert.equal(pts[2].ele,undefined);assert.equal(pts[1].lat,31.24);
 assert.throws(()=>parseKmlCoordinates('999,0'),/invalid coordinates/);
});

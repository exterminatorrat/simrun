import test from 'node:test';
import assert from 'node:assert/strict';
import {routeGeoJSON,routeCSV} from '../dist/src/routeexport.js';
import {importGeoJSON} from '../dist/src/import.js';
import {defaults,validateActivity} from '../dist/src/model.js';
const route=()=>{
 const a=defaults();a.name='Loop, "quoted"';a.source='routed';
 a.path=[{lat:45.5,lon:-73.5,ele:10},{lat:45.51,lon:-73.49,ele:12}];
 a.waypoints=[{lat:45.5,lon:-73.5},{lat:45.505,lon:-73.495,name:'Water fountain',note:'Refill "bottles"'}];
 return a;
};
test('route GeoJSON is an RFC 7946 FeatureCollection of lon/lat geometry and named stops',()=>{
 const data=JSON.parse(routeGeoJSON(route()));
 assert.equal(data.type,'FeatureCollection');
 assert.equal(data.crs,undefined);
 const line=data.features[0];
 assert.equal(line.geometry.type,'LineString');
 assert.deepEqual(line.geometry.coordinates,[[-73.5,45.5,10],[-73.49,45.51,12]]);
 assert.equal(line.properties.name,'Loop, "quoted"');
 assert.equal(line.properties.sport,'run');
 assert.equal(line.properties.simulated,true);
 assert.ok(line.properties.distance_m>1300&&line.properties.distance_m<1500);
 assert.equal(data.features.length,2);
 const stop=data.features[1];
 assert.equal(stop.geometry.type,'Point');
 assert.deepEqual(stop.geometry.coordinates,[-73.495,45.505]);
 assert.equal(stop.properties.role,'stop');
 assert.equal(stop.properties.name,'Water fountain');
 assert.equal(stop.properties.note,'Refill "bottles"');
 assert.ok(stop.properties.distance_m>500&&stop.properties.distance_m<800);
});
test('route GeoJSON omits elevation unless every vertex has one',()=>{
 const a=route();delete a.path[1].ele;
 const line=JSON.parse(routeGeoJSON(a)).features[0];
 assert.deepEqual(line.geometry.coordinates[0].length,2);
});
test('route CSV is one row per vertex with explicit units and CRLF rows',()=>{
 const csv=routeCSV(route());
 assert.ok(csv.startsWith('seq,latitude,longitude,elevation_m,distance_m\r\n'));
 const rows=csv.trimEnd().split('\r\n');
 assert.equal(rows.length,3);
 assert.equal(rows[1],'1,45.500000,-73.500000,10.00,0.0');
 assert.match(rows[2],/^2,45\.510000,-73\.490000,12\.00,\d+\.\d$/);
 const flat=route();delete flat.path[0].ele;delete flat.path[1].ele;
 assert.equal(routeCSV(flat).split('\r\n')[1],'1,45.500000,-73.500000,,0.0');
});
test('unresolved drafts are never exported as route geometry',()=>{
 const a=route();a.source='draft';
 assert.throws(()=>routeGeoJSON(a),/Resolve the route/);
 assert.throws(()=>routeCSV(a),/Resolve the route/);
});
test('exported GeoJSON imports back with its stop names and notes',()=>{
 const source=route(),result=importGeoJSON(routeGeoJSON(source));
 assert.equal(result.activity.name,'Loop, "quoted"');
 assert.equal(result.activity.waypoints.length,1);
 assert.equal(result.activity.waypoints[0].name,'Water fountain');
 assert.equal(result.activity.waypoints[0].note,'Refill "bottles"');
 assert.ok(Math.abs(result.activity.waypoints[0].lat-45.505)<1e-6);
});
test('activity validation keeps stop text, strips control characters and drops blanks',()=>{
 const a=route();
 a.waypoints=[{lat:45.5,lon:-73.5,name:'  Water fountain  ',note:'Refill\u0000 bottles'},{lat:45.51,lon:-73.49,name:'   ',note:''}];
 const clean=validateActivity(structuredClone(a));
 assert.equal(clean.waypoints[0].name,'Water fountain');
 assert.equal(clean.waypoints[0].note,'Refill bottles');
 assert.equal(clean.waypoints[1].name,undefined);
 assert.equal(clean.waypoints[1].note,undefined);
});

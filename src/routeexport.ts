import type {Activity,Point,Waypoint} from './types.js';
import {cumulative,nearestOnPath} from './geometry.js';
import {plannedPath} from './model.js';
import {download,safeFilename} from './gpx.js';
import {csvRow} from './csv.js';
const round=(value:number,digits:number):number=>{const factor=10**digits;return Math.round(value*factor)/factor;};
const requireRoute=(a:Activity):Point[]=>{
 if(a.source==='draft')throw Error('Resolve the route before exporting. A waypoint preview is not a routed path.');
 const path=plannedPath(a);
 if(path.length<2)throw Error('Route needs at least two points.');
 return path;
};
const withElevation=(path:Point[]):boolean=>path.every(p=>p.ele!==undefined&&Number.isFinite(p.ele));
const namedStops=(a:Activity):Waypoint[]=>a.waypoints.filter(w=>w.name||w.note);
const stopDistance=(w:Waypoint,path:Point[],c:number[]):number=>round(nearestOnPath(path,w,c),1);
/**
 * RFC 7946 FeatureCollection: the planned route as one LineString, plus a Point per
 * named stop so the names and notes survive a round trip through other tools.
 */
export function routeGeoJSON(a:Activity):string {
 const path=requireRoute(a),c=cumulative(path),elevated=withElevation(path);
 const line={
  type:'Feature',
  geometry:{type:'LineString',coordinates:path.map(p=>elevated?[round(p.lon,6),round(p.lat,6),round(p.ele!,2)]:[round(p.lon,6),round(p.lat,6)])},
  properties:{name:a.name,...(a.description?{description:a.description.slice(0,2000)}:{}),sport:a.settings.sport,source:a.source,distance_m:round(c[c.length-1],1),simulated:true,note:'Route geometry exported by SimRun. Timing is simulated, not recorded.'}
 };
 const stops=namedStops(a).map(w=>({
  type:'Feature',
  geometry:{type:'Point',coordinates:w.ele===undefined?[round(w.lon,6),round(w.lat,6)]:[round(w.lon,6),round(w.lat,6),round(w.ele,2)]},
  properties:{role:'stop',distance_m:stopDistance(w,path,c),...(w.name?{name:w.name}:{}),...(w.note?{note:w.note}:{})}
 }));
 return JSON.stringify({type:'FeatureCollection',features:[line,...stops]});
}
/** One row per route vertex, in WGS84 decimal degrees, for spreadsheets and GIS tables. */
export function routeCSV(a:Activity):string {
 const path=requireRoute(a),c=cumulative(path),elevated=withElevation(path);
 return [
  csvRow('seq','latitude','longitude','elevation_m','distance_m'),
  ...path.map((p,i)=>csvRow(i+1,p.lat.toFixed(6),p.lon.toFixed(6),elevated?p.ele!.toFixed(2):'',c[i].toFixed(1)))
 ].join('\r\n')+'\r\n';
}
export function downloadRouteGeoJSON(a:Activity):void {
 download(routeGeoJSON(a),`${a.settings.start.slice(0,10)}-${safeFilename(a.name)}-route.geojson`,'application/geo+json');
}
export function downloadRouteCSV(a:Activity):void {
 download(routeCSV(a),`${a.settings.start.slice(0,10)}-${safeFilename(a.name)}-route.csv`,'text/csv;charset=utf-8');
}

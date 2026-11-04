import {t} from './i18n.js';
import type {Activity,Point,Simulation,RouteData,Waypoint} from './types.js';
import {atDistance,cumulative,nearestOnPath,nearestSegmentIndex} from './geometry.js';
import {clock,plannedPath} from './model.js';
import {download,safeFilename} from './gpx.js';
import {sportLabel} from './sports.js';
import {csvRow} from './csv.js';
export type CueKind='start'|'turn'|'stop'|'finish';
export interface Cue {distance:number;turn:string;heading:number;lat:number;lon:number;kind:CueKind;streetName?:string;name?:string;note?:string}
const rad=Math.PI/180;
/** Initial great-circle bearing in degrees clockwise from north. */
const bearing=(a:Point,b:Point):number=>{
 const y=Math.sin((b.lon-a.lon)*rad)*Math.cos(b.lat*rad);
 const x=Math.cos(a.lat*rad)*Math.sin(b.lat*rad)-Math.sin(a.lat*rad)*Math.cos(b.lat*rad)*Math.cos((b.lon-a.lon)*rad);
 return (Math.atan2(y,x)/rad+360)%360;
};
const normalise=(degrees:number):number=>((degrees+540)%360)-180;
const classify=(delta:number):string=>{
 const size=Math.abs(delta);
 if(size>=160)return 'U-turn';
 if(size>=120)return delta>0?'Sharp right':'Sharp left';
 if(size>=45)return delta>0?'Turn right':'Turn left';
 return delta>0?'Slight right':'Slight left';
};
/**
 * Turns are read from the route geometry itself, so they work for routed, imported
 * and loop-planned paths alike. Heading changes are measured across a short span
 * either side of each vertex to keep dense geometry from inventing manoeuvres.
 */
export function cues(path:Point[],span=25,threshold=25,routeData?:RouteData,stops:Waypoint[]=[]):Cue[] {
 if(path.length<2)return [];
 const c=cumulative(path),total=c[c.length-1];
 if(!(total>0))return [];
 const streetName=(d:number):string|undefined=>{let name:string|undefined;for(const span of routeData?.streetNames??[])if(d>=span.start&&d<=span.end)name=span.name;return name;};
 const step=Math.min(span,Math.max(5,total/8));
 const heading=(i:number):number=>Math.round(bearing(path[i],path[Math.min(path.length-1,i+1)]))%360;
 const found:{distance:number;turn:string;heading:number;lat:number;lon:number;angle:number;streetName?:string}[]=[];
 for(let i=1;i<path.length-1;i++){
  const d=c[i];
  if(d<step||total-d<step)continue;
  const before=atDistance(path,c,d-step),after=atDistance(path,c,d+step);
  const delta=normalise(bearing(path[i],after)-bearing(before,path[i]));
  if(Math.abs(delta)<threshold)continue;
  found.push({distance:d,turn:classify(delta),heading:Math.round(bearing(path[i],after))%360,lat:path[i].lat,lon:path[i].lon,angle:Math.abs(delta),...(streetName(d)?{streetName:streetName(d)}:{})});
 }
 // Two vertices inside one corner describe the same manoeuvre; keep the sharper one.
 const merged:typeof found=[];
 for(const cue of found){
  const last=merged[merged.length-1];
  if(last&&cue.distance-last.distance<step){if(cue.angle>last.angle)merged[merged.length-1]=cue;continue;}
  merged.push(cue);
 }
 const out:Cue[]=[
  {distance:0,turn:'Start',heading:heading(0),lat:path[0].lat,lon:path[0].lon,kind:'start',...(streetName(0)?{streetName:streetName(0)}:{})},
  ...merged.map(({distance,turn,heading,lat,lon,streetName})=>({distance,turn,heading,lat,lon,kind:'turn' as const,...(streetName?{streetName}:{})})),
  {distance:total,turn:'Finish',heading:heading(path.length-2),lat:path[path.length-1].lat,lon:path[path.length-1].lon,kind:'finish',...(streetName(total)?{streetName:streetName(total)}:{})},
 ];
 // A stop shares a row with a manoeuvre it lands on, so the sheet never prints two
 // instructions at the same point; Start and Finish keep their labels.
 for(const w of stops){
  if(!w.name&&!w.note)continue;
  const distance=nearestOnPath(path,w,c),near=out.find(cue=>Math.abs(cue.distance-distance)<=10);
  if(near){if(!near.name&&w.name)near.name=w.name;if(!near.note&&w.note)near.note=w.note;continue;}
  const i=nearestSegmentIndex(path,w),next=path[Math.min(path.length-1,i+1)];
  out.push({distance,turn:'Stop',heading:Math.round(bearing(path[i],next))%360,lat:w.lat,lon:w.lon,kind:'stop',...(w.name?{name:w.name}:{}),...(w.note?{note:w.note}:{}),...(streetName(distance)?{streetName:streetName(distance)}:{})});
 }
 return out.sort((a,b)=>a.distance-b.distance);
}
/** Simulated elapsed seconds at a cumulative route distance, read from the simulation. */
const elapsed=(sim:Simulation,distance:number):number=>{
 const points=sim.points;
 if(points.length<2)return 0;
 let i=1;while(i<points.length-1&&points[i].distance<distance)i++;
 const a=points[i-1],b=points[i],segment=b.distance-a.distance,t=segment>0?(distance-a.distance)/segment:0;
 return (a.time+t*(b.time-a.time)-points[0].time)/1000;
};
export function cueSheetCSV(a:Activity,sim:Simulation,units:'metric'|'imperial'):string {
 const list=cues(plannedPath(a),25,25,a.routeData,a.waypoints),imperial=units==='imperial',factor=imperial?1609.344:1000,label=imperial?'mi':'km';
 return [
  'SimRun cue sheet',
  csvRow('Activity',a.name),
  csvRow('Sport',sportLabel(a.settings.sport)),
  csvRow('Distance',`${(sim.distance/factor).toFixed(2)} ${label}`),
  csvRow('Simulated elapsed',clock(sim.duration)),
  csvRow('Turns','Derived from route geometry. Street names are included only when provided by the routing service; named stops come from the waypoint names and notes you add.'),
  csvRow('Note','Simulated activity generated by SimRun; not a recorded workout.'),
  '',
  csvRow('#',`Distance (${label})`,'Elapsed','Turn','Name','Note','Heading (deg)','Latitude','Longitude','Street name'),
  ...list.map((cue,i)=>csvRow(i+1,(cue.distance/factor).toFixed(3),clock(elapsed(sim,cue.distance)),cue.turn,cue.name??'',cue.note??'',cue.heading,cue.lat.toFixed(6),cue.lon.toFixed(6),cue.streetName??'')),
 ].join('\r\n')+'\r\n';
}
export function downloadCues(a:Activity,sim:Simulation,units:'metric'|'imperial'):void {
 if(a.source==='draft')throw Error(t('Resolve the route before exporting. A waypoint preview is not a routed path.'));
 download(cueSheetCSV(a,sim,units),`${a.settings.start.slice(0,10)}-${safeFilename(a.name)}-cue-sheet.csv`,'text/csv;charset=utf-8');
}

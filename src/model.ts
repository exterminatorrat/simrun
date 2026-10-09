import type {Activity,LoopPlan,Point,Settings,Simulation,Sport,Sample,Preferences} from './types.js';
import {atDistance,clamp,cumulative,isClosedLoop,loopPath,lowerBound,rotatedLoop,validPoint} from './geometry.js';
import {newId} from './id.js';
export const PRODUCT='SimRun';
export const MAX_LOOP_LAPS=20000,MAX_LOOP_DISTANCE=5000000,MAX_LOOP_POINTS=100000;
export interface LoopResult {path:Point[];loopLength:number;distance:number;laps:number;capped:boolean}
export const defaultPreferences:Preferences={units:'metric',theme:'light',mapStyle:'https://tiles.openfreemap.org/styles/liberty',mapStyleDark:'https://tiles.openfreemap.org/styles/dark',routingUrl:'https://valhalla1.openstreetmap.de/route',elevationUrl:'https://valhalla1.openstreetmap.de/height',geocodingUrl:'https://nominatim.openstreetmap.org/search',geocodingEnabled:false};
export function localInput(date=new Date()):string{return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
/** The map style that matches the chosen appearance; each theme has its own endpoint. */
export const mapStyleFor=(p:Preferences):string=>p.theme==='dark'?p.mapStyleDark:p.mapStyle;
export function defaults():Activity {
 const now=Date.now();return {id:newId(),version:1,name:`${new Date().getHours()<12?'Morning':new Date().getHours()<18?'Afternoon':'Evening'} run`,createdAt:now,updatedAt:now,waypoints:[],path:[],source:'draft',settings:{sport:'run',start:localInput(),utcOffset:-new Date().getTimezoneOffset(),pace:300,speed:24,mode:'constant',variation:.06,sample:2,hrEnabled:false,hrAverage:150,hrVariation:5,seed:Math.floor(Math.random()*1000000)}};
}
export function durationFor(meters:number,sport:Sport,pace:number,speed:number):number{return sport==='run'?meters/1000*pace:meters/1000/speed*3600;}
export function clock(value:number):string {const n=Math.max(0,Math.round(value)),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;}
export function parseClock(s:string):number {
 if(!/^\d{1,3}:\d{2}(:\d{2})?$/.test(s.trim()))throw Error('Use m:ss or h:mm:ss.');const n=s.trim().split(':').map(Number);if(n.slice(1).some(v=>v>=60))throw Error('Seconds and minutes must be below 60.');return n.reduce((v,n)=>v*60+n,0);
}
export function startTime(s:Settings):number {
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.start))throw Error('Choose a valid start date and time.');
 const time=Date.parse(s.start+':00Z');if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,16)!==s.start)throw Error('Invalid calendar date.');return time-s.utcOffset*60000;
}
export function validateSettings(s:Settings):void {
 if(!s||!['run','ride'].includes(s.sport)||!['constant','natural'].includes(s.mode)||![1,2,5].includes(s.sample))throw Error('Activity settings are invalid.');
 for(const [value,min,max] of [[s.pace,60,3600],[s.speed,1,150],[s.variation,0,.25],[s.utcOffset,-720,840],[s.hrAverage,30,240],[s.hrVariation,0,30],[s.seed,0,2147483647]])if(!Number.isFinite(value)||value<min||value>max)throw Error('Activity settings are outside supported limits.');
 if(typeof s.hrEnabled!=='boolean')throw Error('Invalid heart-rate setting.');startTime(s);
}
export function validateActivity(value:unknown):Activity {
 if(!value||typeof value!=='object')throw Error('Not a SimRun activity.');const a=value as Activity;
 if(a.version!==1||typeof a.id!=='string'||!a.id||a.id.length>100||typeof a.name!=='string'||a.name.length>160)throw Error('Invalid activity version, ID or name.');
 if(!['draft','routed','imported'].includes(a.source)||!Number.isFinite(a.createdAt)||!Number.isFinite(a.updatedAt))throw Error('Activity metadata is invalid.');
 if(!Array.isArray(a.path)||a.path.length>100000||!Array.isArray(a.waypoints)||a.waypoints.length>200)throw Error('Route exceeds supported size.');
 const clean=(p:Point):Point=>{if(!validPoint(p))throw Error('Invalid route coordinate.');const q:Point={lat:p.lat,lon:p.lon};if(p.ele!==undefined){if(!Number.isFinite(p.ele)||Math.abs(p.ele)>12000)throw Error('Invalid elevation.');q.ele=p.ele;}if(Number.isFinite(p.time))q.time=p.time;if(Number.isFinite(p.hr)&&p.hr!>=0&&p.hr!<=255)q.hr=p.hr;return q;};
 const cleanLoop=(v:LoopPlan|undefined):LoopPlan|undefined=>{
  if(v===undefined||v===null)return undefined;
  if(typeof v!=='object'||(v.mode!=='laps'&&v.mode!=='distance'))throw Error('Invalid loop plan.');
  if(!Number.isFinite(v.value)||v.value<=0||v.value>(v.mode==='laps'?MAX_LOOP_LAPS:MAX_LOOP_DISTANCE))throw Error('Loop plan is outside supported limits.');
  if(!Number.isFinite(v.start)||v.start<0||v.start>=1)throw Error('Invalid loop start.');
  return {start:v.start,mode:v.mode,value:v.value};
 };
 validateSettings(a.settings);
 const s=a.settings;
 const loop=cleanLoop(a.loop);
 // Explicitly select fields; never merge untrusted objects into app state.
 return {id:a.id,version:1,name:a.name,createdAt:a.createdAt,updatedAt:a.updatedAt,source:a.source,path:a.path.map(clean),waypoints:a.waypoints.map(clean),settings:{sport:s.sport,start:s.start,utcOffset:s.utcOffset,pace:s.pace,speed:s.speed,mode:s.mode,variation:s.variation,sample:s.sample,hrEnabled:s.hrEnabled,hrAverage:s.hrAverage,hrVariation:s.hrVariation,seed:s.seed},...(loop?{loop}:{})};
}
/** Resolves a lap plan against the current closed route, or null when it cannot apply. */
export function loopPlan(a:Activity):LoopResult|null {
 const plan=a.loop;if(!plan||!isClosedLoop(a.path))return null;
 const loopLength=cumulative(a.path).at(-1)||0;if(!(loopLength>0))return null;
 const requested=plan.mode==='laps'?plan.value:plan.value/loopLength;
 const per=Math.max(1,rotatedLoop(a.path,plan.start).length-1);
 const cap=Math.max(1e-3,Math.min((MAX_LOOP_POINTS-2)/per,MAX_LOOP_DISTANCE/loopLength));
 const laps=Math.min(requested,cap);
 return {path:loopPath(a.path,plan.start,laps),loopLength,distance:laps*loopLength,laps,capped:laps<requested-1e-9};
}
export function plannedPath(a:Activity):Point[]{return loopPlan(a)?.path??a.path;}
export function simulate(a:Activity):Simulation {
 const route=plannedPath(a);validateSettings(a.settings);if(route.length<2)throw Error('Draw or import a route before exporting.');
 const c=cumulative(route),total=c[c.length-1],s=a.settings;
 if(total<1||total>5000000)throw Error('Route must be between 1 meter and 5,000 km.');
 const duration=durationFor(total,s.sport,s.pace,s.speed);
 if(duration<.01||duration>604800)throw Error('Activity duration must be between 0.01 seconds and 7 days.');
 const durationMs=Math.max(1,Math.round(duration*1000)),start=startTime(s);
 const n=Math.min(40000,Math.max(2,Math.ceil(total/10))),times=[0],ds=total/n;
 const phase=(s.seed%997)/997*Math.PI*2;
 const weights:number[]=[];
 for(let i=0;i<n;i++) {
  const d=(i+.5)*ds;
  const wave=.62*Math.sin(d/430+phase)+.27*Math.sin(d/180+phase*.7)+.11*Math.sin(d/70);
  const p=atDistance(route,c,i*ds),q=atDistance(route,c,(i+1)*ds);
  const grade=Number.isFinite(p.ele)&&Number.isFinite(q.ele)?clamp((q.ele!-p.ele!)/ds,-.15,.15):0;
  const w=s.mode==='natural'?clamp(1+s.variation*wave+grade*.7,.65,1.4):1;
  weights.push(w);times.push(times[i]+w*ds);
 }
 const raw=times[n];for(let i=1;i<times.length;i++)times[i]=times[i]/raw*durationMs;
 // Bound memory on long activities and show the effective interval in the UI.
 const intervalMs=Math.max(s.sample*1000,Math.ceil(durationMs/49998)),samples=Math.ceil(durationMs/intervalMs);
 const points:Sample[]=[];
 for(let k=0;k<=samples;k++){
  const ms=Math.min(durationMs,k*intervalMs),i=Math.min(n,Math.max(1,lowerBound(times,ms)));
  const t=(ms-times[i-1])/(times[i]-times[i-1]),d=clamp((i-1+t)*ds,0,total);
  const point=atDistance(route,c,d);delete point.hr;const speed=ds/((times[i]-times[i-1])/1000);
  points.push({...point,time:start+ms,distance:d,speed});
 }
 if(s.hrEnabled){
  const baseline=points.map(p=>{const t=(p.time-start)/1000;return s.hrVariation*(.5*Math.sin(p.distance/650+phase)+.2*Math.sin(p.distance/180))-Math.min(14,s.hrVariation*2)*Math.exp(-t/150);});
  let sum=0;for(let i=1;i<points.length;i++)sum+=(baseline[i]+baseline[i-1])/2*(points[i].time-points[i-1].time);
  const mean=sum/durationMs;
  points.forEach((p,i)=>p.hr=Math.round(clamp(s.hrAverage+baseline[i]-mean,30,240)));
 }
 return {points,duration:durationMs/1000,distance:total,interval:intervalMs/1000};
}

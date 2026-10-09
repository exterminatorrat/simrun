import type {Activity,LoopPlan,Point,Settings,Simulation,Sport,Sample,Preferences,Split,Splits} from './types.js';
import {atDistance,clamp,cumulative,elevationStats,isClosedLoop,loopPath,lowerBound,rotatedLoop,validPoint,wrapLon} from './geometry.js';
import {newId} from './id.js';
export const PRODUCT='SimRun';
export const MAX_LOOP_LAPS=20000,MAX_LOOP_DISTANCE=5000000,MAX_LOOP_POINTS=100000;
export interface LoopResult {path:Point[];loopLength:number;distance:number;laps:number;capped:boolean}
export const defaultPreferences:Preferences={units:'metric',theme:'light',mapStyle:'https://tiles.openfreemap.org/styles/liberty',mapStyleDark:'https://tiles.openfreemap.org/styles/dark',routingUrl:'https://valhalla1.openstreetmap.de/route',elevationUrl:'https://valhalla1.openstreetmap.de/height',geocodingUrl:'https://nominatim.openstreetmap.org/search',geocodingEnabled:false};
export function localInput(date=new Date()):string{return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
/** The map style that matches the chosen appearance; each theme has its own endpoint. */
export const mapStyleFor=(p:Preferences):string=>p.theme==='dark'?p.mapStyleDark:p.mapStyle;
export function defaults():Activity {
 const now=Date.now();return {id:newId(),version:1,name:`${new Date().getHours()<12?'Morning':new Date().getHours()<18?'Afternoon':'Evening'} run`,createdAt:now,updatedAt:now,waypoints:[],path:[],source:'draft',settings:{sport:'run',start:localInput(),utcOffset:-new Date().getTimezoneOffset(),pace:300,speed:24,mode:'constant',variation:.06,sample:2,hrEnabled:false,hrAverage:150,hrVariation:5,seed:Math.floor(Math.random()*1000000),gps:{noise:0,dropout:0}}};
}
/** Builds an imported activity from retained geometry. Missing or non-increasing timestamps never fabricate timing. */
export function importedActivity(points:Point[],name:string,typeText:string,label='Imported'):{activity:Activity;notices:string[]} {
 const a=defaults();a.path=points;a.source='imported';a.waypoints=[];
 a.name=((name||'').trim()||'Imported activity').slice(0,160);
 if(/cycl|bik|ride/i.test(typeText))a.settings.sport='ride';
 const c=cumulative(points),d=c[c.length-1];if(d<1)throw Error(`${label} route is shorter than one meter.`);
 const notices:string[]=[];
 const timed=points.every((p,i)=>p.time!==undefined&&(i===0||p.time>points[i-1].time!));
 if(timed){const date=new Date(points[0].time!);a.settings.start=localInput(date);a.settings.utcOffset=-date.getTimezoneOffset();const duration=(points[points.length-1].time!-points[0].time!)/1000;const pace=duration/(d/1000),speed=d/1000/duration*3600;
  if(pace>=60&&pace<=3600)a.settings.pace=pace;if(speed>=1&&speed<=150)a.settings.speed=speed;
 }else notices.push('Original timestamps were missing or not increasing; new timing uses the activity settings.');
 notices.push('Geometry retained. Exports are explicitly resimulated, not original recordings.');
 return {activity:a,notices};
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
 if(s.gps!==undefined&&(typeof s.gps!=='object'||!Number.isFinite(s.gps.noise)||s.gps.noise<0||s.gps.noise>50||!Number.isFinite(s.gps.dropout)||s.gps.dropout<0||s.gps.dropout>.5))throw Error('Invalid GPS simulation setting.');
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
 const cleanSplits=(v:Splits|undefined):Splits|undefined=>{
  if(v===undefined||v===null)return undefined;
  if(typeof v!=='object'||!Number.isFinite(v.auto)||v.auto<0||v.auto>500000)throw Error('Invalid split settings.');
  if(!Array.isArray(v.markers)||v.markers.length>200)throw Error('Too many split markers.');
  const markers=v.markers.map(m=>{if(!Number.isFinite(m)||m<=0||m>MAX_LOOP_DISTANCE)throw Error('Invalid split marker.');return m;}).sort((x,y)=>x-y).filter((m,i,all)=>i===0||m!==all[i-1]);
  return {auto:v.auto,markers};
 };
 validateSettings(a.settings);
 const s=a.settings;
 const loop=cleanLoop(a.loop);
 const splits=cleanSplits(a.splits);
 // Explicitly select fields; never merge untrusted objects into app state.
 return {id:a.id,version:1,name:a.name,createdAt:a.createdAt,updatedAt:a.updatedAt,source:a.source,path:a.path.map(clean),waypoints:a.waypoints.map(clean),settings:{sport:s.sport,start:s.start,utcOffset:s.utcOffset,pace:s.pace,speed:s.speed,mode:s.mode,variation:s.variation,sample:s.sample,hrEnabled:s.hrEnabled,hrAverage:s.hrAverage,hrVariation:s.hrVariation,seed:s.seed,...(s.gps?{gps:{noise:s.gps.noise,dropout:s.gps.dropout}}:{})},...(loop?{loop}:{}),...(splits?{splits}:{})};
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
  const avgSpeed=total/(durationMs/1000),next=gpsRandom(s.seed^0x27d4eb2f),step=intervalMs/1000;
  const phi=Math.exp(-step/25),sigma=s.hrVariation*.55,gauss=()=>{const u=Math.max(1e-9,next());return Math.sqrt(-2*Math.log(u))*Math.cos(next()*Math.PI*2);};
  const rest=Math.min(90,s.hrAverage),raw:number[]=[];let walk=0;
  points.forEach(p=>{
   walk=walk*phi+sigma*Math.sqrt(1-phi*phi)*gauss();
   const t=(p.time-start)/1000,ratio=clamp(p.speed/avgSpeed-1,-.4,.4);
   const lo=Math.max(0,p.distance-100),hi=Math.min(total,p.distance+100),a=atDistance(route,c,lo),b=atDistance(route,c,hi);
   const grade=Number.isFinite(a.ele)&&Number.isFinite(b.ele)?clamp((b.ele!-a.ele!)/(hi-lo),-.15,.15):0;
   const drift=Math.min(s.hrVariation*3,s.hrVariation*.03*Math.max(0,t-600)/60);
   raw.push(walk+s.hrVariation*(2.4*ratio+16*grade)+(rest-s.hrAverage)*Math.exp(-t/50)+drift);
  });
  let sum=0;for(let i=1;i<points.length;i++)sum+=(raw[i]+raw[i-1])/2*(points[i].time-points[i-1].time);
  const mean=sum/durationMs;
  points.forEach((p,i)=>p.hr=Math.round(clamp(s.hrAverage+raw[i]-mean,30,240)));
 }
 const gps=s.gps;
 return {points:applyDropout(applyGpsNoise(points,gps?.noise??0,s.seed),gps?.dropout??0,s.seed),duration:durationMs/1000,distance:total,interval:intervalMs/1000};
}
function gpsRandom(seed:number):()=>number {let t=seed>>>0;return ()=>{t=(t+0x6d2b79f5)>>>0;let r=Math.imul(t^(t>>>15),1|t);r=(r+Math.imul(r^(r>>>7),61|r))^r;return ((r^(r>>>14))>>>0)/4294967296;};}
/** Deterministic horizontal GPS jitter; distance and timing keep their true route values. */
function applyGpsNoise(points:Sample[],meters:number,seed:number):Sample[] {
 if(!(meters>0))return points;
 const next=gpsRandom(seed^0x9e3779b9);
 return points.map(p=>{
  const angle=next()*Math.PI*2,radius=Math.sqrt(-2*Math.log(Math.max(1e-9,1-next())))*meters;
  const dLat=radius*Math.cos(angle)/111320,dLon=radius*Math.sin(angle)/(111320*Math.max(.01,Math.cos(p.lat*Math.PI/180)));
  return {...p,lat:clamp(p.lat+dLat,-90,90),lon:wrapLon(p.lon+dLon)};
 });
}
/** Deterministic signal outages as contiguous dropped fixes, so exports break into segments instead of inventing straight lines. */
function applyDropout(points:Sample[],fraction:number,seed:number):Sample[] {
 if(!(fraction>0)||points.length<4)return points;
 const next=gpsRandom(seed^0x85ebca6b),out:Sample[]=[],maxRun=Math.max(2,Math.round(fraction*12));
 let skip=0;
 for(let i=0;i<points.length;i++){
  if(i===0||i===points.length-1){out.push(points[i]);continue;}
  if(skip>0){skip--;continue;}
  if(next()<fraction*.5){skip=Math.min(points.length-2-i,1+Math.floor(next()*maxRun));continue;}
  out.push(points[i]);
 }
 return out.length>=2?out:points;
}
function timeAtDistance(points:Sample[],d:number):number {
 const first=points[0],last=points[points.length-1];
 if(d<=first.distance)return first.time;if(d>=last.distance)return last.time;
 let lo=0,hi=points.length-1;
 while(lo<hi){const mid=(lo+hi)>>1;if(points[mid].distance<d)lo=mid+1;else hi=mid;}
 const b=points[lo],a=points[lo-1],seg=b.distance-a.distance;
 return seg>0?a.time+(d-a.distance)/seg*(b.time-a.time):a.time;
}
/** Split boundaries in meters: zero, auto-split multiples, custom markers and the finish. */
export function splitBoundaries(a:Activity,total:number):number[] {
 const values=[0],auto=a.splits?.auto??0;
 if(auto>0)for(let d=auto;d<total-1e-6;d+=auto)values.push(d);
 for(const m of a.splits?.markers??[])if(m>0&&m<total-1e-6)values.push(m);
 values.push(total);
 const out:number[]=[];
 for(const v of values.sort((x,y)=>x-y))if(!out.length||v-out[out.length-1]>1e-6)out.push(v);
 return out;
}
export function computeSplits(a:Activity,s:Simulation):Split[] {
 const bounds=splitBoundaries(a,s.distance),out:Split[]=[];
 for(let i=1;i<bounds.length;i++){
  const start=bounds[i-1],end=bounds[i],duration=(timeAtDistance(s.points,end)-timeAtDistance(s.points,start))/1000;
  const slice=s.points.filter(p=>p.distance>=start-1e-6&&p.distance<=end+1e-6);
  out.push({start,end,distance:end-start,duration,speed:duration>0?(end-start)/duration:0,gain:elevationStats(slice).gain});
 }
 return out;
}

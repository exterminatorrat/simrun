import type {Activity,LoopPlan,Point,Settings,Simulation,Sport,Sample,Preferences,Split,Splits,WeatherPreset,WeatherSim,PowerSim,CadenceSim,FatigueSim,Workout,WorkoutStep,Pauses,RestStop,RouteData,RouteSurfaceEdge,StreetNameSpan} from './types.js';
import {atDistance,clamp,cumulative,elevationStats,isClosedLoop,loopPath,lowerBound,rotatedLoop,validPoint,wrapLon} from './geometry.js';
import {newId} from './id.js';
import {expandWorkout,stepAt} from './workout.js';
import {usesPace,sportFromText} from './sports.js';
import {averageGapPace,gradeAdjustedPace} from './gap.js';
export const PRODUCT='SimRun';
export const MAX_LOOP_LAPS=20000,MAX_LOOP_DISTANCE=5000000,MAX_LOOP_POINTS=100000;
export const WEATHER_PRESETS:Record<WeatherPreset,{label:string;tempC:number;humidity:number;headwindKph:number}>={ideal:{label:'Ideal',tempC:15,humidity:50,headwindKph:0},cool:{label:'Cool',tempC:6,humidity:60,headwindKph:3},mild:{label:'Mild',tempC:18,humidity:55,headwindKph:5},warm:{label:'Warm',tempC:26,humidity:50,headwindKph:5},hot:{label:'Hot',tempC:34,humidity:30,headwindKph:4},humid:{label:'Humid',tempC:28,humidity:85,headwindKph:3},windy:{label:'Windy',tempC:16,humidity:55,headwindKph:22}};
/** Deterministic weather penalty applied to total duration; neutral conditions return exactly 1. */
export function weatherFactor(w:WeatherSim|undefined):number {
 if(!w)return 1;
 const heat=Math.max(0,w.tempC-15)*.012,cold=Math.max(0,8-w.tempC)*.01,humid=Math.max(0,w.humidity-60)*.0015*(w.tempC>20?1:.4),wind=w.headwindKph*.004;
 return clamp(1+heat+cold+humid+wind,1,2);
}
/** Heat and humidity deepen cardiac drift; neutral conditions return exactly 1. */
export function weatherHeat(w:WeatherSim|undefined):number {
 if(!w)return 1;
 return clamp(1+Math.max(0,w.tempC-20)*.03+Math.max(0,w.humidity-60)*.004,1,2);
}
export interface LoopResult {path:Point[];loopLength:number;distance:number;laps:number;capped:boolean}
export const defaultPreferences:Preferences={units:'metric',theme:'light',mapStyle:'https://tiles.openfreemap.org/styles/liberty',mapStyleDark:'https://tiles.openfreemap.org/styles/dark',mapBaseLayer:'vector',mapCyclingOverlay:false,mapHikingOverlay:false,routingUrl:'https://valhalla1.openstreetmap.de/route',elevationUrl:'https://valhalla1.openstreetmap.de/height',geocodingUrl:'https://nominatim.openstreetmap.org/search',geocodingEnabled:false,photonUrl:'https://photon.komoot.io/api/',searchSuggestions:false,overpassUrl:'https://overpass-api.de/api/interpreter',poiEnabled:false,surfaceDataEnabled:false,hrMax:190,offlineRouting:false,corridorZoom:12,avoidHighways:false,avoidHills:false,alternates:false};
export function localInput(date=new Date()):string{return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
/** The map style that matches the chosen appearance; each theme has its own endpoint. */
export const mapStyleFor=(p:Preferences):string=>p.theme==='dark'?p.mapStyleDark:p.mapStyle;
export function defaults():Activity {
 const now=Date.now();return {id:newId(),version:1,name:`${new Date().getHours()<12?'Morning':new Date().getHours()<18?'Afternoon':'Evening'} run`,createdAt:now,updatedAt:now,waypoints:[],path:[],source:'draft',settings:{sport:'run',start:localInput(),utcOffset:-new Date().getTimezoneOffset(),pace:300,speed:24,mode:'constant',variation:.06,sample:2,paceStrategy:'even',hrEnabled:false,hrAverage:150,hrVariation:5,seed:Math.floor(Math.random()*1000000),gps:{noise:0,dropout:0}}};
}
/** Builds an imported activity from retained geometry. Missing or non-increasing timestamps never fabricate timing. */
export function importedActivity(points:Point[],name:string,typeText:string,label='Imported'):{activity:Activity;notices:string[]} {
 const a=defaults();a.path=points;a.source='imported';a.waypoints=[];
 a.name=((name||'').trim()||'Imported activity').slice(0,160);
 a.settings.sport=sportFromText(typeText);
 const c=cumulative(points),d=c[c.length-1];if(d<1)throw Error(`${label} route is shorter than one meter.`);
 const notices:string[]=[];
 const timed=points.every((p,i)=>p.time!==undefined&&(i===0||p.time>points[i-1].time!));
 if(timed){const date=new Date(points[0].time!);a.settings.start=localInput(date);a.settings.utcOffset=-date.getTimezoneOffset();const duration=(points[points.length-1].time!-points[0].time!)/1000;const pace=duration/(d/1000),speed=d/1000/duration*3600;
  if(pace>=60&&pace<=3600)a.settings.pace=pace;if(speed>=1&&speed<=150)a.settings.speed=speed;
 }else notices.push('Original timestamps were missing or not increasing; new timing uses the activity settings.');
 const detected=timed?detectStops(points):[];
 if(detected.length)a.pauses={rests:detected};
 notices.push('Geometry retained. Exports are explicitly resimulated, not original recordings.');
 if(detected.length)notices.push(`Detected ${detected.length} auto-pause ${detected.length===1?'stop':'stops'} of at least 30 seconds; they count as elapsed but not moving time.`);
 return {activity:a,notices};
}
/** Timestamped stalls of at least `minSeconds` below `maxSpeed` become rest stops. */
export function detectStops(points:Point[],minSeconds=30,maxSpeed=0.7):RestStop[] {
 const out:RestStop[]=[];let run=0,runStart=0,startDistance=0,total=0;
 const c=cumulative(points);
 const flush=()=>{if(run>0&&total>=minSeconds)out.push({distance:startDistance,seconds:Math.round(total)});run=0;total=0;};
 for(let i=1;i<points.length&&out.length<200;i++){
  const dt=(points[i].time!-points[i-1].time!)/1000,dd=c[i]-c[i-1];
  const slow=dt>0&&dd/dt<maxSpeed;
  if(slow){if(run===0){run=1;runStart=i-1;startDistance=c[i-1];total=0;}total+=dt;}
  else flush();
 }
 flush();
 return out;
}
export function durationFor(meters:number,sport:Sport,pace:number,speed:number):number{return usesPace(sport)?meters/1000*pace:meters/1000/speed*3600;}
export function clock(value:number):string {const n=Math.max(0,Math.round(value)),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;}
export function parseClock(s:string):number {
 if(!/^\d{1,3}:\d{2}(:\d{2})?$/.test(s.trim()))throw Error('Use m:ss or h:mm:ss.');const n=s.trim().split(':').map(Number);if(n.slice(1).some(v=>v>=60))throw Error('Seconds and minutes must be below 60.');return n.reduce((v,n)=>v*60+n,0);
}
export function startTime(s:Settings):number {
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.start))throw Error('Choose a valid start date and time.');
 const time=Date.parse(s.start+':00Z');if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,16)!==s.start)throw Error('Invalid calendar date.');return time-s.utcOffset*60000;
}
export function validateSettings(s:Settings):void {
 if(!s||!['run','ride','walk','hike','trail-run','mtb'].includes(s.sport)||!['constant','natural'].includes(s.mode)||![1,2,5].includes(s.sample))throw Error('Activity settings are invalid.');
 if(s.paceStrategy!==undefined&&!['even','negative-split','positive-split','segments'].includes(s.paceStrategy))throw Error('Invalid pace strategy.');
 if(s.paceSegments!==undefined){const min=usesPace(s.sport)?60:1,max=usesPace(s.sport)?3600:150;if(!Array.isArray(s.paceSegments)||s.paceSegments.length<2||s.paceSegments.length>50||s.paceSegments.some(v=>!Number.isFinite(v)||v<min||v>max)||s.paceStrategy!=='segments')throw Error('Invalid segment pace targets.');}
 if(s.paceStrategy==='segments'&&!s.paceSegments)throw Error('Segment pace targets are required.');
 if(s.profile!==undefined&&!['walk','hike','road','mtb'].includes(s.profile))throw Error('Invalid routing profile.');
 for(const [value,min,max] of [[s.pace,60,3600],[s.speed,1,150],[s.variation,0,.25],[s.utcOffset,-720,840],[s.hrAverage,30,240],[s.hrVariation,0,30],[s.seed,0,2147483647]])if(!Number.isFinite(value)||value<min||value>max)throw Error('Activity settings are outside supported limits.');
 if(typeof s.hrEnabled!=='boolean')throw Error('Invalid heart-rate setting.');startTime(s);
 if(s.gps!==undefined&&(typeof s.gps!=='object'||!Number.isFinite(s.gps.noise)||s.gps.noise<0||s.gps.noise>50||!Number.isFinite(s.gps.dropout)||s.gps.dropout<0||s.gps.dropout>.5))throw Error('Invalid GPS simulation setting.');
 const within=(v:number,min:number,max:number)=>Number.isFinite(v)&&v>=min&&v<=max;
 if(s.power!==undefined&&(typeof s.power!=='object'||typeof s.power.enabled!=='boolean'||!within(s.power.weightKg,30,300)))throw Error('Invalid power setting.');
 if(s.cadence!==undefined&&(typeof s.cadence!=='object'||typeof s.cadence.enabled!=='boolean'))throw Error('Invalid cadence setting.');
 if(s.fatigue!==undefined&&(typeof s.fatigue!=='object'||!within(s.fatigue.percent,0,30)))throw Error('Invalid fatigue setting.');
 if(s.weather!==undefined&&(typeof s.weather!=='object'||!(s.weather.preset in WEATHER_PRESETS)||!within(s.weather.tempC,-40,60)||!within(s.weather.humidity,0,100)||!within(s.weather.headwindKph,0,80)))throw Error('Invalid weather setting.');
}
export function sanitizeCollection(value:unknown):string|undefined {
 if(value===undefined||value===null)return undefined;
 if(typeof value!=='string')throw Error('Invalid collection name.');
 const collection=value.trim();
 if(collection.length>40||/[\u0000-\u001f\u007f]/.test(collection))throw Error('Collection names must be 40 characters or fewer and contain no control characters.');
 return collection||undefined;
}
export function validateActivity(value:unknown):Activity {
 if(!value||typeof value!=='object')throw Error('Not a SimRun activity.');const a=value as Activity;
 if(a.version!==1||typeof a.id!=='string'||!a.id||a.id.length>100||typeof a.name!=='string'||a.name.length>160)throw Error('Invalid activity version, ID or name.');
 if(a.description!==undefined&&typeof a.description!=='string')throw Error('Invalid activity description.');
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
 const cleanPower=(v:PowerSim|undefined):PowerSim|undefined=>v===undefined||v===null?undefined:{enabled:v.enabled===true,weightKg:v.weightKg};
 const cleanCadence=(v:CadenceSim|undefined):CadenceSim|undefined=>v===undefined||v===null?undefined:{enabled:v.enabled===true};
 const cleanFatigue=(v:FatigueSim|undefined):FatigueSim|undefined=>v===undefined||v===null?undefined:{percent:v.percent};
 const cleanWeather=(v:WeatherSim|undefined):WeatherSim|undefined=>v===undefined||v===null?undefined:{preset:v.preset,tempC:v.tempC,humidity:v.humidity,headwindKph:v.headwindKph};
 const cleanTags=(v:string[]|undefined):string[]|undefined=>{
  if(v===undefined||v===null)return undefined;
  if(!Array.isArray(v))throw Error('Invalid tags.');
  const out=[...new Set(v.map(t=>String(t).trim()).filter(Boolean))].map(t=>t.slice(0,24));
  if(out.length>8)throw Error('Use at most eight tags.');
  return out.length?out:undefined;
 };
 const cleanRouteData=(v:RouteData|undefined,total:number):RouteData|undefined=>{
  if(v===undefined||v===null)return undefined;
  if(typeof v!=='object'||Array.isArray(v))throw Error('Invalid route data.');
  const cleanLabel=(label:unknown):string=>{if(typeof label!=='string'||!/^[a-zA-Z0-9 _-]{1,64}$/.test(label.trim()))throw Error('Invalid route data label.');return label.trim();};
  let streetNames:StreetNameSpan[]|undefined,surfaceEdges:RouteSurfaceEdge[]|undefined;
  if(v.streetNames!==undefined){
   if(!Array.isArray(v.streetNames)||v.streetNames.length>20000)throw Error('Invalid route street names.');
   streetNames=v.streetNames.map(span=>{if(!span||!Number.isFinite(span.start)||!Number.isFinite(span.end)||span.start<0||span.end<span.start||span.end>total+1||typeof span.name!=='string'||!span.name.trim()||span.name.length>160)throw Error('Invalid route street name.');return {start:span.start,end:span.end,name:span.name.trim()};});
  }
  if(v.surfaceEdges!==undefined){
   if(!Array.isArray(v.surfaceEdges)||v.surfaceEdges.length>20000)throw Error('Invalid route surface data.');
   surfaceEdges=v.surfaceEdges.map(edge=>{if(!edge||!Number.isFinite(edge.distance)||edge.distance<=0||edge.distance>5000000)throw Error('Invalid route surface distance.');const clean:RouteSurfaceEdge={distance:edge.distance};if(edge.surface!==undefined)clean.surface=cleanLabel(edge.surface);if(edge.roadClass!==undefined)clean.roadClass=cleanLabel(edge.roadClass);if(!clean.surface&&!clean.roadClass)throw Error('Route surface edge has no classification.');return clean;});
  }
  return streetNames?.length||surfaceEdges?.length?{...(streetNames?.length?{streetNames}:{}),...(surfaceEdges?.length?{surfaceEdges}:{})}:undefined;
 };
 const cleanWorkout=(v:Workout|undefined):Workout|undefined=>{
  if(v===undefined||v===null)return undefined;
  if(typeof v!=='object'||!Array.isArray(v.steps)||!v.steps.length||v.steps.length>200)throw Error('Invalid workout.');
 return {steps:v.steps.map(st=>{if(typeof st!=='object'||(st.kind!=='work'&&st.kind!=='rest')||!Number.isFinite(st.distance)||st.distance<=0||st.distance>MAX_LOOP_DISTANCE)throw Error('Invalid workout step.');const step:WorkoutStep={kind:st.kind,distance:st.distance};if(st.pace!==undefined){if(!Number.isFinite(st.pace)||st.pace<60||st.pace>3600)throw Error('Workout pace must be between 1:00 and 60:00 per km.');step.pace=st.pace;}if(st.speed!==undefined){if(!Number.isFinite(st.speed)||st.speed<1||st.speed>150)throw Error('Workout speed must be between 1 and 150 km/h.');step.speed=st.speed;}if(st.hr!==undefined&&Number.isFinite(st.hr))step.hr=st.hr;return step;})};
 };
 const cleanPauses=(v:Pauses|undefined):Pauses|undefined=>{
  if(v===undefined||v===null)return undefined;
  if(typeof v!=='object'||!Array.isArray(v.rests)||v.rests.length>200)throw Error('Invalid pauses.');
  return {rests:v.rests.map(r=>{if(typeof r!=='object'||!Number.isFinite(r.distance)||r.distance<0||!Number.isFinite(r.seconds)||r.seconds<=0||r.seconds>86400)throw Error('Invalid rest stop.');return {distance:r.distance,seconds:r.seconds};})};
 };
 const power=cleanPower(s.power)||undefined,cadence=cleanCadence(s.cadence)||undefined,fatigue=cleanFatigue(s.fatigue)||undefined,weather=cleanWeather(s.weather)||undefined,workout=cleanWorkout(a.workout),pauses=cleanPauses(a.pauses),tags=cleanTags(a.tags),collection=sanitizeCollection(a.collection);
 const path=a.path.map(clean),routeData=cleanRouteData(a.routeData,cumulative(path).at(-1)??0);
 // Explicitly select fields; never merge untrusted objects into app state.
 return {id:a.id,version:1,name:a.name,...(a.description!==undefined?{description:a.description.slice(0,2000)}:{}),createdAt:a.createdAt,updatedAt:a.updatedAt,source:a.source,path,waypoints:a.waypoints.map(clean),settings:{sport:s.sport,...(s.profile?{profile:s.profile}:{}),start:s.start,utcOffset:s.utcOffset,pace:s.pace,speed:s.speed,mode:s.mode,variation:s.variation,sample:s.sample,paceStrategy:s.paceStrategy??'even',...(s.paceSegments?{paceSegments:[...s.paceSegments]}:{}),hrEnabled:s.hrEnabled,hrAverage:s.hrAverage,hrVariation:s.hrVariation,seed:s.seed,...(s.gps?{gps:{noise:s.gps.noise,dropout:s.gps.dropout}}:{}),...(power?{power}:{}),...(cadence?{cadence}:{}),...(fatigue?{fatigue}:{}),...(weather?{weather}:{})},...(loop?{loop}:{}),...(splits?{splits}:{}),...(routeData?{routeData}:{}),...(workout?{workout}:{}),...(pauses?{pauses}:{}),...(tags?{tags}:{}),...(collection?{collection}:{})};
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
 const steps=a.workout?expandWorkout(a.workout,total):null;
 const baseMs=steps?steps.reduce((n,st)=>n+durationFor(st.end-st.start,s.sport,st.step.pace??s.pace,st.step.speed??s.speed)*1000,0):duration*1000;
 const plannedMs=baseMs*weatherFactor(s.weather);
 if(!(plannedMs>=10)||plannedMs>604800000)throw Error('Activity duration must be between 0.01 seconds and 7 days.');
 const durationMs=Math.max(1,Math.round(baseMs*weatherFactor(s.weather))),start=startTime(s);
 const n=Math.min(40000,Math.max(2,Math.ceil(total/10))),times=[0],ds=total/n;
 const phase=(s.seed%997)/997*Math.PI*2;
 const waveAt=(d:number)=>.62*Math.sin(d/430+phase)+.27*Math.sin(d/180+phase*.7)+.11*Math.sin(d/70);
 // Centered 30 m smoothed grade; uphill costs more than downhill saves.
 const gradeAt=(d:number):number=>{const lo=Math.max(0,d-15),hi=Math.min(total,d+15);if(!(hi>lo))return 0;const p=atDistance(route,c,lo),q=atDistance(route,c,hi);return Number.isFinite(p.ele)&&Number.isFinite(q.ele)?clamp((q.ele!-p.ele!)/(hi-lo),-.15,.15):0;};
 const bearing=(p:Point,q:Point)=>{const f1=p.lat*Math.PI/180,f2=q.lat*Math.PI/180,dl=(q.lon-p.lon)*Math.PI/180;return Math.atan2(Math.sin(dl)*Math.cos(f2),Math.cos(f1)*Math.sin(f2)-Math.sin(f1)*Math.cos(f2)*Math.cos(dl));};
 // Curvature: sharp turns cost a little speed, derived only from geometry.
 const turnAt=(d:number):number=>{if(d<=0||d>=total)return 0;const p=atDistance(route,c,d-15),q=atDistance(route,c,d),r=atDistance(route,c,d+15);let t=bearing(p,q)-bearing(q,r);while(t>Math.PI)t-=2*Math.PI;while(t<-Math.PI)t+=2*Math.PI;return Math.abs(t);};
 const weights:number[]=[];
 for(let i=0;i<n;i++) {
  const d=(i+.5)*ds;
  const grade=gradeAt(d),terrain=grade>0?grade*2:grade*1.1;
  const fatigue=s.fatigue?1+s.fatigue.percent/100*(i/n):1;
  const step=steps?stepAt(steps,d):null;
  const paceFactor=usesPace(s.sport)?(step&&step.step.pace&&s.pace>0?step.step.pace/s.pace:1):(step&&step.step.speed&&step.step.speed>0?s.speed/step.step.speed:1);
  const w=s.mode==='natural'?clamp((1+s.variation*waveAt(d)+terrain)*fatigue*paceFactor*(1+turnAt(d)*.08),.65,1.4):paceFactor;
  const strategy=s.paceStrategy??'even',progress=d/total;
  const strategyFactor=strategy==='negative-split'?1+.4*(.5-progress):strategy==='positive-split'?1-.4*(.5-progress):strategy==='segments'?(()=>{const targets=s.paceSegments!,target=targets[Math.min(targets.length-1,Math.floor(progress*targets.length))],mean=targets.reduce((sum,value)=>sum+value,0)/targets.length;return usesPace(s.sport)?target/mean:mean/target;})():1;
  const adjustedWeight=strategy==='even'?w:w*strategyFactor;
  weights.push(adjustedWeight);times.push(times[i]+adjustedWeight*ds);
 }
 const raw=times[n];for(let i=1;i<times.length;i++)times[i]=times[i]/raw*durationMs;
 // Bound memory on long activities and show the effective interval in the UI.
 const intervalMs=Math.max(s.sample*1000,Math.ceil(durationMs/49998)),samples=Math.ceil(durationMs/intervalMs);
 const points:Sample[]=[];
 for(let k=0;k<=samples;k++){
  const ms=Math.min(durationMs,k*intervalMs),i=Math.min(n,Math.max(1,lowerBound(times,ms)));
  const t=(ms-times[i-1])/(times[i]-times[i-1]),d=clamp((i-1+t)*ds,0,total);
  const point=atDistance(route,c,d);delete point.hr;const speed=ds/((times[i]-times[i-1])/1000),grade=gradeAt(d);
  points.push({...point,time:start+ms,distance:d,speed,...(usesPace(s.sport)?{gapPace:gradeAdjustedPace(1000/speed,grade)}:{})});
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
   const drift=Math.min(s.hrVariation*3,s.hrVariation*.03*Math.max(0,t-600)/60)*weatherHeat(s.weather);
   const hrTarget=steps?stepAt(steps,p.distance)?.step.hr:undefined;
   raw.push(walk+s.hrVariation*(2.4*ratio+16*grade)+(rest-s.hrAverage)*Math.exp(-t/50)+drift+(hrTarget!==undefined?hrTarget-s.hrAverage:0));
  });
  let sum=0;for(let i=1;i<points.length;i++)sum+=(raw[i]+raw[i-1])/2*(points[i].time-points[i-1].time);
  const mean=sum/durationMs;
  points.forEach((p,i)=>p.hr=Math.round(clamp(s.hrAverage+raw[i]-mean,30,240)));
 }
 // Estimated (not measured) power and cadence, derived deterministically from speed and grade.
 if(s.power?.enabled||s.cadence?.enabled){
  const mass=s.power?.weightKg??70,cda=s.profile==='mtb'?.45:.34;
  points.forEach(p=>{
   const v=Math.max(0,p.speed),grade=gradeAt(p.distance);
   if(s.power?.enabled){const watts=usesPace(s.sport)?mass*v*(.98+5*Math.max(0,grade)):v*(.005*mass*9.81+mass*9.81*grade+.5*1.225*cda*v*v)/.97;p.power=Math.round(clamp(watts,0,2000));}
   if(s.cadence?.enabled)p.cad=usesPace(s.sport)?Math.round(clamp(168+6*waveAt(p.distance),150,190)):Math.round(clamp(60+v*3.6*1.2+4*waveAt(p.distance),50,110));
  });
 }
 // Distance-anchored rest stops add elapsed time while moving pace excludes them.
 const rests=(a.pauses?.rests??[]).filter(r=>r.distance>0&&r.distance<total).sort((x,y)=>x.distance-y.distance);
 let stoppedMs=0;
 if(rests.length){
  const out:Sample[]=[];let shift=0,idx=0,last=points[0].time;
  const emit=(s:Sample)=>{out.push(s);last=s.time;};
  for(let i=0;i<points.length;i++){
   while(idx<rests.length&&rests[idx].distance<points[i].distance){
    const r=rests[idx],base=atDistance(route,c,r.distance),prev=points[i-1];
    const f=points[i].distance>prev.distance?(r.distance-prev.distance)/(points[i].distance-prev.distance):0;
    const tA=Math.max(prev.time+f*(points[i].time-prev.time)+shift,last+1);
    const carry=prev.hr!==undefined?{hr:prev.hr}:{},carryP=prev.power!==undefined?{power:prev.power}:{},carryC=prev.cad!==undefined?{cad:prev.cad}:{};
    emit({...base,time:tA,distance:r.distance,speed:0,...carry,...carryP,...carryC});
    emit({...base,time:tA+r.seconds*1000,distance:r.distance,speed:0,...carry,...carryP,...carryC});
    shift+=r.seconds*1000;stoppedMs+=r.seconds*1000;idx++;
   }
   emit({...points[i],time:points[i].time+shift});
  }
  for(let i=1;i<out.length;i++)if(out[i].time<=out[i-1].time)out[i].time=out[i-1].time+1;
  points.length=0;points.push(...out);
 }
 const gps=s.gps;
 // Estimated energy: a well-known distance formula for running, a speed-based MET estimate for riding.
 const mass=s.power?.weightKg??70,vKph=total/(durationMs/1000)*3.6;
 const calories=Math.round(usesPace(s.sport)?1.036*mass*(total/1000):Math.max(0,(vKph*.28+2)*mass*1.05*(durationMs/3600000)));
 return {points:applyDropout(applyGpsNoise(points,gps?.noise??0,s.seed),gps?.dropout??0,s.seed),duration:(durationMs+stoppedMs)/1000,distance:total,interval:intervalMs/1000,calories};
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
 if(a.workout)for(const st of expandWorkout(a.workout,total))if(st.end>0&&st.end<total-1e-6)values.push(st.end);
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
  const stopped=(a.pauses?.rests??[]).some(r=>r.distance>start&&r.distance<=end);
  const gapPace=usesPace(a.settings.sport)?averageGapPace(s.points,start,end):null;
   out.push({start,end,distance:end-start,duration,speed:duration>0?(end-start)/duration:0,gain:elevationStats(slice).gain,...(gapPace!==null?{gapPace}:{}),...(stopped?{stopped:true}:{})});
 }
 return out;
}

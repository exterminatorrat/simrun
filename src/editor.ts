import {t} from './i18n.js';
import type {Activity,LoopPlan,Point,RouteSource,Settings,Splits,Pauses,Workout,RouteData} from './types.js';
import {defaults} from './model.js';
import {closeLoop,cumulative,distance,isClosedLoop,nearestOnPath,outAndBack,validPoint} from './geometry.js';
import {resolveProfile,routeCapWarning,type RoutingProvider} from './providers.js';
import {MAX_ROUTE_WAYPOINTS,mergeRoutes,simplifyFreehand,splitRouteAtPoint,trimRouteByDistance,waypointsInRange} from './routeops.js';
import {failureMessage} from './messages.js';
type Snapshot={path:Point[];waypoints:Point[];source:RouteSource;loop?:LoopPlan;splits?:Splits;splitOutputs:Activity[];routeData?:RouteData};
export class Editor {
 activity:Activity=defaults();selected=-1;drawing=true;pending=false;status='Click the map to begin.';
 alternatesEnabled=false;alternatePaths:Point[][]=[];
 private past:Snapshot[]=[];private future:Snapshot[]=[];private controller:AbortController|null=null;private sequence=0;private timer:ReturnType<typeof setTimeout>|undefined;private splitOutputs:Activity[]=[];
 onChange:()=>void=()=>{};onMessage:(s:string)=>void=()=>{};
 onSplitOutputsChange:(outputs:Activity[],previous:Activity[],committed:boolean)=>void=()=>{};
 constructor(private provider:RoutingProvider){}
 get canUndo(){return this.past.length>0;}get canRedo(){return this.future.length>0;}
 private snapshot():Snapshot {const {path,waypoints,source,loop,splits,routeData}=this.activity;return {path,waypoints,source,loop,splits,routeData,splitOutputs:[...this.splitOutputs]};}
 private invalidate(){this.sequence++;this.controller?.abort();clearTimeout(this.timer);this.pending=false;}
 private notify(){this.activity.updatedAt=Date.now();this.onChange();}
 private checkpoint(){this.past.push(this.snapshot());if(this.past.length>35)this.past.shift();this.future=[];}
 load(a:Activity){this.invalidate();const previous=this.splitOutputs;this.splitOutputs=[];if(previous.length)this.onSplitOutputsChange([],previous,true);this.alternatePaths=[];this.activity=a;this.past=[];this.future=[];this.selected=-1;this.status=a.source==='imported'?t('Imported geometry · exports are simulated'):a.path.length?t('Route restored'):t('Click the map to begin.');this.notify();if(a.source==='draft'&&a.waypoints.length>=2)this.recalculate();}
 changeSettings(s:Partial<Settings>){const old=this.activity.settings.sport,oldProfile=this.activity.settings.profile;this.activity.settings={...this.activity.settings,...s};if(old!==this.activity.settings.sport&&s.profile===undefined)delete this.activity.settings.profile;this.notify();if((old!==this.activity.settings.sport||oldProfile!==this.activity.settings.profile)&&this.activity.source!=='imported'&&this.activity.waypoints.length>=2){this.activity.source='draft';this.recalculate();}}
 edit(points:Point[]){if(points.length>MAX_ROUTE_WAYPOINTS){this.onMessage(t('Use at most {count} routing waypoints.',{count:MAX_ROUTE_WAYPOINTS}));return;}if(!points.every(validPoint)){this.onMessage(t('Invalid waypoint.'));return;}this.checkpoint();this.invalidate();this.alternatePaths=[];this.activity.waypoints=points.map(({lat,lon})=>({lat,lon}));this.activity.source='draft';delete this.activity.routeData;if(points.length<2)this.activity.path=[];this.selected=Math.min(this.selected,points.length-1);this.notify();this.recalculate();}
 drawFreehand(points:Point[]):void {try{this.edit(simplifyFreehand(points));}catch(error){this.onMessage(failureMessage(error,'Freehand route could not be simplified — try a shorter stroke.'));}}
 trim(start:number,end:number):void {
  if(this.activity.source==='draft'||this.activity.path.length<2)throw Error(t('Resolve a route before trimming it.'));
  const next=trimRouteByDistance(this.activity.path,start,end);
  let waypoints=waypointsInRange(this.activity.path,this.activity.waypoints,start,end);
  if(this.activity.source==='routed'){
   const bounds=[next[0],next.at(-1)!];
   for(const p of waypoints)if(bounds.length<MAX_ROUTE_WAYPOINTS)bounds.splice(bounds.length-1,0,p);
   waypoints=bounds;
  }
  this.checkpoint();this.invalidate();this.alternatePaths=[];this.activity.path=next;this.activity.waypoints=waypoints;delete this.activity.routeData;delete this.activity.loop;delete this.activity.splits;this.selected=-1;this.status=t('Route trimmed');this.notify();
 }
 split(point:Point,id:string):Activity {
  if(this.activity.source==='draft'||this.activity.path.length<2)throw Error(t('Resolve a route before splitting it.'));
  if(!id||id===this.activity.id)throw Error(t('A new activity ID is required for the split route.'));
  const original=this.activity,c=cumulative(original.path),splitDistance=nearestOnPath(original.path,point,c);
  const [left,right]=splitRouteAtPoint(original.path,point);
  const leftWaypoints=waypointsInRange(original.path,original.waypoints,0,splitDistance),rightWaypoints=waypointsInRange(original.path,original.waypoints,splitDistance,c.at(-1)!);
  const makeWaypoints=(path:Point[],points:Point[])=>{
   if(original.source!=='routed')return points;
   const output=[path[0],...points,path.at(-1)!].filter((p,i,a)=>i===0||distance(a[i-1],p)>0.01);
   return output.length<=MAX_ROUTE_WAYPOINTS?output:[output[0],...output.slice(1,MAX_ROUTE_WAYPOINTS-1),output.at(-1)!];
  };
  const now=Date.now(),sibling:Activity={...original,id,name:`${original.name} · split`,createdAt:now,updatedAt:now,path:right,waypoints:makeWaypoints(right,rightWaypoints),settings:{...original.settings}};
  delete sibling.loop;delete sibling.splits;
  this.checkpoint();this.invalidate();this.alternatePaths=[];this.activity.path=left;this.activity.waypoints=makeWaypoints(left,leftWaypoints);delete this.activity.routeData;delete this.activity.loop;delete this.activity.splits;this.selected=-1;this.status=t('Route split');
  const previous=this.splitOutputs;this.splitOutputs=[...previous,sibling];this.onSplitOutputsChange(this.splitOutputs,previous,false);this.notify();
  return sibling;
 }
 async merge(other:Activity,maxGapMeters=100_000):Promise<void> {
  if(this.activity.source==='draft'||this.activity.path.length<2)throw Error(t('Resolve a route before merging it.'));
  if(other.id===this.activity.id)throw Error(t('Choose a different saved activity to merge.'));
  if(other.source==='draft')throw Error(t('Resolve the saved activity route before merging it.'));
  const first=[...this.activity.path],second=[...other.path],firstC=cumulative(first),secondC=cumulative(second);
  if(firstC.at(-1)!<1||secondC.at(-1)!<1)throw Error(t('Both activities need a route before merging.'));
  const gap=distance(first.at(-1)!,second[0]);
  if(gap>maxGapMeters)throw Error(t('Routes must be within {distance} km to merge.',{distance:Math.round(maxGapMeters/1000)}));
  this.invalidate();this.alternatePaths=[];const n=this.sequence;let connector:Point[]|undefined;
  if(gap>1){
   const profile=resolveProfile(this.activity.settings.sport,this.activity.settings.profile),controller=new AbortController();this.controller=controller;this.pending=true;this.status=t('Routing the gap between activities…');this.notify();
   try{connector=await this.provider.route([first.at(-1)!,second[0]],profile,controller.signal);if(n!==this.sequence)return;}
   catch(error){if(n!==this.sequence)return;this.pending=false;this.status=t('{message} Current route kept.',{message:failureMessage(error,'Merge failed — check the route and retry.')});this.notify();throw error;}
  }
  if(n!==this.sequence)return;
  let merged:Point[];
  try{merged=mergeRoutes(first,second,{maxGapMeters,endpointToleranceMeters:1,snapToleranceMeters:50,connector});}
  catch(error){this.pending=false;this.status=t('{message} Current route kept.',{message:failureMessage(error,'Merge failed — check the route and retry.')});this.notify();throw error;}
  this.checkpoint();this.pending=false;this.alternatePaths=[];delete this.activity.routeData;this.activity.path=merged;this.activity.waypoints=this.activity.source==='imported'||other.source==='imported'?[]:[merged[0],merged.at(-1)!];
  if(this.activity.source==='imported'||other.source==='imported')this.activity.source='imported';else this.activity.source='routed';
  delete this.activity.loop;delete this.activity.splits;this.selected=-1;this.status=t('Routes merged');this.notify();
 }
 add(p:Point){this.edit([...this.activity.waypoints,p]);}
 move(i:number,p:Point){this.selected=i;this.edit(this.activity.waypoints.map((v,j)=>i===j?p:v));}
 insert(i:number,p:Point){const pts=[...this.activity.waypoints];pts.splice(i+1,0,p);this.selected=i+1;this.edit(pts);}
 remove(i:number){this.edit(this.activity.waypoints.filter((_,j)=>j!==i));}
 reorder(i:number,d:number){const pts=[...this.activity.waypoints];if(i+d<0||i+d>=pts.length)return;[pts[i],pts[i+d]]=[pts[i+d],pts[i]];this.selected=i+d;this.edit(pts);}
 clear(){this.checkpoint();this.invalidate();this.activity.path=[];this.activity.waypoints=[];this.activity.source='draft';delete this.activity.routeData;this.selected=-1;this.status=t('Click the map to begin.');this.notify();}
 reverse(){if(this.activity.source==='imported'){this.checkpoint();this.activity.path=[...this.activity.path].reverse();this.notify();}else this.edit([...this.activity.waypoints].reverse());}
 outAndBack(){if(this.activity.source==='imported'){this.checkpoint();this.activity.path=outAndBack(this.activity.path);this.notify();}else this.edit(outAndBack(this.activity.waypoints));}
 closeLoop(){if(this.activity.source==='imported'){this.onMessage(t('Imported geometry is preserved. Use Waypoints → Convert to edit its road route.'));return;}const points=this.activity.waypoints;if(points.length<2){this.onMessage(t('Add at least two waypoints before closing a loop.'));return;}if(this.waypointsClosed()){this.onMessage(t('This route already returns to its start.'));return;}this.edit(closeLoop(points));}
 installRoute(waypoints:Point[],path:Point[]):void {
  if(waypoints.length<2||waypoints.length>50||!waypoints.every(validPoint)||path.length<2||path.length>100000)throw Error(t('A routed loop needs valid geometry and 2 to 50 waypoints.'));
  cumulative(path);this.checkpoint();this.invalidate();this.activity.waypoints=waypoints.map(({lat,lon})=>({lat,lon}));this.activity.path=path.map(point=>({...point}));this.activity.source='routed';delete this.activity.routeData;this.alternatePaths=[];this.selected=-1;this.status=t('Round trip ready');this.notify();
 }
 async refreshRouteData():Promise<void> {
  if(!this.provider.routeDetails||this.activity.path.length<2||this.activity.source==='draft')return;
  const path=this.activity.path,profile=resolveProfile(this.activity.settings.sport,this.activity.settings.profile),sequence=this.sequence;
  this.controller?.abort();const controller=new AbortController();this.controller=controller;
  const data=await this.provider.routeDetails(path,profile,controller.signal);
  if(sequence!==this.sequence||path!==this.activity.path)return;
  if(data.streetNames?.length||data.surfaceEdges?.length)this.activity.routeData=data;else delete this.activity.routeData;
  this.notify();
 }
 private loopLength():number{return this.activity.path.length>1?cumulative(this.activity.path).at(-1)??0:0;}
 private waypointsClosed():boolean{const w=this.activity.waypoints;return w.length>=2&&distance(w[0],w[w.length-1])<=5;}
 private closeRoutedPath(path:Point[]):Point[]{if(!path.length||!this.waypointsClosed()||isClosedLoop(path))return path;return [...path,path[0]];}
 startFor(index:number):number|null {
  if(!isClosedLoop(this.activity.path))return null;
  const p=this.activity.waypoints[index],total=this.loopLength();if(!p||!(total>0))return null;
  return (nearestOnPath(this.activity.path,p)/total)%1;
 }
 setLoop(plan:Partial<LoopPlan>|null):void {
  if(plan===null){if(this.activity.loop){this.checkpoint();delete this.activity.loop;this.notify();}return;}
  if(!isClosedLoop(this.activity.path)){this.onMessage(t('Close the loop before planning laps or a finish distance.'));return;}
  const base:LoopPlan=this.activity.loop??{start:0,mode:'distance',value:Math.round(this.loopLength())};
  const next:LoopPlan={...base,...plan};next.start=((next.start%1)+1)%1;
  if(!Number.isFinite(next.value)||next.value<=0){this.onMessage(next.mode==='laps'?t('Enter a loop count above zero.'):t('Enter a target distance above zero.'));return;}
  if(this.activity.loop?.start===next.start&&this.activity.loop.mode===next.mode&&this.activity.loop.value===next.value)return;
  this.checkpoint();this.activity.loop=next;this.notify();
 }
 setLoopMode(mode:'laps'|'distance'):void {
  const total=this.loopLength(),plan=this.activity.loop;
  if(!plan){this.setLoop({mode,value:mode==='laps'?1:Math.max(1,Math.round(total))});return;}
  if(plan.mode===mode)return;
  this.setLoop({mode,value:mode==='laps'?Math.max(.25,Math.round(plan.value/total*4)/4):Math.round(plan.value*total)});
 }
 setPauses(p:Pauses|null):void {if(p===null){if(this.activity.pauses){delete this.activity.pauses;this.notify();}return;}this.activity.pauses={rests:p.rests};this.notify();}
 setWorkout(w:Workout|null):void {if(w===null){if(this.activity.workout){delete this.activity.workout;this.notify();}return;}this.activity.workout=w;this.notify();}
 setTags(tags:string[]|undefined):void {if(tags&&tags.length)this.activity.tags=tags;else delete this.activity.tags;this.notify();}
 setSplits(plan:Partial<Splits>|null):void {
  if(plan===null){if(this.activity.splits){delete this.activity.splits;this.notify();}return;}
  const base=this.activity.splits??{auto:0,markers:[]},next={...base,...plan};
  if(!Number.isFinite(next.auto)||next.auto<0){this.onMessage(t('Enter an auto-split distance of zero or more.'));return;}
  const markers=[...new Set((next.markers??[]).filter(m=>Number.isFinite(m)&&m>0))].sort((x,y)=>x-y);
  if(markers.length>200){this.onMessage(t('Use at most 200 split markers.'));return;}
  this.activity.splits={auto:next.auto,markers};this.notify();
 }
 undo(){const s=this.past.pop();if(!s)return;this.future.push(this.snapshot());this.restore(s);}
 redo(){const s=this.future.pop();if(!s)return;this.past.push(this.snapshot());this.restore(s);}
 private restore(s:Snapshot){this.invalidate();this.alternatePaths=[];const previous=this.splitOutputs;Object.assign(this.activity,{path:s.path,waypoints:s.waypoints,source:s.source});if(s.routeData)this.activity.routeData=s.routeData;else delete this.activity.routeData;if(s.loop)this.activity.loop=s.loop;else delete this.activity.loop;if(s.splits)this.activity.splits=s.splits;else delete this.activity.splits;this.splitOutputs=[...s.splitOutputs];if(previous!==this.splitOutputs)this.onSplitOutputsChange(this.splitOutputs,previous,false);this.selected=-1;this.status=s.source==='draft'?t('Restoring waypoints…'):t('Route restored');this.notify();if(s.source==='draft')this.recalculate();}
 async recalculate(){
  this.invalidate();this.alternatePaths=[];if(this.activity.waypoints.length<2){this.status=this.activity.waypoints.length?t('Add another point to route.'):t('Click the map to begin.');this.notify();return;}
  const profile=resolveProfile(this.activity.settings.sport,this.activity.settings.profile);const advisory=routeCapWarning(profile,cumulative(this.activity.waypoints).at(-1)??0);if(advisory)this.onMessage(t(advisory));
  this.activity.source='draft';delete this.activity.routeData;this.pending=true;this.status=t('Finding accessible paths…');this.notify();const n=this.sequence;
  this.timer=setTimeout(async()=>{
   const controller=new AbortController();this.controller=controller;
   try{
    const paths=this.alternatesEnabled&&this.provider.alternates?await this.provider.alternates(this.activity.waypoints,profile,controller.signal):[await this.provider.route(this.activity.waypoints,profile,controller.signal)];
    if(n!==this.sequence)return;this.alternatePaths=paths.length>1?paths:[];
    const routed=this.closeRoutedPath(paths[0]);this.activity.path=routed;this.activity.source='routed';this.pending=false;this.status=this.provider.lastCached?t('Route ready · from offline cache'):this.alternatePaths.length?t('Route ready · alternate available'):t('Route ready · loading elevation');this.notify();
    if(this.provider.routeDetails)void this.provider.routeDetails(routed,profile,controller.signal).then(data=>{if(n!==this.sequence)return;if(data.streetNames?.length||data.surfaceEdges?.length)this.activity.routeData=data;else delete this.activity.routeData;this.notify();}).catch(()=>{});
    try{const elevated=await this.provider.elevation(routed,controller.signal);if(n!==this.sequence)return;this.activity.path=elevated;this.status=t('Route ready');this.notify();}
    catch(error){if(n!==this.sequence)return;this.status=t('Elevation unavailable — retry the route to load it.');this.notify();}
   }catch(error){if(n!==this.sequence)return;this.pending=false;this.status=t('Route unavailable — move a point or retry.');this.onMessage(failureMessage(error,'Network unavailable — check your connection and retry.'));this.notify();}
  },450);
 }
 /** Swaps in a previously fetched alternate route and reloads its elevation. */
 async selectAlternate(index:number):Promise<void>{
  const path=this.alternatePaths[index];if(!path)return;this.checkpoint();const n=this.sequence;this.activity.path=this.closeRoutedPath(path);delete this.activity.routeData;this.notify();
  const controller=new AbortController();this.controller=controller;
  if(this.provider.routeDetails)void this.provider.routeDetails(this.activity.path,resolveProfile(this.activity.settings.sport,this.activity.settings.profile),controller.signal).then(data=>{if(n!==this.sequence)return;if(data.streetNames?.length||data.surfaceEdges?.length)this.activity.routeData=data;else delete this.activity.routeData;this.notify();}).catch(()=>{});
  try{const elevated=await this.provider.elevation(this.activity.path,controller.signal);if(n!==this.sequence)return;this.activity.path=elevated;this.notify();}catch{}
 }
 dispose(){this.invalidate();}
}

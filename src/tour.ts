import type {Activity,RouteData,RouteSurfaceEdge} from './types.js';
import {plannedPath,startTime} from './model.js';
import {cumulative} from './geometry.js';
import {trimRouteByDistance,waypointsInRange} from './routeops.js';
import {t} from './i18n.js';

export const MAX_STAGES=31;

export interface StageResult { stages:Activity[]; notices:string[] }

function assertRoute(total:number):void {
 if(!Number.isFinite(total)||total<2)throw Error(t('Resolve a route before planning days.'));
}

export function evenStageBoundaries(total:number,days:number):number[] {
 assertRoute(total);
 if(!Number.isInteger(days)||days<2||days>MAX_STAGES)throw Error(t('Choose between 2 and {days} days.',{days:MAX_STAGES}));
 const length=total/days;
 if(length<1)throw Error(t('Each day needs at least one meter of route.'));
 return Array.from({length:days-1},(_,index)=>length*(index+1));
}

export function dailyStageBoundaries(total:number,perDayMeters:number):number[] {
 assertRoute(total);
 if(!Number.isFinite(perDayMeters)||perDayMeters<1)throw Error(t('Daily distance must be at least one meter.'));
 const days=Math.ceil(total/perDayMeters);
 if(days<2)throw Error(t('This route already fits in one day. Choose a smaller daily distance.'));
 if(days>MAX_STAGES)throw Error(t('That daily distance needs more than {days} days.',{days:MAX_STAGES}));
 return Array.from({length:days-1},(_,index)=>perDayMeters*(index+1));
}

function wallClock(epochMs:number,utcOffset:number):string {
 return new Date(epochMs+utcOffset*60000).toISOString().slice(0,16);
}

function clipRouteData(data:RouteData|undefined,from:number,to:number):RouteData|undefined {
 if(!data)return undefined;
 const streetNames=(data.streetNames??[]).filter(span=>span.end>from&&span.start<to).map(span=>({start:Math.max(span.start,from)-from,end:Math.min(span.end,to)-from,name:span.name}));
 const surfaceEdges:RouteSurfaceEdge[]=[];
 let cursor=0;
 for(const edge of data.surfaceEdges??[]){
  const start=cursor,end=cursor+edge.distance,length=Math.min(end,to)-Math.max(start,from);
  cursor=end;
  if(length>.01)surfaceEdges.push({...edge,distance:length});
 }
 return streetNames.length||surfaceEdges.length?{...(streetNames.length?{streetNames}:{}),...(surfaceEdges.length?{surfaceEdges}:{})}:undefined;
}

export function stageActivities(base:Activity,boundaries:number[],tourId:string):StageResult {
 if(!tourId||tourId.length>80)throw Error(t('A tour identifier is required.'));
 const path=plannedPath(base),total=cumulative(path).at(-1)??0;
 assertRoute(total);
 if(boundaries.length<1||boundaries.length>=MAX_STAGES)throw Error(t('A tour needs between 2 and {days} days.',{days:MAX_STAGES}));
 let previous=0;
 for(const cut of boundaries){
  if(!Number.isFinite(cut)||cut<=previous||cut>=total-1)throw Error(t('Stage boundaries must stay inside the route.'));
  previous=cut;
 }
 const edges=[0,...boundaries,total],settings=base.settings,baseStart=startTime(settings),days=edges.length-1,notices:string[]=[];
 if(base.workout)notices.push(t('Workout steps were removed because they are measured from the start of the full route.'));
 if(base.splits)notices.push(t('Split plans were removed because they are measured from the start of the full route.'));
 let restTotal=0;
 const stages=edges.slice(0,-1).map((from,index)=>{
  const to=edges[index+1];
  const rests=(base.pauses?.rests??[]).filter(rest=>rest.distance>=from&&rest.distance<to).map(rest=>({distance:rest.distance-from,seconds:rest.seconds}));
  restTotal+=rests.length;
  const routeData=clipRouteData(base.routeData,from,to);
  const stage:Activity={
   ...base,
   id:`${tourId}-d${index+1}`.slice(0,100),
   name:`${base.name} · Day ${index+1}`.slice(0,160),
   updatedAt:Date.now(),
   path:trimRouteByDistance(path,from,to),
   waypoints:waypointsInRange(path,base.waypoints,from,to),
   settings:{...settings,start:wallClock(baseStart+index*86400000,settings.utcOffset)},
   stage:{tourId,index:index+1,total:days}
  };
  delete stage.loop;delete stage.splits;delete stage.workout;
  if(rests.length)stage.pauses={rests};else delete stage.pauses;
  if(routeData)stage.routeData=routeData;else delete stage.routeData;
  return stage;
 });
 if(restTotal<(base.pauses?.rests.length??0))notices.push(t('Rest stops outside a day were dropped.'));
 return {stages,notices};
}

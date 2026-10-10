import {cumulative} from './geometry.js';
import {simulate,plannedPath} from './model.js';
import {usesPace} from './sports.js';
import type {Activity,Point,Sample,Simulation} from './types.js';

const pointFields=['ele','time','hr'] as const;
const sampleFields=['lat','lon','ele','time','hr','distance','speed','gapPace','power','cad'] as const;
interface PackedActivity extends Omit<Activity,'path'> { pathData:Float64Array; pathOrder:Uint8Array; pathLength:number }
interface SimulationRequest { activity:PackedActivity }
interface PackedSimulation extends Omit<Simulation,'points'> { pointData:Float64Array; pointOrder:Uint8Array; pointCount:number }
type SimulationResponse={simulation:PackedSimulation}|{error:string};

function requiresWorker(activity:Activity):boolean {
 if(activity.path.length>10000)return true;
 const distance=cumulative(plannedPath(activity)).at(-1)??0;
 const settings=activity.settings;
 const seconds=usesPace(settings.sport)?distance/1000*settings.pace:distance/1000/settings.speed*3600;
 return seconds/settings.sample>5000;
}

function packPath(points:Point[]):Promise<{data:Float64Array;order:Uint8Array}> {
 const data=new Float64Array(points.length*5),order=new Uint8Array(points.length*pointFields.length).fill(255);
 return new Promise(resolve=>{
  let start=0;
  const pack=():void=>{
   const end=Math.min(points.length,start+2500);
   for(let i=start;i<end;i++){
    const point=points[i],index=i*5;
    data[index]=point.lat;data[index+1]=point.lon;data[index+2]=point.ele??Number.NaN;data[index+3]=point.time??Number.NaN;data[index+4]=point.hr??Number.NaN;
    let field=0;
    for(const key of Object.keys(point)){const keyIndex=pointFields.indexOf(key as typeof pointFields[number]);if(keyIndex>=0)order[i*pointFields.length+field++]=keyIndex;}
   }
   start=end;
   if(start<points.length)setTimeout(pack,0);else resolve({data,order});
  };
  pack();
 });
}

function unpackSimulation(packed:PackedSimulation):Promise<Simulation> {
 const points:Sample[]=[];
 return new Promise(resolve=>{
  let start=0;
  const unpack=():void=>{
   const end=Math.min(packed.pointCount,start+2500);
   for(let i=start;i<end;i++){
    const index=i*sampleFields.length,point:Partial<Sample>={};
    for(let field=0;field<sampleFields.length;field++){
     const keyIndex=packed.pointOrder[index+field];
     if(keyIndex===255)break;
     const key=sampleFields[keyIndex];
     point[key]=Number.isNaN(packed.pointData[index+keyIndex])?undefined:packed.pointData[index+keyIndex];
    }
    points.push(point as Sample);
   }
   start=end;
   if(start<packed.pointCount)setTimeout(unpack,0);else resolve({points,duration:packed.duration,distance:packed.distance,interval:packed.interval,calories:packed.calories});
  };
  unpack();
 });
}

function runSynchronously(activity:Activity,resolve:(simulation:Simulation)=>void,reject:(error:unknown)=>void):void {
 try{resolve(simulate(activity));}catch(error){reject(error);}
}

export function simulateInWorker(activity:Activity):Simulation|Promise<Simulation> {
 if(!requiresWorker(activity)||typeof Worker==='undefined')return simulate(activity);
 let worker:Worker;
 try{worker=new Worker(new URL('./simulation-worker.js',import.meta.url),{type:'module'});}
 catch{return simulate(activity);}
 const {path:activityPath,...rest}=activity;
 return new Promise((resolve,reject)=>{
  let complete=false;
  const finish=(action:()=>void):void=>{if(complete)return;complete=true;worker.terminate();action();};
  worker.addEventListener('message',(event:MessageEvent<SimulationResponse>)=>{
   finish(()=>{if('simulation' in event.data)resolve(unpackSimulation(event.data.simulation));else reject(new Error(event.data.error));});
  },{once:true});
  worker.addEventListener('error',(event:ErrorEvent)=>{
   event.preventDefault();
   finish(()=>runSynchronously(activity,resolve,reject));
  },{once:true});
  worker.addEventListener('messageerror',()=>finish(()=>runSynchronously(activity,resolve,reject)),{once:true});
  void packPath(activityPath).then(path=>{
   if(complete)return;
   const request:SimulationRequest={activity:{...rest,pathData:path.data,pathOrder:path.order,pathLength:activityPath.length}};
   try{worker.postMessage(request,[path.data.buffer as ArrayBuffer,path.order.buffer as ArrayBuffer]);}
   catch{finish(()=>runSynchronously(activity,resolve,reject));}
  }).catch(()=>finish(()=>runSynchronously(activity,resolve,reject)));
 });
}

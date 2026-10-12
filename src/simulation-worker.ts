import {simulate} from './model.js';
import type {Activity,Point,Simulation} from './types.js';

const pointFields=['ele','time','hr'] as const;
const sampleFields=['lat','lon','ele','time','hr','distance','speed','gapPace','power','cad'] as const;
interface PackedActivity extends Omit<Activity,'path'> { pathData:Float64Array; pathOrder:Uint8Array; pathLength:number }
interface SimulationRequest { activity:PackedActivity }
interface PackedSimulation extends Omit<Simulation,'points'> { pointData:Float64Array; pointOrder:Uint8Array; pointCount:number }
type SimulationResponse={simulation:PackedSimulation}|{error:string};

const scope=globalThis as unknown as {
 addEventListener(type:'message',listener:(event:MessageEvent<SimulationRequest>)=>void):void;
 postMessage(message:SimulationResponse,transfer?:Transferable[]):void;
};

function unpackPath(data:Float64Array,order:Uint8Array,count:number):Point[] {
 const points:Point[]=[];
 for(let i=0;i<count;i++){
  const index=i*5,point:Point={lat:data[index],lon:data[index+1]};
  for(let field=0;field<pointFields.length;field++){
   const keyIndex=order[i*pointFields.length+field];
   if(keyIndex===255)break;
   const key=pointFields[keyIndex];
   point[key]=Number.isNaN(data[index+2+keyIndex])?undefined:data[index+2+keyIndex];
  }
  points.push(point);
 }
 return points;
}

function packSimulation(simulation:Simulation):PackedSimulation {
 const pointCount=simulation.points.length,pointData=new Float64Array(pointCount*sampleFields.length),pointOrder=new Uint8Array(pointCount*sampleFields.length).fill(255);
 for(let i=0;i<pointCount;i++){
  const point=simulation.points[i],index=i*sampleFields.length;
  pointData[index]=point.lat;pointData[index+1]=point.lon;pointData[index+2]=point.ele??Number.NaN;pointData[index+3]=point.time;pointData[index+4]=point.hr??Number.NaN;
  pointData[index+5]=point.distance;pointData[index+6]=point.speed;pointData[index+7]=point.gapPace??Number.NaN;pointData[index+8]=point.power??Number.NaN;pointData[index+9]=point.cad??Number.NaN;
  let field=0;
  for(const key of Object.keys(point)){const keyIndex=sampleFields.indexOf(key as typeof sampleFields[number]);if(keyIndex>=0)pointOrder[index+field++]=keyIndex;}
 }
 return {duration:simulation.duration,distance:simulation.distance,interval:simulation.interval,calories:simulation.calories??0,pointData,pointOrder,pointCount};
}

scope.addEventListener('message',event=>{
 try{
  const {pathData,pathOrder,pathLength,...activity}=event.data.activity,simulation=simulate({...activity,path:unpackPath(pathData,pathOrder,pathLength)});
  const result=packSimulation(simulation);
  scope.postMessage({simulation:result},[result.pointData.buffer as ArrayBuffer,result.pointOrder.buffer as ArrayBuffer]);
 }catch(error){scope.postMessage({error:error instanceof Error?error.message:'Simulation failed.'});}
});

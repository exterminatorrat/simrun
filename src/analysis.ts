import type {Activity, Sample, Simulation, Sport} from './types.js';
import {elevationStats} from './geometry.js';
import {plannedPath} from './model.js';

// Analysis helpers produce simulated estimates derived from the activity model, not measured values.

type HrZone = {index:number;min:number;max:number;seconds:number;percent:number};
type Histogram = {bins:{min:number;max:number;seconds:number}[];binSize:number;unit:string};
type UnitSplit = {start:number;end:number;distance:number;duration:number;pace:number;speed:number};
export type ActivityStats = {name:string;sport:Sport;distance:number;duration:number;avgSpeed:number;avgPace:number|null;elevationGain:number|null;avgHr:number|null;calories:number|null};

const round1=(v:number):number=>Math.round(v*10)/10;

function hrSegments(points:Sample[],hrMax:number):{seconds:number;byZone:number[]} {
  const byZone=[0,0,0,0,0];
  let seconds=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(!Number.isFinite(a.hr)||!Number.isFinite(b.hr))continue;
    const dt=(b.time-a.time)/1000;
    if(!(dt>0))continue;
    const mean=(a.hr!+b.hr!)/2;
    seconds+=dt;
    if(mean<hrMax*.5)continue;
    let zone=0;
    while(zone<4&&mean>=hrMax*(.5+.1*(zone+1)))zone++;
    byZone[zone]+=dt;
  }
  return {seconds,byZone};
}

export function hrZones(points:Sample[],hrMax:number):HrZone[] {
  const {seconds,byZone}=hrSegments(points,hrMax);
  return byZone.map((z,i)=>({
    index:i+1,min:Math.round(hrMax*(.5+.1*i)),max:Math.round(hrMax*(.5+.1*(i+1))),
    seconds:round1(z),percent:seconds>0?z/seconds*100:0,
  }));
}

export function belowZoneSeconds(points:Sample[],hrMax:number):number {
  let seconds=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(!Number.isFinite(a.hr)||!Number.isFinite(b.hr))continue;
    const dt=(b.time-a.time)/1000;
    if(dt>0&&(a.hr!+b.hr!)/2<hrMax*.5)seconds+=dt;
  }
  return round1(seconds);
}

export function paceHistogram(points:Sample[],sport:Sport,units:'metric'|'imperial'):Histogram[] {
  const metric=units==='metric',byPace=sport==='run';
  const binSize=byPace?(metric?10:15):1;
  const unit=byPace?(metric?'s/km':'s/mi'):(metric?'km/h':'mph');
  const valueAt=(p:Sample):number=>{
    if(!Number.isFinite(p.speed)||p.speed<=0)return NaN;
    return byPace?(metric?1000:1609.344)/p.speed:p.speed*(metric?3.6:2.2369362920544);
  };
  let total=0,min=Infinity,max=-Infinity;
  const buckets:{v:number;dt:number}[]=[];
  for(let i=0;i<points.length-1;i++){
    const v=valueAt(points[i]);
    if(!Number.isFinite(v))continue;
    const dt=(points[i+1].time-points[i].time)/1000;
    if(!(dt>0))continue;
    buckets.push({v,dt});
    total+=dt;
    if(v<min)min=v;
    if(v>max)max=v;
  }
  if(!buckets.length)return [{bins:[],binSize,unit}];
  const first=Math.floor(min/binSize),last=Math.ceil(max/binSize);
  // A constant value that sits exactly on a bin boundary yields last===first; keep at least one bin.
  const bins=Array.from({length:Math.max(1,last-first)},(_,k)=>({min:(first+k)*binSize,max:(first+k+1)*binSize,seconds:0}));
  for(const {v,dt} of buckets){
    const index=Math.max(0,Math.min(bins.length-1,Math.floor(v/binSize)-first));
    bins[index].seconds+=dt;
  }
  for(const bin of bins)bin.seconds=round1(bin.seconds);
  return [{bins,binSize,unit}];
}

export function perUnitSplits(sim:Simulation,unitMeters:number):UnitSplit[] {
  if(!Number.isFinite(unitMeters)||unitMeters<=0)throw Error('Split unit must be a positive distance.');
  if(!sim.points.length)return [];
  const points=sim.points;
  const timeAt=(d:number):number=>{
    if(d<=points[0].distance)return points[0].time;
    let lo=0,hi=points.length-1;
    if(d>=points[hi].distance)return points[hi].time;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(points[mid].distance<d)lo=mid;else hi=mid;}
    const a=points[lo],b=points[hi],span=b.distance-a.distance;
    return span>0?a.time+(d-a.distance)/span*(b.time-a.time):a.time;
  };
  const boundaries=[0];
  for(let k=1;k*unitMeters<sim.distance-1e-6;k++)boundaries.push(k*unitMeters);
  boundaries.push(sim.distance);
  const out:UnitSplit[]=[];
  for(let i=1;i<boundaries.length;i++){
    const start=boundaries[i-1],end=boundaries[i],distance=end-start;
    const duration=(timeAt(end)-timeAt(start))/1000;
    out.push({start,end,distance,duration,pace:distance>0&&duration>0?duration/(distance/1000):0,speed:duration>0?distance/duration:0});
  }
  return out;
}

function timeWeightedHr(points:Sample[]):number|null {
  let weighted=0,seconds=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(!Number.isFinite(a.hr)||!Number.isFinite(b.hr))continue;
    const dt=(b.time-a.time)/1000;
    if(!(dt>0))continue;
    weighted+=(a.hr!+b.hr!)/2*dt;
    seconds+=dt;
  }
  return seconds>0?weighted/seconds:null;
}

function caloriesFor(sport:Sport,speed:number,duration:number):number|null {
  if(!(duration>0))return null;
  const met=sport==='run'?1.03*speed*speed+3.5:8*Math.pow(speed*3.6/25,2.5);
  return Math.round(met*70*duration/3600);
}

function statsFor(entry:{activity:Activity;sim:Simulation}):ActivityStats {
  const {activity,sim}=entry;
  const distance=sim.distance,duration=sim.duration;
  const avgSpeed=duration>0?distance/duration:0;
  return {
    name:activity.name,
    sport:activity.settings.sport,
    distance,
    duration,
    avgSpeed,
    avgPace:activity.settings.sport==='run'&&distance>0?duration/(distance/1000):null,
    elevationGain:elevationStats(plannedPath(activity)).gain,
    avgHr:timeWeightedHr(sim.points),
    calories:caloriesFor(activity.settings.sport,avgSpeed,duration),
  };
}

export function compareActivities(left:{activity:Activity;sim:Simulation},right:{activity:Activity;sim:Simulation}):{left:ActivityStats;right:ActivityStats;delta:ActivityStats} {
  const a=statsFor(left),b=statsFor(right);
  const diff=(x:number|null,y:number|null):number|null=>x===null||y===null?null:y-x;
  return {
    left:a,
    right:b,
    delta:{
      name:'',sport:b.sport,
      distance:diff(a.distance,b.distance) as number,
      duration:diff(a.duration,b.duration) as number,
      avgSpeed:diff(a.avgSpeed,b.avgSpeed) as number,
      avgPace:diff(a.avgPace,b.avgPace),
      elevationGain:diff(a.elevationGain,b.elevationGain),
      avgHr:diff(a.avgHr,b.avgHr),
      calories:diff(a.calories,b.calories),
    },
  };
}

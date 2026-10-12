import type {Sample} from './types.js';

export function gradeCostFactor(grade:number):number {
 const g=Math.max(-.15,Math.min(.15,grade));
 return Math.max(.7,Math.min(1.5,1+4.5*g+13*g*g));
}

export function gradeAdjustedPace(paceSecondsPerKm:number,grade:number):number {
 return paceSecondsPerKm/gradeCostFactor(grade);
}

export function averageGapPace(points:Sample[],start=points[0]?.distance??0,end=points.at(-1)?.distance??0):number|null {
 let adjustedSeconds=0,distance=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],span=b.distance-a.distance;
  if(!(span>0)||!Number.isFinite(a.gapPace)||!Number.isFinite(b.gapPace))continue;
  const lo=Math.max(start,a.distance),hi=Math.min(end,b.distance),overlap=hi-lo;
  if(!(overlap>0))continue;
  const paceAt=(d:number)=>a.gapPace!+(b.gapPace!-a.gapPace!)*(d-a.distance)/span;
  adjustedSeconds+=overlap/1000*(paceAt(lo)+paceAt(hi))/2;
  distance+=overlap;
 }
 return distance>0?adjustedSeconds/(distance/1000):null;
}

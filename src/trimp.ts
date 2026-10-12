import type {Sample} from './types.js';

export const TRIMP_ALPHA=.64;
export const TRIMP_BETA=1.92;
export const DEFAULT_RESTING_HR=60;
export const DEFAULT_MAX_HR=190;

export interface TrimpHeartRates {restingHr?:number;maxHr?:number}

export function calculateTrimp(points:Sample[],heartRates:TrimpHeartRates={}):number|null {
 const restingHr=heartRates.restingHr??DEFAULT_RESTING_HR,maxHr=heartRates.maxHr??DEFAULT_MAX_HR;
 if(!Number.isFinite(restingHr)||!Number.isFinite(maxHr)||restingHr<30||restingHr>120||maxHr<100||maxHr>240||maxHr<=restingHr)throw Error('TRIMP heart-rate settings are invalid.');
 let score=0,hasHeartRate=false;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],seconds=(b.time-a.time)/1000;
  if(!Number.isFinite(a.hr)||!Number.isFinite(b.hr)||!(seconds>0))continue;
  const meanHr=(a.hr!+b.hr!)/2,reserve=Math.max(0,Math.min(1,(meanHr-restingHr)/(maxHr-restingHr)));
  score+=seconds/60*reserve*TRIMP_ALPHA*Math.exp(TRIMP_BETA*reserve);
  hasHeartRate=true;
 }
 return hasHeartRate?Math.round(score*10)/10:null;
}

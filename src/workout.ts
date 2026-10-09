import type {Workout,WorkoutStep} from './types.js';

export interface MatchedWorkout {scale:number;distance:number;exact:boolean}
export interface ExpandedStep {index:number;start:number;end:number;step:WorkoutStep}

/**
 * Workouts are simulation metadata describing how a simulated activity is paced,
 * not measured training data recorded from a real session.
 */
export function workoutDistance(w:Workout):number {
 return w.steps.reduce((total,step)=>total+step.distance,0);
}

export function matchWorkout(w:Workout,routeMeters:number):MatchedWorkout {
 if(w.steps.length===0)throw new Error('workout has no steps');
 if(!(routeMeters>0))throw new Error('route distance must be positive');
 const distance=workoutDistance(w);
 if(Math.abs(distance-routeMeters)<=routeMeters*0.005)return {scale:1,distance:routeMeters,exact:true};
 const scale=routeMeters/distance;
 return {scale,distance:distance*scale,exact:false};
}

export function expandWorkout(w:Workout,routeMeters:number):ExpandedStep[] {
 const match=matchWorkout(w,routeMeters);
 const residual=match.exact?routeMeters-workoutDistance(w):0;
 const expanded:ExpandedStep[]=[];
 let start=0;
 for(const [index,step] of w.steps.entries()){
  const distance=step.distance*match.scale+(index===w.steps.length-1?residual:0);
  expanded.push({index,start,end:start+distance,step:{...step,distance}});
  start=start+distance;
 }
 return expanded;
}

export function stepAt(steps:ExpandedStep[],distance:number):{index:number;step:WorkoutStep}|null {
 if(steps.length===0||distance<0)return null;
 if(distance>=steps[steps.length-1].end&&distance!==steps[steps.length-1].end)return null;
 for(const expanded of steps){
  if(distance<expanded.end||(expanded===steps[steps.length-1]&&distance===expanded.end))return {index:expanded.index,step:expanded.step};
 }
 return null;
}

export function workoutStepLabel(step:WorkoutStep):string {
 const km=(step.distance/1000).toFixed(2);
 const kind=step.kind==='work'?'Work':'Rest';
 if(step.pace!==undefined){
  const minutes=Math.floor(step.pace/60),seconds=Math.round(step.pace%60);
  return `${kind} ${km} km @ ${minutes}:${String(seconds).padStart(2,'0')}/km`;
 }
 return `${kind} ${km} km`;
}

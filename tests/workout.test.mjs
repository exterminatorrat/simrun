import test from 'node:test';
import assert from 'node:assert/strict';
import {workoutDistance,matchWorkout,expandWorkout,stepAt,workoutStepLabel} from '../dist/src/workout.js';

const step=(kind,distance,extra={})=>({kind,distance,...extra});
const workout=(...steps)=>({steps});

test('workoutDistance sums the step distances',()=>{
 assert.equal(workoutDistance(workout(step('work',1000),step('rest',200),step('work',800))),2000);
 assert.equal(workoutDistance(workout()),0);
});

test('a mismatch within 0.5 percent is absorbed into the last step',()=>{
 const w=workout(step('work',1000),step('rest',500));
 const route=1507;
 const match=matchWorkout(w,route);
 assert.equal(match.exact,true);
 assert.equal(match.scale,1);
 assert.equal(match.distance,route);
 const expanded=expandWorkout(w,route);
 assert.equal(expanded[1].end,route);
 assert.equal(expanded[1].end-expanded[1].start,507);
});

test('a large mismatch scales the workout uniformly to the route',()=>{
 const w=workout(step('work',1000),step('rest',500));
 const match=matchWorkout(w,2000);
 assert.equal(match.exact,false);
 assert.ok(Math.abs(match.scale-4/3)<1e-12);
 assert.equal(match.distance,2000);
 const expanded=expandWorkout(w,2000);
 assert.deepEqual(expanded.map(s=>s.end),[2000*2/3,2000]);
});

test('expandWorkout lays contiguous steps from zero to the route distance',()=>{
 const w=workout(step('work',100),step('rest',50),step('work',100));
 const route=300;
 const expanded=expandWorkout(w,route);
 assert.equal(expanded.length,3);
 assert.equal(expanded[0].start,0);
 assert.equal(expanded[2].end,route);
 expanded.forEach((s,i)=>assert.equal(s.end,s.start+s.step.distance));
 expanded.forEach((s,i)=>{if(i>0)assert.equal(s.start,expanded[i-1].end);});
});

test('stepAt finds the containing step with inclusive start and finish and exclusive end',()=>{
 const w=workout(step('work',100),step('rest',100));
 const expanded=expandWorkout(w,200);
 assert.equal(stepAt(expanded,0).index,0);
 assert.equal(stepAt(expanded,50).index,0);
 assert.equal(stepAt(expanded,100).index,1);
 assert.equal(stepAt(expanded,150).index,1);
 assert.equal(stepAt(expanded,200).index,1);
 assert.equal(stepAt(expanded,200.001),null);
 assert.equal(stepAt(expanded,-1),null);
});

test('invalid workouts and routes throw',()=>{
 assert.throws(()=>matchWorkout(workout(),1000),/no steps/);
 assert.throws(()=>matchWorkout(workout(step('work',100)),0),/positive/);
 assert.throws(()=>matchWorkout(workout(step('work',100)),-5),/positive/);
});

test('labels name the step kind and show distance and pace for work steps',()=>{
 assert.equal(workoutStepLabel(step('work',1000,{pace:300})),'Work 1.00 km @ 5:00/km');
 assert.equal(workoutStepLabel(step('rest',200)),'Rest 0.20 km');
});

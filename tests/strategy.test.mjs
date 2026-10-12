import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {computeSplits,defaults,durationFor,simulate,validateActivity,validateSettings} from '../dist/src/model.js';
import {averageGapPace,gradeAdjustedPace,gradeCostFactor} from '../dist/src/gap.js';
import {compareActivities} from '../dist/src/analysis.js';

const route=[{lat:0,lon:0,ele:0},{lat:0,lon:.045,ele:0}];
function activity(sport='run') {
 const a=defaults();a.path=route;a.waypoints=route;a.source='routed';
 a.settings={...a.settings,sport,start:'2024-01-02T03:04',utcOffset:0,seed:1202,mode:'constant',variation:0,pace:300,speed:24,hrEnabled:true,hrAverage:150,hrVariation:0};
 return a;
}
function halves(sim) {
 const middle=sim.points.find(point=>point.distance>=sim.distance/2),last=sim.points.at(-1);
 return [middle.time-sim.points[0].time,last.time-middle.time];
}
function meanSpeed(sim,start,end) {
 const points=sim.points.filter(point=>point.distance>=start&&point.distance<end);
 return points.reduce((sum,point)=>sum+point.speed,0)/points.length;
}

test('even strategy preserves the captured pre-feature default-seed output',()=>{
 const a=defaults();a.settings={...a.settings,start:'2024-01-02T03:04',utcOffset:0,seed:1202};
 a.path=[{lat:37,lon:-122,ele:8},{lat:37.005,lon:-121.995,ele:24},{lat:37.01,lon:-121.985,ele:11},{lat:37.02,lon:-121.98,ele:32}];a.waypoints=a.path;
 const sim=simulate(a),splits=computeSplits(a,sim);
 const legacy={sim:{...sim,points:sim.points.map(({gapPace,...point})=>point)},splits:splits.map(({gapPace,...split})=>split)};
 const digest=Array.from(createHash('sha256').update(JSON.stringify(legacy)).digest());
 assert.deepEqual(digest,[139,171,13,100,6,100,66,127,158,143,148,250,43,150,91,53,3,83,148,4,86,170,58,70,90,7,90,164,164,68,255,216]);
 assert.equal(sim.points.length,445);
});

test('negative and positive splits change timing shape and normalize requested duration',()=>{
 const base=activity(),even=simulate(base);
 const negative=simulate({...base,settings:{...base.settings,paceStrategy:'negative-split'}});
 const positive=simulate({...base,settings:{...base.settings,paceStrategy:'positive-split'}});
 assert.ok(halves(negative)[0]>halves(negative)[1]);
 assert.ok(halves(positive)[0]<halves(positive)[1]);
 for(const sim of [even,negative,positive]){
  assert.ok(Math.abs(sim.duration-durationFor(sim.distance,'run',base.settings.pace,base.settings.speed))<=.001);
  assert.ok(sim.points.every((point,index)=>index===0||point.time>sim.points[index-1].time));
 }
 assert.deepEqual(negative,simulate({...base,settings:{...base.settings,paceStrategy:'negative-split'}}));
});

test('equal-distance segment targets shape run pace and cycling speed',()=>{
 const run=activity();run.settings={...run.settings,paceStrategy:'segments',paceSegments:[360,300,240]};
 const running=simulate(run),third=running.distance/3;
 assert.ok(meanSpeed(running,0,third)<meanSpeed(running,third,third*2));
 assert.ok(meanSpeed(running,third,third*2)<meanSpeed(running,third*2,running.distance));
 const ride=activity('ride');ride.settings={...ride.settings,paceStrategy:'segments',paceSegments:[10,20,30]};
 const cycling=simulate(ride),rideThird=cycling.distance/3;
 assert.ok(meanSpeed(cycling,0,rideThird)<meanSpeed(cycling,rideThird,rideThird*2));
 assert.ok(meanSpeed(cycling,rideThird,rideThird*2)<meanSpeed(cycling,rideThird*2,cycling.distance));
 for(const [a,sim] of [[run,running],[ride,cycling]])assert.ok(Math.abs(sim.duration-durationFor(sim.distance,a.settings.sport,a.settings.pace,a.settings.speed))<=.001);
});

test('pace strategy and target validation rejects unknown, missing, or invalid segments',()=>{
 const settings=activity().settings;
 assert.doesNotThrow(()=>validateSettings(settings));
 assert.throws(()=>validateSettings({...settings,paceStrategy:'fast'}));
 assert.throws(()=>validateSettings({...settings,paceStrategy:'segments'}));
 assert.throws(()=>validateSettings({...settings,paceStrategy:'segments',paceSegments:[300]}));
 assert.throws(()=>validateSettings({...settings,paceStrategy:'segments',paceSegments:[300,3601]}));
 assert.throws(()=>validateSettings({...settings,paceSegments:[300,320]}));
 assert.throws(()=>validateSettings({...settings,paceStrategy:'segments',paceSegments:Array(51).fill(300)}));
});

test('GAP uses a bounded grade-cost model and appears in samples, splits, and analysis',()=>{
 assert.equal(gradeCostFactor(0),1);
 assert.ok(gradeCostFactor(.05)>1&&gradeCostFactor(.15)<=1.5);
 assert.ok(gradeCostFactor(-.05)<1&&gradeCostFactor(-.15)>=.7);
 assert.ok(gradeAdjustedPace(300,.05)<300);
 assert.ok(gradeAdjustedPace(300,-.05)>300);
 const a=activity();a.path=[{lat:0,lon:0,ele:0},{lat:0,lon:.045,ele:100}];a.waypoints=a.path;a.splits={auto:1000,markers:[]};
 const sim=simulate(a),splits=computeSplits(a,sim);
 assert.ok(sim.points.every(point=>Number.isFinite(point.gapPace)));
 assert.ok(splits.every(split=>Number.isFinite(split.gapPace)));
 assert.ok(averageGapPace(sim.points)>0);
 const stats=compareActivities({activity:a,sim},{activity:a,sim}).left;
 assert.ok(stats.avgGapPace>0);
 assert.ok(stats.trimp>0);
});

test('activity descriptions are capped by activity validation',()=>{
 const a=activity();
 assert.equal(validateActivity({...a,description:'note'.repeat(600)}).description.length,2000);
 assert.throws(()=>validateActivity({...a,description:12}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {dailyStageBoundaries,evenStageBoundaries,MAX_STAGES,stageActivities} from '../dist/src/tour.js';
import {defaults,plannedPath,validateActivity} from '../dist/src/model.js';
import {cumulative} from '../dist/src/geometry.js';

const line=Array.from({length:11},(_,i)=>({lat:0,lon:i*.001}));

function activity(points=line){
 const a=defaults();
 a.id='tour-base';a.name='Coast tour';a.path=points.map(p=>({...p}));a.source='routed';
 a.settings.start='2026-05-01T08:00';a.settings.utcOffset=120;
 return a;
}
const total=(path)=>cumulative(path).at(-1);

test('even days split the route into equal interior boundaries',()=>{
 const length=total(line),cuts=evenStageBoundaries(length,4);
 assert.equal(cuts.length,3);
 cuts.forEach((cut,index)=>assert.ok(Math.abs(cut-length/4*(index+1))<1e-9));
 assert.throws(()=>evenStageBoundaries(length,1),/Choose between 2 and 31 days/);
 assert.throws(()=>evenStageBoundaries(length,MAX_STAGES+1),/Choose between 2 and 31 days/);
 assert.throws(()=>evenStageBoundaries(1.5,2),/Resolve a route/);
 assert.throws(()=>evenStageBoundaries(3,4),/at least one meter/);
});

test('daily distance uses ceiling days and leaves the remainder on the last day',()=>{
 const cuts=dailyStageBoundaries(2500,1000);
 assert.deepEqual(cuts,[1000,2000]);
 assert.equal(dailyStageBoundaries(3001,1000).length,3);
 assert.throws(()=>dailyStageBoundaries(900,1000),/already fits in one day/);
 assert.throws(()=>dailyStageBoundaries(50_000,1000),/more than 31 days/);
 assert.throws(()=>dailyStageBoundaries(2500,0),/at least one meter/);
});

test('stages cover the route once with unique ids, names, and consecutive day starts',()=>{
 const base=activity(),length=total(line),{stages,notices}=stageActivities(base,evenStageBoundaries(length,3),'tour-1');
 assert.equal(stages.length,3);
 assert.deepEqual(notices,[]);
 assert.equal(new Set(stages.map(stage=>stage.id)).size,3);
 assert.deepEqual(stages.map(stage=>stage.name),['Coast tour · Day 1','Coast tour · Day 2','Coast tour · Day 3']);
 assert.deepEqual(stages.map(stage=>stage.settings.start),['2026-05-01T08:00','2026-05-02T08:00','2026-05-03T08:00']);
 assert.deepEqual(stages.map(stage=>stage.stage),[1,2,3].map(index=>({tourId:'tour-1',index,total:3})));
 const sum=stages.reduce((meters,stage)=>meters+total(stage.path),0);
 assert.ok(Math.abs(sum-length)<.01);
 assert.deepEqual(stages[0].path[0],line[0]);
 assert.deepEqual(stages.at(-1).path.at(-1),line.at(-1));
 assert.ok(stages.every(stage=>stage.loop===undefined&&stage.splits===undefined&&stage.workout===undefined));
});

test('rest stops re-base onto their day and stops at the route end are dropped',()=>{
 const base=activity(),length=total(line);
 base.pauses={rests:[{distance:150,seconds:60},{distance:900,seconds:120},{distance:length,seconds:30}]};
 const {stages,notices}=stageActivities(base,evenStageBoundaries(length,2),'tour-2');
 assert.deepEqual(stages[0].pauses.rests,[{distance:150,seconds:60}]);
 assert.equal(stages[1].pauses.rests.length,1);
 assert.ok(Math.abs(stages[1].pauses.rests[0].distance-(900-length/2))<1e-6);
 assert.deepEqual(notices,['Rest stops outside a day were dropped.']);
});

test('street names and surface edges are clipped to each day',()=>{
 const base=activity(),length=total(line);
 base.routeData={streetNames:[{start:0,end:length*.5,name:'Shore'},{start:length*.5,end:length,name:'Ridge'}],surfaceEdges:[{distance:length*.5,surface:'paved'},{distance:length*.5,surface:'gravel'}]};
 const {stages}=stageActivities(base,evenStageBoundaries(length,2),'tour-3');
 assert.deepEqual(stages[0].routeData.streetNames,[{start:0,end:length*.5,name:'Shore'}]);
 assert.deepEqual(stages[1].routeData.streetNames,[{start:0,end:length*.5,name:'Ridge'}]);
 for(const stage of stages){
  const edges=stage.routeData.surfaceEdges;
  assert.equal(edges.length,1);
  assert.ok(Math.abs(edges[0].distance-length*.5)<.01);
 }
 assert.equal(stages[0].routeData.surfaceEdges[0].surface,'paved');
 assert.equal(stages[1].routeData.surfaceEdges[0].surface,'gravel');
});

test('workout and split plans are removed with a notice instead of being reinterpreted',()=>{
 const base=activity(),length=total(line);
 base.workout={steps:[{kind:'work',distance:length,pace:300}]};
 base.splits={auto:1000,markers:[500]};
 const {stages,notices}=stageActivities(base,evenStageBoundaries(length,2),'tour-4');
 assert.ok(stages.every(stage=>stage.workout===undefined&&stage.splits===undefined));
 assert.deepEqual(notices,[
  'Workout steps were removed because they are measured from the start of the full route.',
  'Split plans were removed because they are measured from the start of the full route.',
 ]);
});

test('a loop plan is materialized before the route is split',()=>{
 const ring=[{lat:0,lon:0},{lat:0,lon:.002},{lat:.002,lon:.002},{lat:.002,lon:0},{lat:0,lon:0}];
 const base=activity(ring);
 base.loop={start:0,mode:'laps',value:2};
 const length=total(plannedPath(base));
 const {stages}=stageActivities(base,evenStageBoundaries(length,2),'tour-5');
 const sum=stages.reduce((meters,stage)=>meters+total(stage.path),0);
 assert.ok(Math.abs(sum-length)<.01);
 assert.ok(stages.every(stage=>stage.loop===undefined));
});

test('stage boundaries must stay strictly inside the route',()=>{
 const base=activity(),length=total(line);
 assert.throws(()=>stageActivities(base,[0,length*.5],'tour-6'),/inside the route/);
 assert.throws(()=>stageActivities(base,[length*.5,length*.5],'tour-7'),/inside the route/);
 assert.throws(()=>stageActivities(base,[length],'tour-8'),/inside the route/);
 assert.throws(()=>stageActivities(base,[],'tour-9'),/between 2 and 31 days/);
 assert.throws(()=>stageActivities(base,[length*.5],''),/identifier/);
});

test('a stage round-trips through validation and rejects impossible references',()=>{
 const base=activity(),{stages}=stageActivities(base,evenStageBoundaries(total(line),2),'tour-10'),stage=stages[0];
 assert.deepEqual(validateActivity(stage).stage,{tourId:'tour-10',index:1,total:2});
 assert.throws(()=>validateActivity({...stage,stage:{tourId:'tour-10',index:0,total:2}}),/stage reference/);
 assert.throws(()=>validateActivity({...stage,stage:{tourId:'tour-10',index:3,total:2}}),/stage reference/);
 assert.throws(()=>validateActivity({...stage,stage:{tourId:'tour-10',index:1,total:1}}),/stage reference/);
});

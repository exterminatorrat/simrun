import test from 'node:test';
import assert from 'node:assert/strict';
import {Editor} from '../dist/src/editor.js';
import {defaults} from '../dist/src/model.js';
import {cumulative, isClosedLoop, resample} from '../dist/src/geometry.js';
import {loopPlan} from '../dist/src/model.js';
const a={lat:0,lon:0},b={lat:0,lon:.045},c={lat:.01,lon:.045};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const provider={route:async p=>p,elevation:async p=>p};
test('imported reverse/out-and-back and undo retain settings and geometry',()=>{const e=new Editor(provider),x=defaults();x.path=[a,b,c];x.source='imported';e.load(x);e.reverse();assert.deepEqual(e.activity.path,[c,b,a]);e.undo();assert.deepEqual(e.activity.path,[a,b,c]);e.redo();assert.deepEqual(e.activity.path,[c,b,a]);e.outAndBack();assert.equal(e.activity.path.length,5);e.clear();assert.equal(e.activity.path.length,0);e.undo();assert.equal(e.activity.path.length,5);assert.equal(e.activity.settings.pace,300);e.dispose();});
test('route editing pushes one undo state per settled edit',()=>{const e=new Editor(provider);e.add(a);e.add(b);e.move(1,c);assert.deepEqual(e.activity.waypoints,[a,c]);e.undo();assert.deepEqual(e.activity.waypoints,[a,b]);e.redo();assert.deepEqual(e.activity.waypoints,[a,c]);e.remove(0);assert.equal(e.activity.waypoints.length,1);e.dispose();});
test('closing a loop returns to the start once and ignores imported geometry',()=>{const e=new Editor(provider);e.add(a);e.add(b);e.closeLoop();assert.deepEqual(e.activity.waypoints,[a,b,a]);e.undo();assert.deepEqual(e.activity.waypoints,[a,b]);let message='';e.onMessage=m=>message=m;e.closeLoop();assert.deepEqual(e.activity.waypoints,[a,b,a]);e.closeLoop();assert.deepEqual(e.activity.waypoints,[a,b,a]);assert.match(message,/already returns/);const x=defaults();x.path=[a,b,c];x.source='imported';e.load(x);e.closeLoop();assert.equal(e.activity.path.length,3);assert.match(message,/Convert/);e.dispose();});
const square=[{lat:0,lon:0},{lat:0,lon:.01},{lat:.01,lon:.01},{lat:.01,lon:0},{lat:0,lon:0}];
test('loop plan sets laps, converts to distance, pins the start and survives an edit',async()=>{
 const e=new Editor(provider);e.edit(square);await sleep(480);
 const total=cumulative(e.activity.path).at(-1);
 e.setLoopMode('laps');assert.deepEqual(e.activity.loop,{start:0,mode:'laps',value:1});
 e.setLoop({mode:'laps',value:4});assert.equal(loopPlan(e.activity).laps,4);
 e.setLoopMode('distance');assert.equal(e.activity.loop.mode,'distance');assert.ok(Math.abs(e.activity.loop.value-4*total)<1);
 e.setLoop({mode:'distance',value:2*total});assert.ok(Math.abs(loopPlan(e.activity).laps-2)<1e-9);
 assert.equal(e.startFor(0),0);const f=e.startFor(2);assert.ok(f>.4&&f<.6);
 e.setLoop({start:f});assert.ok(Math.abs(e.activity.loop.start-f)<1e-12);
 e.move(1,{lat:.02,lon:0});assert.ok(e.activity.loop);await sleep(480);assert.ok(loopPlan(e.activity).laps>1);
 let message='';e.onMessage=m=>message=m;e.edit([a,b]);await sleep(480);e.setLoopMode('laps');assert.match(message,/Close the loop/);assert.equal(e.activity.loop.mode,'distance');
 e.setLoop(null);assert.equal(e.activity.loop,undefined);
 e.dispose();
});
test('stale routing response cannot overwrite a newer edit',async()=>{const pending=[];const e=new Editor({route:(p,s,signal)=>new Promise(resolve=>pending.push({resolve,p,signal})),elevation:async p=>p});e.edit([a,b]);await sleep(480);assert.equal(pending.length,1);e.move(1,c);assert.equal(pending[0].signal.aborted,true);await sleep(480);assert.equal(pending.length,2);pending[1].resolve([a,c]);await sleep(10);pending[0].resolve([a,b]);await sleep(10);assert.deepEqual(e.activity.path,[a,c]);assert.equal(e.pending,false);assert.equal(e.activity.source,'routed');e.dispose();});
test('route failure leaves editable waypoints and never blesses straight lines as roads',async()=>{const e=new Editor({route:async()=>{throw Error('Unavailable');},elevation:async p=>p});let message='';e.onMessage=m=>message=m;e.edit([a,b]);await sleep(480);assert.equal(e.pending,false);assert.equal(e.activity.source,'draft');assert.equal(e.activity.path.length,0);assert.equal(e.activity.waypoints.length,2);assert.match(message,/Network unavailable — check your connection and retry/);e.dispose();});
test('a routed loop stays a loop when the router returns an open seam',async()=>{
 const s={lat:0,lon:0},n={lat:0,lon:.01},east={lat:.01,lon:.01},south={lat:.01,lon:0};
 const seam={lat:0,lon:.0015};
 const routed=[s,n,east,south,seam];
 const e=new Editor({route:async()=>routed,elevation:async p=>p});
 e.edit([s,n,east,south,s]);await sleep(480);
 assert.equal(e.activity.waypoints.length,5);
 assert.equal(isClosedLoop(e.activity.path),true);
 e.setLoop({mode:'laps',value:2});
 assert.equal(loopPlan(e.activity).laps,2);
 let message='';e.onMessage=m=>message=m;
 e.closeLoop();assert.match(message,/already returns/);
 assert.equal(e.activity.waypoints.length,5);
 e.dispose();
});

test('trim geometry and route-dependent plans round-trip through undo and redo',()=>{
 const e=new Editor(provider),x=defaults();x.path=[a,b,c];x.waypoints=[a,b,c];x.source='routed';x.loop={start:0,mode:'laps',value:2};x.splits={auto:100,markers:[200]};e.load(x);
 const before=[...e.activity.path],total=cumulative(before).at(-1);
 e.trim(total*.2,total*.8);
 const trimmed=[...e.activity.path];assert.ok(Math.abs(cumulative(trimmed).at(-1)-total*.6)<.01);assert.equal(e.activity.loop,undefined);assert.equal(e.activity.splits,undefined);
 e.undo();assert.deepEqual(e.activity.path,before);assert.deepEqual(e.activity.loop,x.loop);assert.deepEqual(e.activity.splits,x.splits);
 e.redo();assert.deepEqual(e.activity.path,trimmed);e.dispose();
});

test('split geometry and its local sibling round-trip through undo and redo',()=>{
 const e=new Editor(provider),x=defaults();x.path=[a,b,c];x.waypoints=[a,b,c];x.source='routed';e.load(x);
 let active=[];e.onSplitOutputsChange=(next,previous,committed)=>{active=next.map(item=>item.id);};
 const sibling=e.split({lat:0,lon:.015},'split-1');
 assert.equal(e.activity.path.at(-1).lon,sibling.path[0].lon);assert.equal(sibling.path.at(-1).lon,c.lon);assert.deepEqual(active,['split-1']);
 const first=[...e.activity.path];e.undo();assert.deepEqual(e.activity.path,[a,b,c]);assert.deepEqual(active,[]);
 e.redo();assert.deepEqual(e.activity.path,first);assert.deepEqual(active,['split-1']);e.dispose();
});

test('merge routes the gap through the provider and undo restores both route geometry states',async()=>{
 const first=[a,b],other={...defaults(),id:'other',source:'imported',path:[c,{lat:0,lon:.03}]};let routed;
 const e=new Editor({route:async points=>{routed=points;return [points[0],{lat:.01,lon:.025},points[1]];},elevation:async p=>p});
 const x=defaults();x.source='imported';x.path=first;e.load(x);await e.merge(other);
 assert.deepEqual(routed,[b,c]);assert.deepEqual(e.activity.path,[a,b,{lat:.01,lon:.025},c,other.path[1]]);
 const merged=[...e.activity.path];e.undo();assert.deepEqual(e.activity.path,first);e.redo();assert.deepEqual(e.activity.path,merged);e.dispose();
});

test('freehand simplification routes through the normal provider path',async()=>{
 let routed=0;const e=new Editor({route:async p=>{routed++;return p;},elevation:async p=>p});
 const points=Array.from({length:40},(_,i)=>({lat:0,lon:i*.001}));e.drawFreehand(points);
 assert.equal(e.activity.source,'draft');assert.equal(e.activity.waypoints.length,2);await sleep(480);assert.equal(routed,1);assert.equal(e.activity.source,'routed');e.dispose();
});

test('a pending merge cannot overwrite a newer edit',async()=>{
 let resolve;const e=new Editor({route:()=>new Promise(r=>resolve=r),elevation:async p=>p}),x=defaults();x.source='imported';x.path=[a,b];e.load(x);
 const d={lat:0,lon:.06},other={...defaults(),id:'other',source:'imported',path:[c,d]},merge=e.merge(other);e.edit([a,c]);resolve([b,{lat:.01,lon:.05},c]);await merge;
 assert.deepEqual(e.activity.waypoints,[a,c]);assert.equal(e.activity.source,'draft');assert.equal(e.pending,true);e.dispose();
});

test('freehand simplification limit reports a message without starting a route request',()=>{
 const e=new Editor(provider);let message='';e.onMessage=m=>message=m;const points=Array.from({length:60},(_,i)=>({lat:i%2?.001:-.001,lon:i*.0001}));e.drawFreehand(points);assert.match(message,/at most 50 points/);assert.equal(e.activity.waypoints.length,0);assert.equal(e.pending,false);e.dispose();
});

test('new route edits discard alternate geometry from an earlier route',()=>{
 const e=new Editor(provider);e.alternatePaths=[[a,b]];e.edit([a,c]);assert.deepEqual(e.alternatePaths,[]);e.dispose();
});


const routeActivity=points=>{const x=defaults();x.path=structuredClone(points);x.waypoints=structuredClone(points);x.source='routed';return x;};
const verifyGeometryHistory=async(e,edit)=>{
 const before=structuredClone(e.activity.path);
 edit(e);
 await sleep(480);
 const after=structuredClone(e.activity.path);
 assert.notDeepEqual(after,before);
 e.undo();
 assert.deepEqual(e.activity.path,before);
 e.redo();
 await sleep(480);
 assert.deepEqual(e.activity.path,after);
};

test('add, move, insert, delete, and reorder round-trip route geometry',async()=>{
 const edits=[
  e=>e.add({lat:.02,lon:.03}),
  e=>e.move(1,{lat:.02,lon:.01}),
  e=>e.insert(1,{lat:.02,lon:.03}),
  e=>e.remove(1),
  e=>e.reorder(1,-1)
 ];
 for(const edit of edits){const e=new Editor(provider);e.load(routeActivity([a,b,c]));await verifyGeometryHistory(e,edit);e.dispose();}
});

test('clear, reverse, and out-and-back round-trip imported geometry',()=>{
 for(const edit of [e=>e.clear(),e=>e.reverse(),e=>e.outAndBack()]){
  const e=new Editor(provider),activity=defaults();activity.path=[a,b,c];activity.source='imported';e.load(activity);
  const before=structuredClone(e.activity.path);edit(e);const after=structuredClone(e.activity.path);
  assert.notDeepEqual(after,before);e.undo();assert.deepEqual(e.activity.path,before);e.redo();assert.deepEqual(e.activity.path,after);e.dispose();
 }
});

test('loop closure, freehand edits, and imported conversion round-trip route geometry',async()=>{
 const loopEditor=new Editor(provider);loopEditor.load(routeActivity([a,b,c]));await verifyGeometryHistory(loopEditor,e=>e.closeLoop());loopEditor.dispose();
 const freehandEditor=new Editor(provider);freehandEditor.load(routeActivity([a,b,c]));await verifyGeometryHistory(freehandEditor,e=>e.drawFreehand(Array.from({length:40},(_,i)=>({lat:i*.0001,lon:i*.001}))));freehandEditor.dispose();
 const imported=defaults();imported.source='imported';imported.path=[a,{lat:.003,lon:.01},b,c,{lat:.02,lon:.05}];
 const convertEditor=new Editor({route:async points=>points.map(point=>({lat:point.lat+.001,lon:point.lon})),elevation:async points=>points});convertEditor.load(imported);
 await verifyGeometryHistory(convertEditor,e=>e.edit(resample(imported.path,Math.min(8,imported.path.length))));convertEditor.dispose();
});

test('loop plans are undoable and redoable without changing route geometry',()=>{
 const e=new Editor(provider),activity=routeActivity(square);e.load(activity);const geometry=structuredClone(e.activity.path);
 e.setLoop({mode:'laps',value:2});const plan=structuredClone(e.activity.loop);assert.deepEqual(e.activity.path,geometry);
 e.undo();assert.equal(e.activity.loop,undefined);assert.deepEqual(e.activity.path,geometry);
 e.redo();assert.deepEqual(e.activity.loop,plan);assert.deepEqual(e.activity.path,geometry);
 e.setLoop(null);assert.equal(e.activity.loop,undefined);e.undo();assert.deepEqual(e.activity.loop,plan);assert.deepEqual(e.activity.path,geometry);e.redo();assert.equal(e.activity.loop,undefined);assert.deepEqual(e.activity.path,geometry);e.dispose();
});

test('round-trip installation and alternate selection round-trip route geometry',async()=>{
 const e=new Editor(provider);e.load(routeActivity([a,b,c]));const original=structuredClone(e.activity.path),installed=[a,{lat:.02,lon:.02},c];
 e.installRoute([a,c],installed);assert.deepEqual(e.activity.path,installed);e.undo();assert.deepEqual(e.activity.path,original);e.redo();assert.deepEqual(e.activity.path,installed);
 e.undo();e.alternatePaths=[[a,b,c],[a,{lat:.03,lon:.04},c]];const alternate=structuredClone(e.alternatePaths[1]);await e.selectAlternate(1);assert.deepEqual(e.activity.path,alternate);e.undo();assert.deepEqual(e.activity.path,original);e.redo();assert.deepEqual(e.activity.path,alternate);e.dispose();
});

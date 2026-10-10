import test from 'node:test';
import assert from 'node:assert/strict';
import {hrZones,belowZoneSeconds,paceHistogram,perUnitSplits,compareActivities} from '../dist/src/analysis.js';

const samples=rows=>rows.map(([time,distance,speed,hr])=>({lat:0,lon:0,time,distance,speed,...(hr===undefined?{}:{hr})}));

test('paceHistogram handles a constant value sitting on a bin boundary',()=>{
 // 4 m/s run = 250 s/km, an exact multiple of the 10 s/km bin: the bin range collapses to one bin.
 const flat=samples(Array.from({length:11},(_,i)=>[i*1000,i*4,4]));
 const hist=paceHistogram(flat,'run','metric')[0];
 assert.equal(hist.bins.length,1);
 assert.ok(hist.bins[0].seconds>0);
 // A constant 5 m/s ride (18 km/h) is likewise an exact bin multiple.
 const ride=samples(Array.from({length:11},(_,i)=>[i*1000,i*5,5]));
 assert.equal(paceHistogram(ride,'ride','metric')[0].bins.length,1);
});

test('HR zones partition weighted time and their percentages sum to 100',()=>{
  const points=samples([
    [0,0,3,110],[6000,50,3,112],[12000,100,3,130],[18000,150,3,128],[24000,200,3,150],
    [30000,250,3,152],[36000,300,3,170],[36000+6000,300,3,168],[48000,350,3,190],[54000,400,3,192],
  ]);
  const zones=hrZones(points,200);
  assert.equal(zones.length,5);
  assert.deepEqual(zones.map(z=>z.index),[1,2,3,4,5]);
  assert.deepEqual(zones.map(z=>[z.min,z.max]),[[100,120],[120,140],[140,160],[160,180],[180,200]]);
  assert.deepEqual(zones.map(z=>z.seconds),[6,18,6,18,6]);
  assert.ok(Math.abs(zones.reduce((sum,z)=>sum+z.percent,0)-100)<1e-9);
  const z1=zones[0];assert.ok(Math.abs(z1.percent-100*6/54)<1e-9);
});

test('a constant HR lands entirely in its expected zone',()=>{
  const points=samples([[0,0,3,150],[10000,50,3,150],[20000,100,3,150],[30000,150,3,150]]);
  const zones=hrZones(points,200);
  assert.equal(zones[2].seconds,30);
  assert.equal(zones[2].percent,100);
  assert.deepEqual(zones.filter(z=>z.index!==3).map(z=>z.seconds),[0,0,0,0]);
});

test('below-zone seconds count time under 50% of hrMax',()=>{
  const points=samples([[0,0,3,90],[10000,50,3,90],[20000,100,3,90]]);
  assert.equal(belowZoneSeconds(points,200),20);
  assert.deepEqual(hrZones(points,200).map(z=>z.seconds),[0,0,0,0,0]);
});

test('samples without a finite HR are skipped in zone and below-zone time',()=>{
  const points=samples([[0,0,3,110],[6000,50,3],[12000,100,3,110],[18000,150,3,110]]);
  const zones=hrZones(points,200);
  assert.deepEqual(zones.map(z=>z.seconds),[6,0,0,0,0]);
  assert.equal(belowZoneSeconds(points,200),0);
});

test('pace histogram buckets are monotonic, cover the range and sum to weighted time',()=>{
  const points=samples([
    [0,0,3,undefined],[1000,15,2.5],[2000,30,3.5],[3000,45,3],[4000,60,2.8],[5000,75,3.2],
  ]);
  const [hist]=paceHistogram(points,'run','metric');
  assert.equal(hist.binSize,10);
  assert.equal(hist.unit,'s/km');
  const paces=points.slice(0,-1).map(p=>1000/p.speed);
  assert.ok(hist.bins[0].min<=Math.min(...paces)&&hist.bins.at(-1).max>=Math.max(...paces));
  for(let i=1;i<hist.bins.length;i++){
    assert.ok(hist.bins[i].min>hist.bins[i-1].min);
    assert.equal(hist.bins[i].min,hist.bins[i-1].max);
    assert.ok(hist.bins[i].seconds>=0);
  }
  assert.ok(Math.abs(hist.bins.reduce((sum,b)=>sum+b.seconds,0)-5)<1e-9);
  const zero=paceHistogram([...points.slice(0,3),{lat:0,lon:0,time:2500,distance:20,speed:0},...points.slice(3)],'run','metric')[0];
  assert.ok(zero.bins.reduce((sum,b)=>sum+b.seconds,0)<hist.bins.reduce((sum,b)=>sum+b.seconds,0));
});

test('histogram bin size follows sport and unit system',()=>{
  const points=samples([[0,0,3],[1000,30,3],[2000,60,3]]);
  assert.equal(paceHistogram(points,'run','metric')[0].binSize,10);
  assert.equal(paceHistogram(points,'run','imperial')[0].binSize,15);
  assert.equal(paceHistogram(points,'run','imperial')[0].unit,'s/mi');
  const ride=paceHistogram(points,'ride','metric')[0];
  assert.equal(ride.binSize,1);
  assert.equal(ride.unit,'km/h');
  const kmh=paceHistogram(points,'ride','metric')[0].bins;
  assert.equal(kmh.length,1);
  assert.equal(kmh[0].min,10);
  assert.equal(kmh[0].max,11);
  assert.equal(kmh[0].seconds,2);
  assert.equal(paceHistogram(points,'ride','imperial')[0].unit,'mph');
});

test('per-unit splits respect boundaries, sum to duration and shorten the final split',()=>{
  const points=[];for(let k=0;k<=9;k++)points.push({lat:0,lon:0,time:k*150000,distance:k*500,speed:500/150});
  const sim={points,duration:1350,distance:4500,interval:1};
  const splits=perUnitSplits(sim,1000);
  assert.equal(splits.length,5);
  assert.equal(splits[0].start,0);
  assert.equal(splits.at(-1).end,4500);
  assert.deepEqual(splits.slice(0,4).map(s=>s.duration),[300,300,300,300]);
  assert.ok(Math.abs(splits[4].duration-150)<1e-9);
  assert.ok(Math.abs(splits.reduce((sum,s)=>sum+s.duration,0)-sim.duration)<1e-6);
  assert.ok(Math.abs(splits[0].pace-300)<1e-9);
  const even=perUnitSplits({...sim,points:points.concat([{lat:0,lon:0,time:1500000,distance:5000,speed:500/150}]),duration:1500,distance:5000},2500);
  assert.equal(even.length,2);
  assert.equal(even.at(-1).end,5000);
  assert.throws(()=>perUnitSplits(sim,0));
});

const activity=(sport,name,path)=>({id:'test',version:1,name,createdAt:0,updatedAt:0,waypoints:[],path,source:'draft',settings:{sport,start:'08:00',utcOffset:0,pace:300,speed:25,mode:'constant',variation:0,sample:1,hrEnabled:false,hrAverage:150,hrVariation:0,seed:1}});

const sim=(points,duration,distance)=>({points,duration,distance,interval:1});

const path=(count,step,ele)=>Array.from({length:count},(_,k)=>({lat:k*step/111320,lon:0,time:0,hr:0,...(ele===undefined?{}:{ele:ele(k)}),}));

test('compareActivities reports known distance, duration and average speed for two simulations',()=>{
  const run={activity:activity('run','Morning run',path(5,1000)),sim:sim(samples([[0,0,4],[1000000,1000,4],[2000000,2000,4],[3000000,3000,4],[4000000,4000,4]]),1200,4000)};
  const ride={activity:activity('ride','Commute',path(5,2500)),sim:sim(samples([[0,0,10],[900000,2500,10],[1800000,5000,10],[2700000,7500,10],[3600000,10000,10]]),3600,10000)};
  const {left,right}=compareActivities(run,ride);
  assert.equal(left.name,'Morning run');
  assert.equal(left.sport,'run');
  assert.equal(right.name,'Commute');
  assert.equal(right.sport,'ride');
  assert.equal(left.distance,4000);
  assert.equal(left.duration,1200);
  assert.ok(Math.abs(left.avgSpeed-4000/1200)<1e-9);
  assert.equal(right.distance,10000);
  assert.equal(right.duration,3600);
  assert.ok(Math.abs(right.avgSpeed-10000/3600)<1e-9);
});

test('delta is right minus left with positive signs when the right side is longer',()=>{
  const mk=meters=>({activity:activity('run',`Run ${meters}`,path(5,meters/4)),sim:sim(samples([[0,0,5],[500000,meters*.25,5],[1000000,meters*.5,5],[1500000,meters*.75,5],[2000000,meters,5]]),1000,meters)});
  const {delta}=compareActivities(mk(4000),mk(5000));
  assert.ok(Math.abs(delta.distance-1000)<1e-9);
  assert.equal(delta.duration,0);
  assert.ok(delta.avgSpeed>0);
  assert.ok(delta.avgPace<0);
  assert.ok(delta.calories>0);
});

test('avgPace is seconds per km for runs and null for rides',()=>{
  const run={activity:activity('run','Run',path(5,1000)),sim:sim(samples([[0,0,4],[1000000,1000,4],[2000000,2000,4],[3000000,3000,4],[4000000,4000,4]]),1200,4000)};
  const ride={activity:activity('ride','Ride',path(5,2500)),sim:sim(samples([[0,0,10],[900000,2500,10],[1800000,5000,10],[2700000,7500,10],[3600000,10000,10]]),3600,10000)};
  const {left,right}=compareActivities(run,ride);
  assert.ok(Math.abs(left.avgPace-1200/4)<1e-9);
  assert.equal(right.avgPace,null);
});

test('avgHr matches a constant HR series and is time weighted otherwise',()=>{
  const constant={activity:activity('run','Run',path(5,1000)),sim:sim(samples([[0,0,3,150],[30000,1000,3,150],[60000,2000,3,150],[90000,3000,3,150],[120000,4000,3,150]]),120,4000)};
  assert.ok(Math.abs(compareActivities(constant,constant).left.avgHr-150)<1e-9);
  const mixed={activity:activity('run','Run',path(5,1000)),sim:sim(samples([[0,0,3,100],[10000,500,3,100],[20000,1000,3,200],[30000,1500,3,200]]),30,1500)};
  assert.ok(Math.abs(compareActivities(mixed,mixed).left.avgHr-150)<1e-9);
});

test('calories is a positive integer and grows with distance at the same speed',()=>{
  const mk=meters=>({activity:activity('run',`Run ${meters}`,path(5,meters/4)),sim:sim(samples([[0,0,4],[1000000,meters*.25,4],[2000000,meters*.5,4],[3000000,meters*.75,4],[4000000,meters,4]]),meters/4,meters)});
  const short=compareActivities(mk(4000),mk(4000)).left;
  assert.ok(Number.isInteger(short.calories));
  assert.ok(short.calories>0);
  const {left,right,delta}=compareActivities(mk(4000),mk(8000));
  assert.ok(right.calories>left.calories);
  assert.ok(delta.calories>0);
});

test('a ride without elevation data yields null elevationGain and a null delta',()=>{
  const flat=activity('ride','Flat ride',path(5,2500));
  const mk=meters=>({activity:flat,sim:sim(samples([[0,0,8],[500000,meters*.25,8],[1000000,meters*.5,8],[1500000,meters*.75,8],[2000000,meters,8]]),250,meters)});
  const {left,right,delta}=compareActivities(mk(8000),mk(8000));
  assert.equal(left.elevationGain,null);
  assert.equal(right.elevationGain,null);
  assert.equal(delta.elevationGain,null);
});

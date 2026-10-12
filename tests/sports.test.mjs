import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,durationFor,simulate} from '../dist/src/model.js';
import {exportGPX} from '../dist/src/gpx.js';
import {exportTCX} from '../dist/src/tcx.js';
import {exportFIT,importFIT} from '../dist/src/fit.js';
import {resolveProfile} from '../dist/src/providers.js';
import {decodeShare,encodeShare} from '../dist/src/share.js';
import {gpxSportType,sportFromText,sportLabel,tcxSportType,usesPace} from '../dist/src/sports.js';

const sports=[
 {sport:'run',profile:'walk',duration:300,gpx:'running',tcx:'Running'},
 {sport:'walk',profile:'walk',duration:600,gpx:'walking',tcx:'Other'},
 {sport:'hike',profile:'hike',duration:720,gpx:'hiking',tcx:'Other'},
 {sport:'trail-run',profile:'hike',duration:360,gpx:'trail running',tcx:'Running'},
 {sport:'ride',profile:'road',duration:150,gpx:'cycling',tcx:'Biking'},
 {sport:'mtb',profile:'mtb',duration:150,gpx:'mountain biking',tcx:'Biking'},
];
function activity(sport) {
 const a=defaults();a.path=[{lat:0,lon:0,ele:0},{lat:0,lon:.005,ele:5}];a.waypoints=a.path;a.source='routed';a.name='Activity names';
 a.settings={...a.settings,sport,start:'2024-01-02T03:04',utcOffset:0,seed:220,pace:300,speed:24,sample:5};
 return a;
}

test('all sports use pace or speed arithmetic and select a routing default',()=>{
 for(const item of sports){
  assert.equal(usesPace(item.sport),item.sport==='run'||item.sport==='walk'||item.sport==='hike'||item.sport==='trail-run');
  assert.equal(resolveProfile(item.sport),item.profile);
  assert.equal(durationFor(1000,item.sport,item.duration,24),item.duration);
  assert.equal(gpxSportType(item.sport),item.gpx);
  assert.equal(tcxSportType(item.sport),item.tcx);
 }
});

test('sport text labels round-trip and new sport tags survive route sharing',()=>{
 for(const item of sports){
  assert.equal(sportFromText(sportLabel(item.sport)),item.sport);
  const a=activity(item.sport),decoded=decodeShare(encodeShare(a));
  assert.equal(decoded.sport,item.sport);
 }
 assert.equal(sportFromText('Mountain biking'),'mtb');
 assert.equal(sportFromText('Trail running'),'trail-run');
});

test('GPX, TCX, and FIT exports identify each sport without device impersonation',()=>{
 for(const item of sports){
  const a=activity(item.sport),sim=simulate(a),gpx=exportGPX(a,sim),tcx=exportTCX(a,sim),fit=exportFIT(a,sim);
  assert.ok(gpx.includes(`<type>${item.gpx}</type>`));
  assert.ok(tcx.includes(`Sport="${item.tcx}"`));
  assert.equal(importFIT(fit).activity.settings.sport,item.sport);
  assert.equal(importFIT(fit).activity.name,a.name);
 }
 const mountain=activity('hike'),xml=exportTCX(mountain,simulate(mountain));
 assert.ok(xml.includes('Activity type: Hike'));
 assert.equal(sportFromText('Hike'),'hike');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {ValhallaProvider,PROFILE_OPTIONS,resolveProfile,PUBLIC_CAP_METERS,capMessage,routeCapWarning} from '../dist/src/providers.js';
import {defaultPreferences,defaults,validateActivity,validateSettings} from '../dist/src/model.js';
const encode=p=>{let last=[0,0],out='';for(const q of p){for(const [i,v] of [q.lat,q.lon].entries()){const val=Math.round(v*1e6),diff=val-last[i];last[i]=val;let n=diff<0?~(diff<<1):diff<<1;while(n>=32){out+=String.fromCharCode((32|(n&31))+63);n>>=5;}out+=String.fromCharCode(n+63);}}return out;};
test('profiles resolve from sport unless explicitly chosen',()=>{
 assert.equal(resolveProfile('run'),'walk');assert.equal(resolveProfile('ride'),'road');
 assert.equal(resolveProfile('run','hike'),'hike');assert.equal(resolveProfile('ride','mtb'),'mtb');
});
test('each profile maps to a pedestrian or bicycle costing model',()=>{
 assert.equal(PROFILE_OPTIONS.walk.costing,'pedestrian');assert.equal(PROFILE_OPTIONS.hike.costing,'pedestrian');
 assert.equal(PROFILE_OPTIONS.road.costing,'bicycle');assert.equal(PROFILE_OPTIONS.mtb.costing,'bicycle');
 assert.equal(PROFILE_OPTIONS.hike.options.max_hiking_difficulty,6);
 assert.equal(PROFILE_OPTIONS.mtb.options.bicycle_type,'Mountain');
});
test('settings accept a known profile and reject an unknown one',()=>{
 const s=defaults().settings;
 assert.doesNotThrow(()=>validateSettings({...s}));assert.doesNotThrow(()=>validateSettings({...s,profile:'hike'}));
 assert.throws(()=>validateSettings({...s,profile:'swim'}));
});
test('activity validation keeps a valid profile and drops an unknown one',()=>{
 const a=defaults();a.path=[{lat:0,lon:0},{lat:1,lon:1}];a.settings.profile='mtb';
 assert.equal(validateActivity(a).settings.profile,'mtb');
 const plain=defaults();plain.path=[{lat:0,lon:0},{lat:1,lon:1}];
 assert.equal(validateActivity(plain).settings.profile,undefined);
 assert.throws(()=>validateActivity({...a,settings:{...a.settings,profile:'swim'}}));
});
test('public distance caps warn before routing and explain a max-distance failure',()=>{
 assert.equal(PUBLIC_CAP_METERS.walk,100000);assert.equal(PUBLIC_CAP_METERS.mtb,150000);
 assert.equal(routeCapWarning('walk',70000),null);assert.match(routeCapWarning('walk',81000),/self-host/i);
 assert.equal(routeCapWarning('road',110000),null);assert.match(routeCapWarning('road',121000),/self-host/i);
 assert.match(capMessage('walk'),/100 km/);assert.match(capMessage('mtb'),/150 km/);
});
test('a Valhalla max-distance 400 becomes an actionable cap message',async()=>{
 const old=globalThis.fetch;try{
  globalThis.fetch=async()=>new Response(JSON.stringify({error_code:154,error:'Path distance exceeds the max distance limit'}),{status:400});
  const p=new ValhallaProvider(()=>({...defaultPreferences,routingUrl:'https://cap.example/route'}));
  await assert.rejects(p.route([{lat:0,lon:0},{lat:0,lon:1}],'walk',new AbortController().signal),/self-host/i);
 }finally{globalThis.fetch=old;}
});
test('other 400 responses keep the generic routing message',async()=>{
 const old=globalThis.fetch;try{
  globalThis.fetch=async()=>new Response(JSON.stringify({error_code:120}),{status:400});
  const p=new ValhallaProvider(()=>({...defaultPreferences,routingUrl:'https://bad.example/route'}));
  await assert.rejects(p.route([{lat:0,lon:0},{lat:0,lon:1}],'walk',new AbortController().signal),/Move the waypoints/);
 }finally{globalThis.fetch=old;}
});
test('mountain-bike profile requests Mountain type with reduced road use',async()=>{
 const path=[{lat:31,lon:121},{lat:31.02,lon:121.03}],old=globalThis.fetch;let body={};try{
  globalThis.fetch=async url=>{body=JSON.parse(new URL(url).searchParams.get('json'));return new Response(JSON.stringify({trip:{legs:[{shape:encode(path)}]}}),{status:200});};
  const p=new ValhallaProvider(()=>({...defaultPreferences,routingUrl:'https://mtb.example/route'}));
  await p.route(path,'mtb',new AbortController().signal);
  assert.equal(body.costing,'bicycle');assert.equal(body.costing_options.bicycle.bicycle_type,'Mountain');assert.equal(body.costing_options.bicycle.use_roads,.1);
 }finally{globalThis.fetch=old;}
});

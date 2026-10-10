import test from 'node:test';
import assert from 'node:assert/strict';
import {ValhallaProvider} from '../dist/src/providers.js';
import {defaultPreferences} from '../dist/src/model.js';

const encode=p=>{let last=[0,0],out='';for(const q of p){for(const [i,v] of [q.lat,q.lon].entries()){const val=Math.round(v*1e6),diff=val-last[i];last[i]=diff;let n=diff<0?~(diff<<1):diff<<1;while(n>=32){out+=String.fromCharCode((32|(n&31))+63);n>>=5;}out+=String.fromCharCode(n+63);}}return out;};
const route=async(profile,prefs)=>{const path=[{lat:31,lon:121},{lat:31.02,lon:121.03}],old=globalThis.fetch;let body={};try{globalThis.fetch=async url=>{body=JSON.parse(new URL(url).searchParams.get('json'));return new Response(JSON.stringify({trip:{legs:[{shape:encode(path)}]}}),{status:200});};await new ValhallaProvider(()=>prefs).route(path,profile,new AbortController().signal);return body;}finally{globalThis.fetch=old;}};

test('avoid options are off by default and add no costing options',async()=>{
 const body=await route('road',{...defaultPreferences,routingUrl:'https://avoid.example/route'});
 assert.equal(body.costing_options.bicycle.use_hills,undefined);
 assert.equal(body.costing_options.bicycle.use_roads,undefined);
});

test('avoid hills applies to walking and cycling',async()=>{
 const walk=await route('walk',{...defaultPreferences,routingUrl:'https://avoid.example/route',avoidHills:true});
 assert.equal(walk.costing_options.pedestrian.use_hills,0);
 const bike=await route('road',{...defaultPreferences,routingUrl:'https://avoid.example/route',avoidHills:true});
 assert.equal(bike.costing_options.bicycle.use_hills,0);
});

test('avoid highways lowers road use for cycling only',async()=>{
 const bike=await route('mtb',{...defaultPreferences,routingUrl:'https://avoid.example/route',avoidHighways:true});
 assert.equal(bike.costing_options.bicycle.use_roads,0);
 const walk=await route('walk',{...defaultPreferences,routingUrl:'https://avoid.example/route',avoidHighways:true});
 assert.equal(walk.costing_options,undefined);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOverpassQuery,clearPoiCache,fetchPois,parseOverpassResponse,poiRouteHash} from '../dist/src/poi.js';
import {defaultPreferences} from '../dist/src/model.js';

const path=[{lat:31.23,lon:121.47},{lat:31.24,lon:121.48}];
const response={elements:[
 {type:'node',id:1,lat:31.231,lon:121.471,tags:{amenity:'drinking_water',name:'Fountain'}},
 {type:'way',id:2,center:{lat:31.232,lon:121.472},tags:{amenity:'toilets',name:'Public toilets'}},
 {type:'node',id:3,lat:31.233,lon:121.473,tags:{natural:'spring'}},
 {type:'node',id:4,lat:999,lon:0,tags:{amenity:'toilets'}},
 {type:'node',id:5,lat:31.234,lon:121.474,tags:{shop:'water'}}
]};

test('Overpass corridor query is one bounded water-and-toilet query',()=>{
 const query=buildOverpassQuery(path),longPath=Array.from({length:1000},(_,i)=>({lat:31.2+i*.00001,lon:121.4+i*.00001})),bounded=buildOverpassQuery(longPath);
 assert.match(query,/amenity.*drinking_water.*toilets/);assert.match(query,/drinking_water/);assert.match(query,/natural/);assert.match(query,/out center 100/);
 assert.ok((bounded.match(/around:/g)||[]).length<=192);assert.ok(bounded.length<30000);
 assert.equal(poiRouteHash(path),poiRouteHash(path.map(point=>({...point}))));
});

test('Overpass response parser reads nodes and way centers without inventing locations',()=>{
 const places=parseOverpassResponse(response);
 assert.deepEqual(places.map(place=>place.kind),['water','toilets','water']);
 assert.equal(places[0].name,'Fountain');assert.equal(places[1].lat,31.232);assert.equal(places[2].name,undefined);
 assert.throws(()=>parseOverpassResponse({elements:{}}),/invalid response/);
});

test('POI lookup is default off, makes one abortable request, and caches by route hash',async()=>{
 clearPoiCache();let requests=0;const original=globalThis.fetch;
 try{
  globalThis.fetch=async(url,init)=>{requests++;assert.equal(url,'https://overpass.mock/api/interpreter');assert.equal(init.method,'POST');assert.match(new URLSearchParams(init.body).get('data'),/\[out:json\]\[timeout:20\]/);return new Response(JSON.stringify(response),{status:200,headers:{'Content-Type':'application/json'}});};
  await assert.rejects(fetchPois(path,defaultPreferences,new AbortController().signal),/Enable optional/);assert.equal(requests,0);
  const prefs={...defaultPreferences,poiEnabled:true,overpassUrl:'https://overpass.mock/api/interpreter'};
  const first=await fetchPois(path,prefs,new AbortController().signal),second=await fetchPois(path,prefs,new AbortController().signal);
  assert.equal(requests,1);assert.equal(first.length,3);assert.deepEqual(second,first);
 }finally{globalThis.fetch=original;clearPoiCache();}
});

test('POI lookup forwards abort to its single fetch',async()=>{
 clearPoiCache();const original=globalThis.fetch,controller=new AbortController();let requests=0;
 try{
  globalThis.fetch=async(_url,init)=>{requests++;return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));};
  const pending=fetchPois([{lat:0,lon:0},{lat:0,lon:.02}],{...defaultPreferences,poiEnabled:true,overpassUrl:'https://abort.mock/api/interpreter'},controller.signal);
  controller.abort(new Error('cancelled by user'));await assert.rejects(pending,/cancelled by user/);assert.equal(requests,1);
 }finally{globalThis.fetch=original;clearPoiCache();}
});

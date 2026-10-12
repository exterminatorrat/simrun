import test from 'node:test';
import assert from 'node:assert/strict';
import {ValhallaProvider} from '../dist/src/providers.js';
import {defaultPreferences,defaults,validateActivity} from '../dist/src/model.js';
import {validatePreferences} from '../dist/src/storage.js';
import {surfaceBreakdown,roadClassBreakdown} from '../dist/src/analysis.js';

const path=[{lat:31,lon:121},{lat:31,lon:121.01},{lat:31.01,lon:121.01}];
const encode=points=>{let last=[0,0],out='';for(const point of points){for(const [index,value] of [point.lat,point.lon].entries()){const number=Math.round(value*1e6),delta=number-last[index];last[index]=number;let encoded=delta<0?~(delta<<1):delta<<1;while(encoded>=32){out+=String.fromCharCode((32|(encoded&31))+63);encoded>>=5;}out+=String.fromCharCode(encoded+63);}}return out;};
const routeResponse={trip:{legs:[{shape:encode(path),maneuvers:[{begin_shape_index:0,end_shape_index:1,street_names:['River Road']},{begin_shape_index:1,end_shape_index:2,street_names:['Hill Street']}]}]}};

test('Valhalla maneuver names normalize into route data while surface details stay opt-in',async()=>{
 const original=globalThis.fetch;let requestBody;
 try{
  globalThis.fetch=async url=>{requestBody=JSON.parse(new URL(url).searchParams.get('json'));return new Response(JSON.stringify(routeResponse),{status:200});};
  const provider=new ValhallaProvider(()=>({...defaultPreferences,routingUrl:'https://names.mock/route'}));
  const routed=await provider.route(path,'walk',new AbortController().signal),data=await provider.routeDetails(routed,'walk',new AbortController().signal);
  assert.equal(requestBody.directions_type,'instructions');assert.equal(data.streetNames[0].name,'River Road');assert.equal(data.streetNames[1].name,'Hill Street');assert.equal(data.surfaceEdges,undefined);
  const activity=defaults();activity.path=routed;activity.source='routed';activity.routeData=data;
  assert.deepEqual(validateActivity(activity).routeData,data);
  activity.routeData={surfaceEdges:[{distance:-2,surface:'paved'}]};assert.throws(()=>validateActivity(activity),/surface distance/);
 }finally{globalThis.fetch=original;}
});

test('trace_attributes supplies honest surface and road-class distances',async()=>{
 const original=globalThis.fetch,requests=[];
 try{
  globalThis.fetch=async url=>{const parsed=new URL(url);requests.push({path:parsed.pathname,body:JSON.parse(parsed.searchParams.get('json'))});return new Response(JSON.stringify(parsed.pathname.endsWith('trace_attributes')?{units:'kilometers',edges:[{length:.35,surface:'paved_smooth',road_class:'primary',names:['River Road']},{length:.65,surface:'gravel',road_class:'residential'}]}:routeResponse),{status:200});};
  const provider=new ValhallaProvider(()=>({...defaultPreferences,routingUrl:'https://surface.mock/route',surfaceDataEnabled:true}));
  const routed=await provider.route(path,'road',new AbortController().signal),data=await provider.routeDetails(routed,'road',new AbortController().signal);
  assert.deepEqual(requests.map(request=>request.path),['/route','/trace_attributes']);
  assert.deepEqual(requests[1].body.filters.attributes,['edge.length','edge.road_class','edge.surface']);
  assert.equal(data.surfaceEdges[0].distance,350);assert.equal(data.surfaceEdges[1].distance,650);
  assert.deepEqual(surfaceBreakdown(data.surfaceEdges),[{name:'gravel',distance:650},{name:'paved_smooth',distance:350}]);
  assert.deepEqual(roadClassBreakdown(data.surfaceEdges),[{name:'residential',distance:650},{name:'primary',distance:350}]);
 }finally{globalThis.fetch=original;}
});

test('trace endpoint rejection omits surface details but keeps route and maneuver names',async()=>{
 const original=globalThis.fetch;let traceCalls=0;
 try{
  globalThis.fetch=async url=>{if(new URL(url).pathname.endsWith('trace_attributes')){traceCalls++;return new Response(JSON.stringify({error_code:1}),{status:400});}return new Response(JSON.stringify(routeResponse),{status:200});};
  const provider=new ValhallaProvider(()=>({...defaultPreferences,routingUrl:'https://absent.mock/route',surfaceDataEnabled:true}));
  const routed=await provider.route(path,'walk',new AbortController().signal),data=await provider.routeDetails(routed,'walk',new AbortController().signal);
  assert.equal(routed.length,3);assert.equal(traceCalls,1);assert.ok(data.streetNames.length>0);assert.equal(data.surfaceEdges,undefined);
 }finally{globalThis.fetch=original;}
});

test('surface and Overpass preferences are HTTPS-validated and default off',()=>{
 assert.equal(defaultPreferences.surfaceDataEnabled,false);assert.equal(defaultPreferences.poiEnabled,false);
 assert.equal(validatePreferences({}).overpassUrl,defaultPreferences.overpassUrl);
 assert.equal(validatePreferences({poiEnabled:true,surfaceDataEnabled:true,overpassUrl:'https://overpass.example/api/interpreter'}).poiEnabled,true);
 assert.equal(validatePreferences({surfaceDataEnabled:true}).surfaceDataEnabled,true);
 assert.throws(()=>validatePreferences({overpassUrl:'http://overpass.example/api/interpreter'}),/HTTPS/);
});

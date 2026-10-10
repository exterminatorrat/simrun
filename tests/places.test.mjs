import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,defaultPreferences} from '../dist/src/model.js';
import {PlaceSuggestionSearch,LruCache,MAX_SAVED_PLACES,parseCoordinateQuery,parsePhotonResponse,searchSavedPlaces,validateSavedPlaces} from '../dist/src/places.js';
import {searchPhoton} from '../dist/src/providers.js';
import {LocalStore,parseBackup,serializeBackup,validatePreferences} from '../dist/src/storage.js';

const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

test('Photon GeoJSON parsing validates coordinates and forms readable labels',()=>{
 const places=parsePhotonResponse({type:'FeatureCollection',features:[
  {type:'Feature',properties:{name:'Wien',country:'Österreich'},geometry:{type:'Point',coordinates:[16.3725042,48.2083537]}},
  {type:'Feature',properties:{name:'Bad point'},geometry:{type:'Point',coordinates:[181,0]}},
  {type:'Feature',properties:{name:'No geometry'},geometry:{type:'LineString',coordinates:[]}}
 ]});
 assert.deepEqual(places,[{name:'Wien, Österreich',lat:48.2083537,lon:16.3725042}]);
 assert.throws(()=>parsePhotonResponse({}),/invalid place results/);
});

test('Photon provider uses the configured HTTPS endpoint and mocked GeoJSON response',async()=>{
 const previous=globalThis.fetch;let requestUrl='';
 globalThis.fetch=async input=>{requestUrl=String(input);return new Response(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{name:'Dublin'},geometry:{type:'Point',coordinates:[-6.26,53.35]}}]}),{status:200,headers:{'Content-Type':'application/json'}});};
 try{
  const places=await searchPhoton('Dublin','https://photon.example/api/',new AbortController().signal);
  assert.equal(new URL(requestUrl).searchParams.get('q'),'Dublin');
  assert.equal(new URL(requestUrl).searchParams.get('limit'),'5');
  assert.deepEqual(places,[{name:'Dublin',lat:53.35,lon:-6.26}]);
 }finally{globalThis.fetch=previous;}
});

test('coordinate parsing and saved-place matching work without network access',()=>{
 const places=validateSavedPlaces([{id:'1',name:'Trailhead North',lat:47.1,lon:8.2},{id:'2',name:'Town Centre',lat:47.2,lon:8.3}]);
 assert.deepEqual(parseCoordinateQuery('47.1, 8.2'),{name:'Coordinates',lat:47.1,lon:8.2});
 assert.deepEqual(searchSavedPlaces(places,'trail north'),[{name:'Trailhead North',lat:47.1,lon:8.2}]);
 assert.deepEqual(searchSavedPlaces(places,'91, 8'),[]);
 assert.throws(()=>parseCoordinateQuery('91, 8'),/outside/);
});

test('saved places reject malformed values, duplicate ids, and cap their count',()=>{
 const values=Array.from({length:MAX_SAVED_PLACES+3},(_,index)=>({id:`place-${index}`,name:`Place ${index}`,lat:40,lon:10}));
 values.push({id:'place-0',name:'Duplicate',lat:0,lon:0},{id:'bad',name:'Invalid',lat:91,lon:0},{id:'long',name:'x'.repeat(81),lat:0,lon:0});
 const places=validateSavedPlaces(values);
 assert.equal(places.length,MAX_SAVED_PLACES);
 assert.equal(places[0].name,'Place 0');
 assert.equal(validateSavedPlaces({}).length,0);
});

test('saved places survive backup serialization and old backups remain readable',()=>{
 const places=validateSavedPlaces([{id:'home',name:'Home',lat:51.5,lon:-0.12}]);
 const backup=serializeBackup([defaults()],defaultPreferences,places,'2026-10-10T00:00:00.000Z');
 assert.deepEqual(parseBackup(backup).savedPlaces,places);
 const old=JSON.parse(backup);delete old.savedPlaces;
 assert.deepEqual(parseBackup(JSON.stringify(old)).savedPlaces,[]);
});

test('layer and suggestion preferences are validated and default off',()=>{
 const defaultsOnly=validatePreferences({});
 assert.equal(defaultsOnly.mapBaseLayer,'vector');
 assert.equal(defaultsOnly.mapCyclingOverlay,false);
 assert.equal(defaultsOnly.mapHikingOverlay,false);
 assert.equal(defaultsOnly.searchSuggestions,false);
 assert.equal(defaultsOnly.photonUrl,'https://photon.komoot.io/api/');
 const selected=validatePreferences({...defaultsOnly,mapBaseLayer:'topo',mapCyclingOverlay:true,mapHikingOverlay:true,searchSuggestions:true});
 assert.equal(selected.mapBaseLayer,'topo');
 assert.equal(selected.mapCyclingOverlay,true);
 assert.equal(selected.mapHikingOverlay,true);
 assert.equal(selected.searchSuggestions,true);
 assert.throws(()=>validatePreferences({...defaultsOnly,photonUrl:'http://photon.example/api'}),/HTTPS/);
});

test('LRU cache refreshes recent entries and evicts the oldest',()=>{
 const cache=new LruCache(2);cache.set('a',1);cache.set('b',2);assert.equal(cache.get('a'),1);cache.set('c',3);
 assert.equal(cache.get('b'),undefined);assert.equal(cache.get('a'),1);assert.equal(cache.size,2);
});

test('suggestions debounce input, abort superseded requests, and ignore stale results',async()=>{
 const requests=[],results=[];
 const search=new PlaceSuggestionSearch((query,signal)=>new Promise(resolve=>requests.push({query,signal,resolve})),(query,places)=>results.push({query,places}),()=>{},400);
 search.search('hel');search.search('hello');await pause(420);
 assert.deepEqual(requests.map(item=>item.query),['hello']);
 search.search('help');assert.equal(requests[0].signal.aborted,true);await pause(420);
 assert.deepEqual(requests.map(item=>item.query),['hello','help']);
 requests[0].resolve([{name:'stale'}]);requests[1].resolve([{name:'current'}]);await pause(0);
 assert.deepEqual(results.at(-1),{query:'help',places:[{name:'current'}]});
 search.search('HELP');assert.deepEqual(results.at(-1),{query:'HELP',places:[{name:'current'}]});
 search.cancel();
});

test('saved places persist in the existing local-store metadata fallback',async()=>{
 const store=new LocalStore();await assert.rejects(store.open());
 const place={id:'camp',name:'Camp',lat:45.2,lon:7.1};await store.saveSavedPlace(place);
 assert.deepEqual(await store.listSavedPlaces(),[place]);
 await store.removeSavedPlace(place.id);assert.deepEqual(await store.listSavedPlaces(),[]);
});

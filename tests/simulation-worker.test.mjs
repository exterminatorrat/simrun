import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {simulate} from '../dist/src/model.js';
import {simulateInWorker} from '../dist/src/simulation.js';

const path=Array.from({length:1001},(_,index)=>({lat:0,lon:index*20/(111.195*1000)}));
const activity={id:'worker-fallback',version:1,name:'Worker fallback',createdAt:0,updatedAt:0,waypoints:[path[0],path.at(-1)],path,source:'imported',settings:{sport:'run',profile:'road',start:'2026-10-10T06:00',utcOffset:0,pace:300,speed:24,mode:'constant',variation:0,sample:1,hrEnabled:false,hrAverage:150,hrVariation:5,seed:1}};

test('large simulations fall back with byte-identical synchronous results when Worker creation fails',async()=>{
 const prior=globalThis.Worker;
 Object.defineProperty(globalThis,'Worker',{configurable:true,writable:true,value:class{constructor(){throw Error('Worker unavailable');}}});
 try{assert.deepEqual(await simulateInWorker(activity),simulate(activity));}
 finally{if(prior===undefined)delete globalThis.Worker;else Object.defineProperty(globalThis,'Worker',{configurable:true,writable:true,value:prior});}
});

test('static precache includes the module simulation worker',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../dist/sw-manifest.json',import.meta.url),'utf8'));
 assert.ok(manifest.files.includes('src/simulation-worker.js'));
});

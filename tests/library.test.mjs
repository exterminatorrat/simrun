import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeTags,searchActivities,sortActivities,storageUsage} from '../dist/src/storage.js';
import {defaults} from '../dist/src/model.js';

const path=[{lon:0,lat:0,ele:10},{lon:0.045,lat:0,ele:20}];
const longPath=[{lon:0,lat:0,ele:10},{lon:0.09,lat:0,ele:20}];
const act=(name,tags,updatedAt,extra={})=>{
 const a=defaults();
 a.name=name;a.tags=tags;a.updatedAt=updatedAt;a.path=path;a.source='routed';
 return {...a,...extra};
};

test('sanitizeTags trims and drops empties',()=>{
 assert.deepEqual(sanitizeTags(['  run  ','','   ','hike']),['run','hike']);
 assert.deepEqual(sanitizeTags(['x'.repeat(30)]),['x'.repeat(24)]);
});
test('sanitizeTags dedupes case-insensitively keeping first casing',()=>{
 assert.deepEqual(sanitizeTags(['Run','RUN','run','trail']),['Run','trail']);
});
test('sanitizeTags caps at 8 tags and returns undefined when empty or non-array',()=>{
 const many=Array.from({length:10},(_,i)=>'tag'+i);
 assert.equal(sanitizeTags(many).length,8);
 assert.deepEqual(sanitizeTags(many),many.slice(0,8));
 assert.equal(sanitizeTags([]),undefined);
 assert.equal(sanitizeTags(['   ']),undefined);
 assert.equal(sanitizeTags('run'),undefined);
 assert.equal(sanitizeTags(null),undefined);
 assert.equal(sanitizeTags(42),undefined);
});

test('searchActivities matches name and tags case-insensitively',()=>{
 const rows=[act('Morning Run',['trail'],100),act('Evening Ride',['commute'],200)];
 assert.deepEqual(searchActivities(rows,'MORNING'),[rows[0]]);
 assert.deepEqual(searchActivities(rows,'trail'),[rows[0]]);
 assert.deepEqual(searchActivities(rows,'Ride commute'),[rows[1]]);
});
test('searchActivities requires every token (AND) and empty query returns all',()=>{
 const rows=[act('Morning Run',['trail'],100),act('Evening Ride',['commute'],200)];
 assert.deepEqual(searchActivities(rows,'morning trail'),[rows[0]]);
 assert.deepEqual(searchActivities(rows,'morning ride'),[]);
 assert.deepEqual(searchActivities(rows,''),rows);
 assert.deepEqual(searchActivities(rows,'   '),rows);
});
test('searchActivities does not mutate input',()=>{
 const rows=[act('Morning Run',['trail'],100),act('Evening Ride',['commute'],200)];
 const snapshot=structuredClone(rows);
 searchActivities(rows,'trail');
 assert.deepEqual(rows,snapshot);
});

test('sortActivities by updated is newest first and non-mutating',()=>{
 const rows=[act('A',[],100),act('B',[],300),act('C',[],200)];
 const snapshot=structuredClone(rows);
 const sorted=sortActivities(rows,'updated');
 assert.deepEqual(rows,snapshot);
 assert.deepEqual(sorted.map(a=>a.name),['B','C','A']);
});
test('sortActivities by name uses localeCompare and is non-mutating',()=>{
 const rows=[act('beta',[],1),act('alpha',[],2),act('Alpha',[],3)];
 const snapshot=structuredClone(rows);
 const sorted=sortActivities(rows,'name');
 assert.deepEqual(rows,snapshot);
 assert.deepEqual(sorted.map(a=>a.name),['alpha','Alpha','beta']);
});
test('sortActivities by distance orders by planned path length and is non-mutating',()=>{
 const rows=[act('short',[],1),act('long',[],2)];
 rows[1].path=longPath;
 const snapshot=structuredClone(rows);
 const sorted=sortActivities(rows,'distance');
 assert.deepEqual(rows,snapshot);
 assert.deepEqual(sorted.map(a=>a.name),['short','long']);
});
test('sortActivities by duration simulates and puts un-simulatable drafts last',()=>{
 const fast=act('fast',[],1),slow=act('slow',[],2),draft=act('draft',[],3);
 fast.settings.pace=240;
 slow.settings.pace=600;
 draft.path=[];
 const snapshot=structuredClone([fast,slow,draft]);
 const sorted=sortActivities([fast,slow,draft],'duration');
 assert.deepEqual([fast,slow,draft],snapshot);
 assert.deepEqual(sorted.map(a=>a.name),['fast','slow','draft']);
});

test('storageUsage returns null when navigator is absent',async()=>{
 const desc=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 if(desc)delete globalThis.navigator;
 try{assert.equal(await storageUsage(),null);}
 finally{if(desc)Object.defineProperty(globalThis,'navigator',desc);}
});
test('storageUsage feature-detects estimate and rejects non-finite numbers',async()=>{
 const desc=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 const set=v=>Object.defineProperty(globalThis,'navigator',{value:v,configurable:true});
 set({storage:{estimate:async()=>({usage:12,quota:100})}});
 try{assert.deepEqual(await storageUsage(),{usage:12,quota:100});}
 finally{if(desc)Object.defineProperty(globalThis,'navigator',desc);else delete globalThis.navigator;}
 set({storage:{estimate:async()=>({usage:Number.NaN,quota:100})}});
 try{assert.equal(await storageUsage(),null);}
 finally{if(desc)Object.defineProperty(globalThis,'navigator',desc);else delete globalThis.navigator;}
});

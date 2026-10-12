import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateTrimp,DEFAULT_MAX_HR,DEFAULT_RESTING_HR,TRIMP_ALPHA,TRIMP_BETA} from '../dist/src/trimp.js';
import {validatePreferences} from '../dist/src/storage.js';

const sample=(time,hr)=>({lat:0,lon:0,time,distance:time/1000,speed:1,...(hr===undefined?{}:{hr})});

test('TRIMP defaults are a deterministic sex-agnostic Banister exponential estimate',()=>{
 const points=[sample(0,125),sample(60000,125)];
 const expected=Math.round((TRIMP_ALPHA*.5*Math.exp(TRIMP_BETA*.5))*10)/10;
 assert.equal(calculateTrimp(points),expected);
 assert.equal(calculateTrimp(points),calculateTrimp(points));
 assert.equal(DEFAULT_RESTING_HR,60);
 assert.equal(DEFAULT_MAX_HR,190);
});

test('TRIMP weights elapsed HR reserve and clamps values to configured bounds',()=>{
 assert.equal(calculateTrimp([sample(0,60),sample(60000,60)]),0);
 assert.equal(calculateTrimp([sample(0,190),sample(60000,190)]),Math.round(TRIMP_ALPHA*Math.exp(TRIMP_BETA)*10)/10);
 assert.equal(calculateTrimp([sample(0,20),sample(60000,20)]),0);
 assert.equal(calculateTrimp([sample(0,250),sample(60000,250)]),Math.round(TRIMP_ALPHA*Math.exp(TRIMP_BETA)*10)/10);
 assert.equal(calculateTrimp([sample(0,125),sample(120000,125)],{restingHr:55,maxHr:195}),Math.round((2*TRIMP_ALPHA*((125-55)/(195-55))*Math.exp(TRIMP_BETA*((125-55)/(195-55))))*10)/10);
});

test('TRIMP skips missing or non-increasing HR intervals and returns null with no usable HR',()=>{
 assert.equal(calculateTrimp([sample(0,140)]),null);
 assert.equal(calculateTrimp([sample(0),sample(60000)]),null);
 assert.equal(calculateTrimp([sample(60000,150),sample(0,150)]),null);
 assert.equal(calculateTrimp([sample(0,150),sample(60000),sample(120000,150)]),null);
});

test('TRIMP rejects invalid heart-rate bounds',()=>{
 assert.throws(()=>calculateTrimp([],{restingHr:121}));
 assert.throws(()=>calculateTrimp([],{maxHr:99}));
 assert.throws(()=>calculateTrimp([],{restingHr:70,maxHr:70}));
});

test('preferences validate optional TRIMP resting and maximum HR settings',()=>{
 const values=validatePreferences({hrMax:185,trimpRestingHr:54,trimpMaxHr:200});
 assert.equal(values.trimpRestingHr,54);
 assert.equal(values.trimpMaxHr,200);
 assert.equal(validatePreferences({}).trimpRestingHr,undefined);
 assert.throws(()=>validatePreferences({trimpRestingHr:121}));
 assert.throws(()=>validatePreferences({trimpMaxHr:99}));
 assert.throws(()=>validatePreferences({trimpRestingHr:70,trimpMaxHr:70}));
 assert.throws(()=>validatePreferences({hrMax:100,trimpRestingHr:100}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {exportFIT, importFIT, crc16} from '../dist/src/fit.js';
import {defaults, simulate} from '../dist/src/model.js';
import {cumulative} from '../dist/src/geometry.js';

const activity=(settings={})=>{const a=defaults();a.path=[{lat:0,lon:0,ele:10},{lat:0,lon:0.01,ele:20},{lat:0,lon:0.02,ele:15}];a.source='routed';Object.assign(a.settings,settings);return a;};
const u16=(bytes,i)=>bytes[i]|bytes[i+1]<<8;
const u32=(bytes,i)=>(bytes[i]|bytes[i+1]<<8|bytes[i+2]<<16|(bytes[i+3]<<24>>>0))>>>0;

const walk=bytes=>{
 const size=u32(bytes,4),body=bytes.subarray(14,14+size),defs={},counts={};
 let recordFields=null,o=0;
 while(o<body.length){
  const h=body[o++];
  if(h&0x80){
   const mesg=body[o+2]|body[o+3]<<8,n=body[o+4],fields=[];
   o+=5;
   for(let i=0;i<n;i++){fields.push([body[o],body[o+1],body[o+2]]);o+=3;}
   defs[h&15]={mesg,fields};
   if(mesg===20)recordFields=fields;
  }else{
   const def=defs[h&15];
   if(!def)break;
   if(h&0x40)o++;
   for(const f of def.fields)o+=f[1];
   counts[def.mesg]=(counts[def.mesg]||0)+1;
  }
 }
 return {counts,recordFields};
};

test('the 14-byte header carries size, protocol and profile versions, ".FIT" magic, data size and CRC',()=>{
 const a=activity(),bytes=exportFIT(a,simulate(a));
 assert.equal(bytes[0],14);
 assert.equal(bytes[1],0x20);
 assert.equal(u16(bytes,2),2140);
 assert.equal(String.fromCharCode(...bytes.subarray(8,12)),'.FIT');
 assert.equal(u32(bytes,4)+16,bytes.length);
 assert.equal(u16(bytes,12),crc16(bytes.subarray(0,12)));
});

test('the trailing CRC-16 covers the whole file',()=>{
 const a=activity(),bytes=exportFIT(a,simulate(a));
 assert.equal(u16(bytes,bytes.length-2),crc16(bytes.subarray(0,bytes.length-2)));
});

test('message framing carries FileId, Record, Lap, Session, Event and CoursePoint messages',()=>{
 const a=activity(),s=simulate(a),{counts}=walk(exportFIT(a,s));
 assert.equal(counts[0],1);
 assert.equal(counts[20],s.points.length);
 assert.equal(counts[19],1);
 assert.equal(counts[18],1);
 assert.equal(counts[21],2);
 assert.equal(counts[32],2);
});

test('round-trip preserves point count, distance, timestamps within one second and heart rate',()=>{
 const a=activity({hrEnabled:true,hrAverage:150,hrVariation:5}),s=simulate(a);
 const {activity:imported}=importFIT(exportFIT(a,s));
 assert.equal(imported.path.length,s.points.length);
 assert.ok(Math.abs(cumulative(imported.path).at(-1)-s.distance)<2);
 for(let i=0;i<s.points.length;i++){
  assert.ok(Math.abs(imported.path[i].time-s.points[i].time)<=1000);
  assert.equal(imported.path[i].hr,s.points[i].hr);
 }
});

test('sport maps run and ride',()=>{
 const run=activity(),ride=activity({sport:'ride'});
 assert.equal(importFIT(exportFIT(run,simulate(run))).activity.settings.sport,'run');
 assert.equal(importFIT(exportFIT(ride,simulate(ride))).activity.settings.sport,'ride');
});

test('power and cadence record fields appear only when enabled',()=>{
 const plain=walk(exportFIT(activity(),simulate(activity()))).recordFields;
 assert.ok(!plain.some(f=>f[0]===4||f[0]===7));
 const both=activity({power:{enabled:true,weightKg:75},cadence:{enabled:true}});
 const fields=walk(exportFIT(both,simulate(both))).recordFields;
 assert.ok(fields.some(f=>f[0]===4));
 assert.ok(fields.some(f=>f[0]===7));
});

test('a corrupted byte fails the CRC check',()=>{
 const a=activity(),bytes=exportFIT(a,simulate(a));
 const body=Uint8Array.from(bytes);body[30]^=0xff;
 assert.throws(()=>importFIT(body),/CRC/);
 const head=Uint8Array.from(bytes);head[5]^=0xff;
 assert.throws(()=>importFIT(head));
});

test('the binary output contains no XML markup',()=>{
 const a=activity(),bytes=exportFIT(a,simulate(a));
 const text=Buffer.from(bytes).toString('latin1');
 assert.equal(bytes[0],14);
 assert.ok(!/<?xml|<(?:gpx|trkpt|Trackpoint|TrainingCenterDatabase)\b/i.test(text));
});

test('empty and one-point simulations are rejected',()=>{
 const a=activity();
 assert.throws(()=>exportFIT(a,{points:[],duration:1,distance:1,interval:2}),/at least two points/);
 assert.throws(()=>exportFIT(a,{points:[{lat:0,lon:0,ele:10,time:Date.now(),distance:0,speed:3}],duration:1,distance:1,interval:2}),/at least two points/);
});

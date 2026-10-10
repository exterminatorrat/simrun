import type {Activity,Point,Simulation,Sample} from './types.js';
import {PRODUCT,importedActivity,startTime} from './model.js';
import {validPoint} from './geometry.js';

const EPOCH=631065600,SEMI=2147483648/180,INV16=0xffff,INV32=0x7fffffff;

export function crc16(bytes:Uint8Array):number {
 let crc=0;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=crc&1?(crc>>>1)^0xA001:crc>>>1;}return crc&0xffff;
}

class Buf {b:number[]=[];
 u8(v:number){this.b.push(v&255);}
 u16(v:number){this.b.push(v&255,(v>>>8)&255);}
 u32(v:number){this.b.push(v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255);}
 s32(v:number){this.u32(v<0?v>>>0:v);}
 raw(bytes:number[]|Uint8Array){for(let i=0;i<bytes.length;i++)this.u8(bytes[i]);}
 str(s:string,n:number){const u=new TextEncoder().encode(s).subarray(0,n);this.raw(u);for(let i=u.length;i<n;i++)this.u8(0);}
 def(local:number,mesg:number,fields:number[][]){this.u8(0x80|local);this.u8(0);this.u8(0);this.u16(mesg);this.u8(fields.length);for(const f of fields){this.u8(f[0]);this.u8(f[1]);this.u8(f[2]);}}
}

function fitFile(body:Buf):Uint8Array {
 const payload=new Uint8Array(body.b),head=new Buf(),out=new Buf();
 head.u8(14);head.u8(0x20);head.u16(2140);head.u32(payload.length);head.raw([0x2e,0x46,0x49,0x54]);head.u16(crc16(new Uint8Array(head.b)));
 out.raw(new Uint8Array(head.b));out.raw(payload);out.u16(crc16(payload));
 return new Uint8Array(out.b);
}

function validated(s:Simulation):Sample[] {
 if(s.points.length<2)throw Error('Route needs at least two points.');
 let previous=-Infinity;
 for(const p of s.points){if(!validPoint(p)||!Number.isFinite(p.time)||p.time<=previous||!Number.isFinite(new Date(p.time).getTime()))throw Error('Export needs valid coordinates and strictly increasing timestamps.');if(p.ele!==undefined&&!Number.isFinite(p.ele))throw Error('Invalid elevation.');if(p.hr!==undefined&&(!Number.isInteger(p.hr)||p.hr<0||p.hr>255))throw Error('Invalid heart-rate data.');previous=p.time;}
 return s.points;
}

export function exportFIT(a:Activity,s:Simulation):Uint8Array {
 const points=validated(s),fit=(ms:number)=>Math.round(ms/1000)-EPOCH;
 const start=fit(startTime(a.settings)),end=fit(points[points.length-1].time),elapsed=Math.max(0,end-start);
 const hr=points.some(p=>p.hr!==undefined),cad=points.some(p=>p.cad!==undefined),power=points.some(p=>p.power!==undefined);
 const hrs=points.map(p=>p.hr??0),avgHr=hrs.reduce((v,n)=>v+n,0)/points.length,maxHr=Math.max(...hrs);
 const avgSpeed=s.distance/Math.max(1,elapsed),maxSpeed=Math.max(...points.map(p=>p.speed));
 const b=new Buf();
 b.def(0,0,[[0,1,0x00],[1,2,0x84],[2,2,0x84],[3,4,0x86],[4,4,0x86],[8,16,0x07]]);
 b.u8(0);b.u8(4);b.u16(0);b.u16(0);b.u32(0);b.u32(start);b.str(a.name||PRODUCT,16);
 const recFields=[[253,4,0x86],[0,4,0x85],[1,4,0x85],[2,2,0x84],[6,2,0x84]];
 if(hr)recFields.push([3,1,0x02]);
 if(cad)recFields.push([4,1,0x02]);
 if(power)recFields.push([7,2,0x84]);
 b.def(1,20,recFields);
 for(const p of points){
  b.u8(1);b.u32(fit(p.time));b.s32(Math.round(p.lat*SEMI));b.s32(Math.round(p.lon*SEMI));
  b.u16(p.ele===undefined?INV16:Math.round((p.ele+500)*5));b.u16(Math.round(p.speed*1000));
  if(hr)b.u8(p.hr??0xff);
  if(cad)b.u8(p.cad===undefined?0xff:Math.round(p.cad));
  if(power)b.u16(p.power===undefined?INV16:Math.round(p.power));
 }
 b.def(4,21,[[0,1,0x00],[1,1,0x00],[2,2,0x84],[253,4,0x86]]);
 b.u8(4);b.u8(0);b.u8(0);b.u16(0);b.u32(start);
 b.def(2,19,[[0,1,0x00],[1,1,0x00],[2,4,0x86],[7,4,0x86],[8,4,0x86],[9,4,0x86],[13,2,0x84],[14,2,0x84],...(hr?[[15,1,0x00],[16,1,0x00]]:[]),[253,4,0x86]]);
 b.u8(2);b.u8(9);b.u8(1);b.u32(start);b.u32(elapsed*1000);b.u32(elapsed*1000);b.u32(Math.round(s.distance*100));b.u16(Math.round(avgSpeed*1000));b.u16(Math.round(maxSpeed*1000));
 if(hr){b.u8(Math.round(avgHr));b.u8(maxHr);}
 b.u32(end);
 b.def(3,18,[[0,1,0x00],[1,1,0x00],[2,4,0x86],[5,1,0x00],[7,4,0x86],[8,4,0x86],[9,4,0x86],[14,2,0x84],[15,2,0x84],...(hr?[[16,1,0x00],[17,1,0x00]]:[]),[26,2,0x84],[253,4,0x86]]);
 b.u8(3);b.u8(8);b.u8(1);b.u32(start);b.u8(a.settings.sport==='ride'?2:1);b.u32(elapsed*1000);b.u32(elapsed*1000);b.u32(Math.round(s.distance*100));b.u16(Math.round(avgSpeed*1000));b.u16(Math.round(maxSpeed*1000));
 if(hr){b.u8(Math.round(avgHr));b.u8(maxHr);}
 b.u16(1);b.u32(end);
 b.u8(4);b.u8(0);b.u8(4);b.u16(0);b.u32(end);
 b.def(5,32,[[1,4,0x86],[2,4,0x85],[3,4,0x85],[4,4,0x86],[5,1,0x00],[6,16,0x07]]);
 const course=(p:Sample,name:string,distance:number)=>{b.u8(5);b.u32(fit(p.time));b.s32(Math.round(p.lat*SEMI));b.s32(Math.round(p.lon*SEMI));b.u32(Math.round(distance*100));b.u8(0);b.str(name,16);};
 course(points[0],'Start',0);course(points[points.length-1],'Finish',s.distance);
 b.def(6,34,[[0,4,0x86],[1,2,0x84],[2,1,0x00],[3,1,0x00],[4,1,0x00],[253,4,0x86]]);
 b.u8(6);b.u32(elapsed*1000);b.u16(1);b.u8(0);b.u8(8);b.u8(4);b.u32(end);
 return fitFile(b);
}

function value(d:Uint8Array,o:number,size:number,type:number,big:boolean):number|string|undefined {
 if(type===0x07){const text=new TextDecoder().decode(d.subarray(o,o+size)).replace(/\0[\s\S]*$/,'').trim();return text===''?undefined:text;}
 let v=0;for(let i=0;i<size;i++)v+=d[o+i]*2**(8*(big?size-1-i:i));
 if(type===0x01&&v>=0x80)v-=256;
 if(type===0x83&&v>=0x8000)v-=0x10000;
 if(type===0x85&&v>=0x80000000)v-=2**32;
 return v;
}

export function importFIT(data:Uint8Array):{activity:Activity;notice:string} {
 if(data.length<16)throw Error('FIT file is too short.');
 const size=(data[4]|data[5]<<8|data[6]<<16|(data[7]<<24>>>0))>>>0;
 if(data[0]!==14||data[8]!==0x2e||data[9]!==0x46||data[10]!==0x49||data[11]!==0x54)throw Error('This file is not a valid FIT activity file.');
 if(crc16(data.subarray(0,12))!==(data[12]|data[13]<<8))throw Error('FIT header CRC mismatch.');
 if(size!==data.length-16)throw Error('FIT data size does not match the file length.');
 if(crc16(data.subarray(0,14+size))!==(data[14+size]|data[15+size]<<8))throw Error('FIT file CRC mismatch.');
 const body=data.subarray(14,14+size),defs=new Map<number,{mesg:number;big:boolean;fields:number[][]}>();
 const points:Point[]=[],waypoints:Point[]=[],skipped:string[]=[];
 let o=0,last=-1,unknown=0,laps=0,sport=0,name='';
 while(o<body.length){
  const head=body[o++];
  if(head&0x80){
   if(o+4>body.length){skipped.push('truncated definition');break;}
   const big=body[o+1]===1,mesg=big?body[o+2]<<8|body[o+3]:body[o+2]|body[o+3]<<8,count=body[o+4];o+=5;
   const fields:number[][]=[];
   for(let i=0;i<count&&o+3<=body.length;i++){fields.push([body[o],body[o+1],body[o+2]]);o+=3;}
   if(fields.length<count||head&0x40){skipped.push(head&0x40?'developer data':'truncated definition');break;}
   defs.set(head&0x0f,{mesg,big,fields});continue;
  }
  const def=defs.get(head&0x0f);
  if(!def){skipped.push(`data for undefined local type ${head&0x0f}`);break;}
  let stamp:number|undefined;
  if(head&0x40){const off=body[o++];stamp=(last&~255)|off;if(stamp<=last)stamp+=256;}
  const vals=new Map<number,number|string|undefined>();let truncated=false;
  for(const f of def.fields){
   if(o+f[1]>body.length){truncated=true;break;}
   vals.set(f[0],value(body,o,f[1],f[2],def.big));o+=f[1];
  }
  if(truncated){skipped.push('truncated message');break;}
  const num=(n:number)=>{const v=vals.get(n);return typeof v==='number'?v:undefined;};
  if(def.mesg===0){
   if(num(0)!==4)skipped.push(`file type ${vals.get(0)}`);else{const text=vals.get(8);if(typeof text==='string')name=text;}
  }else if(def.mesg===18)sport=num(5)??0;
  else if(def.mesg===19)laps++;
  else if(def.mesg===32){
   const lat=num(2),lon=num(3);
   if(lat!==undefined&&lon!==undefined&&lat!==INV32&&lon!==INV32)waypoints.push({lat:lat*180/2147483648,lon:lon*180/2147483648});
  }else if(def.mesg===20){
   const ts=stamp??num(253),lat=num(0),lon=num(1);
   if(ts===undefined||lat===undefined||lon===undefined||lat===INV32||lon===INV32)skipped.push('record without time or position');
   else{
    const p:Point={lat:lat*180/2147483648,lon:lon*180/2147483648,time:(ts+EPOCH)*1000};
    const alt=num(2);if(alt!==undefined&&alt!==INV16)p.ele=alt/5-500;
    const pulse=num(3);if(pulse!==undefined&&pulse!==0&&pulse!==0xff)p.hr=pulse;
    points.push(p);last=ts;
   }
  }else if(def.mesg!==21&&def.mesg!==34)unknown++;
  if(stamp!==undefined)last=stamp;else{const t=num(253);if(t!==undefined)last=t;}
 }
 if(points.length<2)throw Error('FIT contains fewer than two usable records.');
 const made=importedActivity(points,name,sport===2?'cycling':'running','FIT');
 if(waypoints.length)made.activity.waypoints=waypoints;
 if(unknown)made.notices.push(`Skipped ${unknown} unsupported message${unknown===1?'':'s'}.`);
 if(skipped.length)made.notices.push(`Skipped unsupported content: ${[...new Set(skipped)].join(', ')}.`);
 if(laps)made.notices.push(`Read ${laps} lap${laps===1?'':'s'}; only the track is retained.`);
 return {activity:made.activity,notice:made.notices.join(' ')};
}

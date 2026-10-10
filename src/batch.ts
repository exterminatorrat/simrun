import type {Activity} from './types.js';
import {startTime,validateActivity} from './model.js';
import {usesPace} from './sports.js';

export const MAX_BATCH_VARIANTS=20;

export function generateBatch(activity:Activity,count:number,spacingMinutes=15):Activity[] {
 if(!Number.isInteger(count)||count<1||count>MAX_BATCH_VARIANTS)throw Error(`Choose between 1 and ${MAX_BATCH_VARIANTS} batch variants.`);
 if(!Number.isInteger(spacingMinutes)||spacingMinutes<1||spacingMinutes>1440)throw Error('Batch start spacing must be between 1 minute and 24 hours.');
 const source=validateActivity(activity),baseTime=startTime(source.settings),paceMode=usesPace(source.settings.sport);
 return Array.from({length:count},(_,index)=>{
  const seed=(source.settings.seed+(index+1)*104729)%2147483648;
  const mixed=Math.imul(seed^0x85ebca6b,0xc2b2ae35)>>>0;
  const factor=1+(mixed/0xffffffff*2-1)*.02;
  const pace=Math.max(60,Math.min(3600,source.settings.pace*factor));
  const speed=Math.max(1,Math.min(150,source.settings.speed/factor));
  const start=new Date(baseTime+index*spacingMinutes*60000+source.settings.utcOffset*60000).toISOString().slice(0,16);
  const paceSegments=source.settings.paceSegments?.map(value=>Math.max(paceMode?60:1,Math.min(paceMode?3600:150,paceMode?value*factor:value/factor)));
  return validateActivity({
   ...source,
   id:`${source.id.slice(0,70)}-b${index+1}-${seed}`,
   name:`${source.name.slice(0,140)} · Variant ${index+1}`,
   settings:{...source.settings,seed,start,pace,speed,...(paceSegments?{paceSegments}:{})},
  });
 });
}

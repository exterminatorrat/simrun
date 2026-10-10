import type {Point} from './types.js';
import {cumulative,atDistance,clamp} from './geometry.js';
const rad=Math.PI/180;
export interface CorridorBounds {minLat:number;maxLat:number;minLon:number;maxLon:number}
export interface CorridorRecord {id:string;name:string;bounds:CorridorBounds;tileCount:number;estimatedBytes:number;createdAt:number;urls:string[]}
export interface CorridorRemoval {records:CorridorRecord[];orphanedUrls:string[]}
export const MAX_CORRIDOR_RECORDS=100;
const MAX_CORRIDOR_URLS=600;
export function lon2tile(lon:number,zoom:number):number {return clamp(Math.floor((lon+180)/360*2**zoom),0,2**zoom-1);}
export function lat2tile(lat:number,zoom:number):number {return clamp(Math.floor((1-Math.asinh(Math.tan(lat*rad))/Math.PI)/2*2**zoom),0,2**zoom-1);}
export function tileRange(bounds:{minLat:number;maxLat:number;minLon:number;maxLon:number},zoom:number):{x0:number;x1:number;y0:number;y1:number} {
 return {x0:lon2tile(bounds.minLon,zoom),x1:lon2tile(bounds.maxLon,zoom),y0:lat2tile(bounds.maxLat,zoom),y1:lat2tile(bounds.minLat,zoom)};
}
export function corridorBounds(path:Point[],bufferMeters:number):CorridorBounds {
 const c=cumulative(path),total=c[c.length-1]||0,steps=Math.max(1,Math.min(512,Math.ceil(total/500)));
 let minLat=90,maxLat=-90,minLon=180,maxLon=-180;
 for(let i=0;i<=steps;i++) {
  const p=atDistance(path,c,total*i/steps);
  minLat=Math.min(minLat,p.lat);maxLat=Math.max(maxLat,p.lat);minLon=Math.min(minLon,p.lon);maxLon=Math.max(maxLon,p.lon);
 }
 const latBuf=bufferMeters/111320,lat0=clamp((minLat+maxLat)/2,-89.5,89.5),lonBuf=bufferMeters/(111320*Math.cos(lat0*rad));
 return {minLat:clamp(minLat-latBuf,-90,90),maxLat:clamp(maxLat+latBuf,-90,90),minLon:clamp(minLon-lonBuf,-180,180),maxLon:clamp(maxLon+lonBuf,-180,180)};
}
function corridorRange(path:Point[],bufferMeters:number,zoom:number) {
 if(!path.length||!Number.isFinite(zoom)||zoom<=0||zoom>22)throw Error('Corridor tiles need a non-empty path and a zoom from 1 to 22.');
 return tileRange(corridorBounds(path,bufferMeters),zoom);
}
export function corridorTiles(path:Point[],bufferMeters:number,zoom:number,maxTiles:number):{tiles:{x:number;y:number;z:number}[];capped:boolean;count:number} {
 const r=corridorRange(path,bufferMeters,zoom),count=(r.x1-r.x0+1)*(r.y1-r.y0+1),limit=Math.min(count,maxTiles),tiles:{x:number;y:number;z:number}[]=[];
 for(let y=r.y0;y<=r.y1&&tiles.length<limit;y++)for(let x=r.x0;x<=r.x1&&tiles.length<limit;x++)tiles.push({x,y,z:zoom});
 return {tiles,capped:count>maxTiles,count};
}
export function corridorTileCount(path:Point[],bufferMeters:number,zoom:number):number {
 const r=corridorRange(path,bufferMeters,zoom);
 return (r.x1-r.x0+1)*(r.y1-r.y0+1);
}

function validBounds(value:unknown):CorridorBounds|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const b=value as Record<string,unknown>;
 const {minLat,maxLat,minLon,maxLon}=b;
 if(typeof minLat!=='number'||typeof maxLat!=='number'||typeof minLon!=='number'||typeof maxLon!=='number'||![minLat,maxLat,minLon,maxLon].every(Number.isFinite)||minLat < -90||maxLat > 90||minLon < -180||maxLon > 180||minLat>maxLat||minLon>maxLon)return null;
 return {minLat,maxLat,minLon,maxLon};
}

export function validateCorridorRecords(value:unknown):CorridorRecord[] {
 if(!Array.isArray(value))return [];
 const records:CorridorRecord[]=[],ids=new Set<string>();
 for(const item of value){
  if(!item||typeof item!=='object'||Array.isArray(item))continue;
  const source=item as Record<string,unknown>,bounds=validBounds(source.bounds);
  if(typeof source.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(source.id)||typeof source.name!=='string'||!source.name.trim()||source.name.trim().length>80||!bounds||!Number.isInteger(source.tileCount)||Number(source.tileCount)<1||Number(source.tileCount)>MAX_CORRIDOR_URLS||typeof source.estimatedBytes!=='number'||!Number.isFinite(source.estimatedBytes)||source.estimatedBytes<0||typeof source.createdAt!=='number'||!Number.isFinite(source.createdAt)||!Array.isArray(source.urls)||ids.has(source.id))continue;
  const urls=source.urls.filter((url):url is string=>typeof url==='string'&&url.startsWith('https://')).slice(0,MAX_CORRIDOR_URLS);
  if(!urls.length)continue;
  ids.add(source.id);records.push({id:source.id,name:source.name.trim(),bounds,tileCount:Math.min(Number(source.tileCount),urls.length),estimatedBytes:source.estimatedBytes,createdAt:source.createdAt,urls});
 }
 return records.slice(-MAX_CORRIDOR_RECORDS);
}

export function upsertCorridorRecord(records:CorridorRecord[],record:CorridorRecord):CorridorRecord[] {
 const clean=validateCorridorRecords([...records.filter(item=>item.id!==record.id),record]);
 return clean;
}

export function removeCorridorRecord(records:CorridorRecord[],id:string):CorridorRemoval {
 const clean=validateCorridorRecords(records),remaining=clean.filter(record=>record.id!==id),retained=new Set(remaining.flatMap(record=>record.urls));
 const removed=clean.filter(record=>record.id===id),orphanedUrls=[...new Set(removed.flatMap(record=>record.urls).filter(url=>!retained.has(url)))];
 return {records:remaining,orphanedUrls};
}

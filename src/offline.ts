import type {Point} from './types.js';
import {cumulative,atDistance,clamp} from './geometry.js';
const rad=Math.PI/180;
export function lon2tile(lon:number,zoom:number):number {return clamp(Math.floor((lon+180)/360*2**zoom),0,2**zoom-1);}
export function lat2tile(lat:number,zoom:number):number {return clamp(Math.floor((1-Math.asinh(Math.tan(lat*rad))/Math.PI)/2*2**zoom),0,2**zoom-1);}
export function tileRange(bounds:{minLat:number;maxLat:number;minLon:number;maxLon:number},zoom:number):{x0:number;x1:number;y0:number;y1:number} {
 return {x0:lon2tile(bounds.minLon,zoom),x1:lon2tile(bounds.maxLon,zoom),y0:lat2tile(bounds.maxLat,zoom),y1:lat2tile(bounds.minLat,zoom)};
}
function corridorBounds(path:Point[],bufferMeters:number) {
 const c=cumulative(path),total=c[c.length-1]||0,steps=Math.max(1,Math.min(512,Math.ceil(total/500)));
 let minLat=90,maxLat=-90,minLon=180,maxLon=-180;
 for(let i=0;i<=steps;i++) {
  const p=atDistance(path,c,total*i/steps);
  minLat=Math.min(minLat,p.lat);maxLat=Math.max(maxLat,p.lat);minLon=Math.min(minLon,p.lon);maxLon=Math.max(maxLon,p.lon);
 }
 const latBuf=bufferMeters/111320,lat0=clamp((minLat+maxLat)/2,-89.5,89.5),lonBuf=bufferMeters/(111320*Math.cos(lat0*rad));
 return {minLat:minLat-latBuf,maxLat:maxLat+latBuf,minLon:minLon-lonBuf,maxLon:maxLon+lonBuf};
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

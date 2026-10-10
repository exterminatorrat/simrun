import type {Point,Preferences} from './types.js';
import {cumulative,resample,validPoint} from './geometry.js';
import {endpoint} from './providers.js';

export type PoiKind='water'|'toilets';
export interface PointOfInterest extends Point {id:string;kind:PoiKind;name?:string}
const MAX_CORRIDOR_POINTS=64,MAX_RESULTS=100,cache=new Map<string,PointOfInterest[]>();

export function poiRouteHash(path:Point[]):string {
 let hash=2166136261;
 for(const point of path){const value=`${point.lat.toFixed(6)},${point.lon.toFixed(6)};`;for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619);}
 return `${hash>>>0}-${path.length}`;
}

function corridorPoints(path:Point[]):Point[] {
 if(path.length<2)throw Error('A routed path is needed to find nearby places.');
 const distances=cumulative(path),total=distances.at(-1)||0;
 if(!(total>0))throw Error('A non-zero routed path is needed to find nearby places.');
 const count=Math.max(2,Math.min(MAX_CORRIDOR_POINTS,Math.ceil(total/150)+1));
 return resample(path,count);
}

export function buildOverpassQuery(path:Point[]):string {
 const samples=corridorPoints(path),queries:string[]=[];
 for(const point of samples){
  const lat=point.lat.toFixed(5),lon=point.lon.toFixed(5),around=`around:80,${lat},${lon}`;
  queries.push(`nwr(${around})["amenity"~"^(drinking_water|toilets)$"];`);
  queries.push(`nwr(${around})["drinking_water"="yes"];`);
  queries.push(`nwr(${around})["natural"="spring"];`);
 }
 return `[out:json][timeout:20];\n(\n${queries.join('\n')}\n);\nout center 100;`;
}

export function parseOverpassResponse(value:unknown):PointOfInterest[] {
 if(!value||typeof value!=='object'||!Array.isArray((value as {elements?:unknown}).elements))throw Error('Overpass returned an invalid response.');
 const result:PointOfInterest[]=[],seen=new Set<string>();
 for(const raw of (value as {elements:unknown[]}).elements){
  if(!raw||typeof raw!=='object')continue;
  const element=raw as {type?:unknown;id?:unknown;lat?:unknown;lon?:unknown;center?:{lat?:unknown;lon?:unknown};tags?:Record<string,unknown>};
  if(typeof element.type!=='string'||!['node','way','relation'].includes(element.type)||!(typeof element.id==='string'||typeof element.id==='number'))continue;
  const tags=element.tags&&typeof element.tags==='object'?element.tags:{},amenity=tags.amenity,natural=tags.natural;
  const kind:PoiKind|undefined=amenity==='toilets'?'toilets':amenity==='drinking_water'||natural==='spring'||tags.drinking_water==='yes'?'water':undefined;
  if(!kind)continue;
  const lat=typeof element.lat==='number'?element.lat:element.center?.lat,lon=typeof element.lon==='number'?element.lon:element.center?.lon;
  const point={lat:Number(lat),lon:Number(lon)};if(!validPoint(point))continue;
  const id=`${element.type}/${element.id}/${kind}`;if(seen.has(id))continue;seen.add(id);
  const name=typeof tags.name==='string'?tags.name.trim().slice(0,120):typeof tags['name:en']==='string'?tags['name:en'].trim().slice(0,120):'';
  result.push({...point,id,kind,...(name?{name}:{})});if(result.length>=MAX_RESULTS)break;
 }
 return result;
}

export function clearPoiCache():void {cache.clear();}

export async function fetchPois(path:Point[],prefs:Preferences,signal:AbortSignal):Promise<PointOfInterest[]> {
 signal.throwIfAborted();
 if(!prefs.poiEnabled)throw Error('Enable optional water and toilet lookup in Settings first.');
 const url=endpoint(prefs.overpassUrl),query=buildOverpassQuery(path),key=`${url}|${poiRouteHash(path)}`;
 if(cache.has(key))return cache.get(key)!.map(place=>({...place}));
 const body=new URLSearchParams({data:query}),controller=new AbortController();
 let timedOut=false;
 const cancel=()=>controller.abort(signal.reason),timer=setTimeout(()=>{timedOut=true;controller.abort();},20000);
 signal.addEventListener('abort',cancel,{once:true});
 try{
  const response=await fetch(url,{method:'POST',body,signal:controller.signal,referrerPolicy:'strict-origin-when-cross-origin',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}});
  if(!response.ok)throw Error(`Overpass service unavailable (${response.status}).`);
  const places=parseOverpassResponse(await response.json());cache.set(key,places.map(place=>({...place})));
  if(cache.size>50)cache.delete(cache.keys().next().value!);
  return places;
 }catch(error){
  if(signal.aborted)throw signal.reason;
  if(timedOut)throw Error('Overpass request timed out.',{cause:error});
  if(error instanceof Error&&error.message.startsWith('Overpass'))throw error;
  throw Error('Overpass service is unavailable. Check your connection or endpoint.',{cause:error});
 }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
}

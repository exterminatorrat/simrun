import type {Point,Preferences,RouteProfile,Sport} from './types.js';
import {atDistance,cumulative,decodePolyline,lowerBound,resample,validPoint} from './geometry.js';
export interface RoutingProvider {route(points:Point[],profile:RouteProfile,signal:AbortSignal):Promise<Point[]>;elevation(path:Point[],signal:AbortSignal):Promise<Point[]>}
export class ProviderError extends Error {constructor(message:string,public status=0,public code=0){super(message);}}
/** Valhalla costing per profile; bicycle_type aliases are case-insensitive. */
export const PROFILE_OPTIONS:Record<RouteProfile,{costing:'pedestrian'|'bicycle';options:Record<string,unknown>}>={walk:{costing:'pedestrian',options:{}},hike:{costing:'pedestrian',options:{max_hiking_difficulty:6}},road:{costing:'bicycle',options:{bicycle_type:'Hybrid'}},mtb:{costing:'bicycle',options:{bicycle_type:'Mountain',use_roads:.1}}};
/** Per-activity profile, defaulting a run to walk and a ride to road. */
export const resolveProfile=(sport:Sport,profile?:RouteProfile):RouteProfile=>profile??(sport==='run'?'walk':'road');
/** Public Valhalla distance caps: about 100 km on foot and 150 km by bicycle. */
export const PUBLIC_CAP_METERS:Record<RouteProfile,number>={walk:100000,hike:100000,road:150000,mtb:150000};
const footProfile=(p:RouteProfile):boolean=>p==='walk'||p==='hike';
export const capMessage=(profile:RouteProfile):string=>`This route is longer than the public routing service allows for ${footProfile(profile)?'walking and hiking':'cycling'} (about ${Math.round(PUBLIC_CAP_METERS[profile]/1000)} km). Shorten the route, or self-host routing — see docs/SELF-HOST-VALHALLA.md.`;
/** Advisory warning above 80% of the public cap; routing is never blocked. */
export const routeCapWarning=(profile:RouteProfile,meters:number):string|null=>{const cap=PUBLIC_CAP_METERS[profile];return meters>cap*.8?`Long route: the public service caps ${footProfile(profile)?'walking and hiking':'cycling'} near ${Math.round(cap/1000)} km, so routing may fail. Self-hosting is documented in docs/SELF-HOST-VALHALLA.md.`:null;};
const queues=new Map<string,Promise<unknown>>(),lastRequests=new Map<string,number>();
const pause=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{signal.throwIfAborted();const done=()=>{signal.removeEventListener('abort',cancel);resolve();};const timer=setTimeout(done,ms);const cancel=()=>{clearTimeout(timer);reject(signal.reason);};signal.addEventListener('abort',cancel,{once:true});});
export function endpoint(value:string):string {const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search)throw Error('Provider URL must be HTTPS, without credentials, a query or a fragment.');return u.toString();}
async function rateSlot(host:string,signal:AbortSignal):Promise<void>{
 const acquire=async()=>{let last=lastRequests.get(host)||0;try{last=Math.max(last,Number(localStorage.getItem('simrun-rate:'+host)||0));}catch{}
 await pause(Math.max(0,1200-(Date.now()-last)),signal);signal.throwIfAborted();lastRequests.set(host,Date.now());try{localStorage.setItem('simrun-rate:'+host,String(Date.now()));}catch{}};
 if(typeof navigator!=='undefined'&&navigator.locks)await navigator.locks.request('simrun-rate:'+host,{signal},acquire);else await acquire();
}
async function getJSON<T>(url:URL,signal:AbortSignal,retry=true):Promise<T>{
 const host=url.host,previous=queues.get(host)||Promise.resolve();
 const job=previous.catch(()=>{}).then(async()=>{
  for(let attempt=0;attempt<(retry?2:1);attempt++){
   await rateSlot(host,signal);signal.throwIfAborted();
   const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);signal.addEventListener('abort',cancel,{once:true});const timer=setTimeout(()=>controller.abort(),18000);
   try{
    const response=await fetch(url,{signal:controller.signal,referrerPolicy:'strict-origin-when-cross-origin',headers:{Accept:'application/json'}});
    if(response.status===429){if(attempt===0&&retry){const after=response.headers.get('Retry-After');const wait=after?(Number.isFinite(Number(after))?Number(after)*1000:Date.parse(after)-Date.now()):2500;if(wait>30000)throw new ProviderError('Service is rate-limited. Please retry later.',429);await pause(Math.max(2500,wait||2500),signal);continue;}throw new ProviderError('Service is rate-limited. Please retry later.',429);}
    if(!response.ok){if(response.status>=500&&attempt===0&&retry){await pause(2000,signal);continue;}if(response.status===400){const body=await response.json().catch(()=>null) as {error_code?:number}|null;throw new ProviderError('No suitable route. Move the waypoints to nearby accessible paths.',400,typeof body?.error_code==='number'?body.error_code:0);}throw new ProviderError(`Service unavailable (${response.status}). Please retry.`,response.status);}
    return await response.json() as T;
   }catch(error){if(signal.aborted)throw signal.reason;if(error instanceof ProviderError)throw error;throw new ProviderError('Service could not be reached. Check your connection or provider settings.');}
   finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
  }throw new ProviderError('Service did not return a result.');
 });queues.set(host,job);return job;
}
export class ValhallaProvider implements RoutingProvider {
 constructor(private prefs:()=>Preferences){}
 async route(points:Point[],profile:RouteProfile,signal:AbortSignal):Promise<Point[]>{
  if(points.length<2||points.length>50||!points.every(validPoint))throw new ProviderError('Use between 2 and 50 valid waypoints.');
  const {costing,options}=PROFILE_OPTIONS[profile]??PROFILE_OPTIONS.walk;
  // Default-off avoid options. `use_hills` is documented for both pedestrian and bicycle;
  // `use_roads` (avoid roads) is the closest documented bicycle lever for avoiding highways.
  const prefs=this.prefs(),opts:Record<string,unknown>={...options};
  if(prefs.avoidHills)opts.use_hills=0;
  if(prefs.avoidHighways&&costing==='bicycle')opts.use_roads=0;
  const url=new URL(endpoint(prefs.routingUrl));
  url.searchParams.set('json',JSON.stringify({locations:points.map(({lat,lon})=>({lat,lon})),costing,costing_options:Object.keys(opts).length?{[costing]:opts}:undefined,units:'kilometers',directions_type:'none'}));
  let data:{trip?:{legs?:{shape:string}[]}};
  try{data=await getJSON<{trip?:{legs?:{shape:string}[]}}>(url,signal);}
  catch(error){if(error instanceof ProviderError&&error.status===400&&error.code===154)throw new ProviderError(capMessage(profile),400,154);throw error;}
  const legs=data.trip?.legs;if(!legs?.length)throw new ProviderError('No accessible route found. Move a waypoint and try again.');
  const path:Point[]=[];
  for(const leg of legs){const p=decodePolyline(leg.shape);path.push(...(path.length?p.slice(1):p));}
  if(path.length<2||path.length>100000)throw new ProviderError('Route geometry is empty or too large.');return path;
 }
 async elevation(path:Point[],signal:AbortSignal):Promise<Point[]>{
  const c=cumulative(path),total=c[c.length-1];
  // One small request, at most 60 samples: avoid public-service load and giant GET URLs.
  const count=Math.max(2,Math.min(60,Math.ceil(total/100)+1));
  const shape=resample(path,count).map(p=>({lat:+p.lat.toFixed(6),lon:+p.lon.toFixed(6)}));
  const url=new URL(endpoint(this.prefs().elevationUrl));url.searchParams.set('json',JSON.stringify({shape,height_precision:1}));
  const data=await getJSON<{height?:(number|null)[]}>(url,signal,false);const h=data.height;
  if(!h||h.length!==count||h.every(x=>x===null))throw new ProviderError('Elevation is unavailable. Route and GPX remain usable.');
  return path.map((p,i)=>{const f=c[i]/total*(count-1),lo=Math.min(count-2,Math.floor(f)),hi=lo+1,a=h[lo],b=h[hi];return typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=12000&&Math.abs(b)<=12000?{...p,ele:a+(b-a)*(f-lo)}:{...p};});
 }
}
export interface Place {name:string;lat:number;lon:number}
const searchCache=new Map<string,Place[]>();
export async function searchPlaces(query:string,prefs:Preferences,signal:AbortSignal):Promise<Place[]>{
 const match=query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
 if(match){const p={lat:+match[1],lon:+match[2],name:'Coordinates'};if(!validPoint(p))throw Error('Coordinates are outside latitude/longitude bounds.');return [p];}
 if(!prefs.geocodingEnabled)throw Error('Enable place search in Settings after reviewing the provider policy, or enter latitude, longitude.');
 const key=prefs.geocodingUrl+'|'+query.trim().toLowerCase();if(searchCache.has(key))return searchCache.get(key)!;
 try{const saved=JSON.parse(localStorage.getItem('simrun-search')||'{}');if(saved[key]&&Date.now()-saved[key].at<7*86400000){const places=saved[key].places;if(Array.isArray(places)&&places.every((p:Place)=>validPoint(p)&&typeof p.name==='string')){searchCache.set(key,places);return places;}}}catch{}
 const url=new URL(endpoint(prefs.geocodingUrl));url.searchParams.set('q',query.trim().slice(0,200));url.searchParams.set('format','jsonv2');url.searchParams.set('limit','5');
 const data=await getJSON<{display_name:string;lat:string;lon:string}[]>(url,signal,false);
 const places=data.map(p=>({name:p.display_name,lat:+p.lat,lon:+p.lon})).filter(validPoint).slice(0,5);
 searchCache.set(key,places);try{const old=JSON.parse(localStorage.getItem('simrun-search')||'{}');const entries=Object.entries(old).slice(-19);localStorage.setItem('simrun-search',JSON.stringify({...Object.fromEntries(entries),[key]:{at:Date.now(),places}}));}catch{}return places;
}

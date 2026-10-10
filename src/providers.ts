import type {Point,Place,Preferences,RouteProfile,Sport,RouteData,RouteSurfaceEdge,StreetNameSpan} from './types.js';
import {atDistance,cumulative,decodePolyline,lowerBound,resample,validPoint} from './geometry.js';
import {parseCoordinateQuery,parsePhotonResponse} from './places.js';
export type {Place} from './types.js';
export interface RoutingProvider {route(points:Point[],profile:RouteProfile,signal:AbortSignal):Promise<Point[]>;elevation(path:Point[],signal:AbortSignal):Promise<Point[]>;alternates?(points:Point[],profile:RouteProfile,signal:AbortSignal):Promise<Point[][]>;routeDetails?(path:Point[],profile:RouteProfile,signal:AbortSignal):Promise<RouteData>;lastCached?:boolean}
export class ProviderError extends Error {constructor(message:string,public status=0,public code=0){super(message);}}
/** Valhalla costing per profile; bicycle_type aliases are case-insensitive. */
export const PROFILE_OPTIONS:Record<RouteProfile,{costing:'pedestrian'|'bicycle';options:Record<string,unknown>}>={walk:{costing:'pedestrian',options:{}},hike:{costing:'pedestrian',options:{max_hiking_difficulty:6}},road:{costing:'bicycle',options:{bicycle_type:'Hybrid'}},mtb:{costing:'bicycle',options:{bicycle_type:'Mountain',use_roads:.1}}};
/** Per-activity profile, defaulting a run to walk and a ride to road. */
export const resolveProfile=(sport:Sport,profile?:RouteProfile):RouteProfile=>profile??(sport==='run'?'walk':'road');
/** Public Valhalla distance caps: about 100 km on foot and 150 km by bicycle. */
export const PUBLIC_CAP_METERS:Record<RouteProfile,number>={walk:100000,hike:100000,road:150000,mtb:150000};
type ValhallaManeuver={begin_shape_index?:number;end_shape_index?:number;street_names?:unknown};
type ValhallaLeg={shape:string;maneuvers?:ValhallaManeuver[]};
type RouteRecord={path:Point[];data:RouteData};
function routeRecord(legs:ValhallaLeg[]|undefined):RouteRecord {
 const path:Point[]=[],indices:{start:number;end:number;name:string}[]=[];
 for(const leg of legs??[]){
  const points=decodePolyline(leg.shape),offset=path.length?path.length-1:0;
  for(const maneuver of leg.maneuvers??[]){
   const names=Array.isArray(maneuver.street_names)?maneuver.street_names.filter((name):name is string=>typeof name==='string'&&!!name.trim()).map(name=>name.trim()):[];
   const begin=maneuver.begin_shape_index,end=maneuver.end_shape_index;
   if(!names.length||typeof begin!=='number'||typeof end!=='number'||!Number.isInteger(begin)||!Number.isInteger(end)||begin<0||end<begin||begin>=points.length)continue;
   indices.push({start:offset+begin,end:offset+Math.min(end,points.length-1),name:[...new Set(names)].join(' / ')});
  }
  path.push(...(path.length?points.slice(1):points));
 }
 if(path.length<2)return {path,data:{}};
 const distances=cumulative(path),streetNames:StreetNameSpan[]=indices.map(span=>({start:distances[span.start],end:distances[span.end],name:span.name}));
 return {path,data:streetNames.length?{streetNames}: {}};
}
function sameRoute(a:Point[],b:Point[]):boolean {
 if(a.length===b.length+1&&Math.abs(a[a.length-1].lat-b[0].lat)<1e-6&&Math.abs(a[a.length-1].lon-b[0].lon)<1e-6)a=a.slice(0,-1);
 return a.length===b.length&&a.every((p,i)=>Math.abs(p.lat-b[i].lat)<1e-6&&Math.abs(p.lon-b[i].lon)<1e-6);
}
function routeLabel(value:unknown):string|undefined {return typeof value==='string'&&/^[a-zA-Z0-9 _-]{1,64}$/.test(value.trim())?value.trim():undefined;}
const footProfile=(p:RouteProfile):boolean=>p==='walk'||p==='hike';
export const capMessage=(profile:RouteProfile):string=>`This route is longer than the public routing service allows for ${footProfile(profile)?'walking and hiking':'cycling'} (about ${Math.round(PUBLIC_CAP_METERS[profile]/1000)} km). Shorten the route, or self-host routing — see docs/SELF-HOST-VALHALLA.md.`;
/** Advisory warning above 80% of the public cap; routing is never blocked. */
export const routeCapWarning=(profile:RouteProfile,meters:number):string|null=>{const cap=PUBLIC_CAP_METERS[profile];return meters>cap*.8?`Long route: the public service caps ${footProfile(profile)?'walking and hiking':'cycling'} near ${Math.round(cap/1000)} km, so routing may fail. Self-hosting is documented in docs/SELF-HOST-VALHALLA.md.`:null;};
const queues=new Map<string,Promise<unknown>>(),lastRequests=new Map<string,number>();
// Opt-in, bounded offline cache for routing and elevation replies. Network-first: the
// provider is always contacted online; a cached reply is only a fallback.
const OFFLINE_KEY='simrun-offline-v1',OFFLINE_MAX=50,OFFLINE_TTL=30*86400000;
function readOffline():Record<string,{t:number;data:unknown}>{try{return JSON.parse(localStorage.getItem(OFFLINE_KEY)||'{}');}catch{return {};}}
function writeOffline(key:string,data:unknown):void{try{const all=readOffline();all[key]={t:Date.now(),data};const keys=Object.keys(all);if(keys.length>OFFLINE_MAX){keys.sort((a,b)=>all[a].t-all[b].t);for(const k of keys.slice(0,keys.length-OFFLINE_MAX))delete all[k];}localStorage.setItem(OFFLINE_KEY,JSON.stringify(all));}catch{}}
export function clearOfflineCache():void{try{localStorage.removeItem(OFFLINE_KEY);}catch{}}
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
 lastCached=false;
 private routeRecords:RouteRecord[]=[];
 constructor(private prefs:()=>Preferences){}
 private async request<T>(url:URL,signal:AbortSignal,retry=true):Promise<T> {
  const enabled=this.prefs().offlineRouting===true;
  if(!enabled){this.lastCached=false;return getJSON<T>(url,signal,retry);}
  const key=url.toString(),hit=readOffline()[key];
  try{const data=await getJSON<T>(url,signal,retry);writeOffline(key,data);this.lastCached=false;return data;}
  catch(error){if(hit&&Date.now()-hit.t<OFFLINE_TTL){this.lastCached=true;return hit.data as T;}throw error;}
 }
 /** Up to one alternate route, requested only when enabled and the estimate is under 60 km. */
 async alternates(points:Point[],profile:RouteProfile,signal:AbortSignal):Promise<Point[][]>{
  if(points.length<2||points.length>50||!points.every(validPoint))throw new ProviderError('Use between 2 and 50 valid waypoints.');
  const estimate=cumulative(points).at(-1)??0;
  const main=await this.route(points,profile,signal);
  if(estimate>=60000)return [main];
  const {costing,options}=PROFILE_OPTIONS[profile]??PROFILE_OPTIONS.walk;
  const prefs=this.prefs(),opts:Record<string,unknown>={...options};
  if(prefs.avoidHills)opts.use_hills=0;
  if(prefs.avoidHighways&&costing==='bicycle')opts.use_roads=0;
  const url=new URL(endpoint(prefs.routingUrl));
  url.searchParams.set('json',JSON.stringify({locations:points.map(({lat,lon})=>({lat,lon})),costing,costing_options:Object.keys(opts).length?{[costing]:opts}:undefined,units:'kilometers',directions_type:'instructions',alternates:1}));
  try{
   const data=await this.request<{alternates?:{trip?:{legs?:ValhallaLeg[]}}[]}>(url,signal);
   const records=(data.alternates??[]).map(trip=>routeRecord(trip.trip?.legs)).filter(record=>record.path.length>=2);
   this.routeRecords=[...this.routeRecords,...records];
   return records.length?records.map(record=>record.path):[main];
  }catch{return [main];}
 }
 async route(points:Point[],profile:RouteProfile,signal:AbortSignal):Promise<Point[]>{
  if(points.length<2||points.length>50||!points.every(validPoint))throw new ProviderError('Use between 2 and 50 valid waypoints.');
  const {costing,options}=PROFILE_OPTIONS[profile]??PROFILE_OPTIONS.walk;
  // Default-off avoid options. `use_hills` is documented for both pedestrian and bicycle;
  // `use_roads` (avoid roads) is the closest documented bicycle lever for avoiding highways.
  const prefs=this.prefs(),opts:Record<string,unknown>={...options};
  if(prefs.avoidHills)opts.use_hills=0;
  if(prefs.avoidHighways&&costing==='bicycle')opts.use_roads=0;
  const url=new URL(endpoint(prefs.routingUrl));
  url.searchParams.set('json',JSON.stringify({locations:points.map(({lat,lon})=>({lat,lon})),costing,costing_options:Object.keys(opts).length?{[costing]:opts}:undefined,units:'kilometers',directions_type:'instructions'}));
  let data:{trip?:{legs?:ValhallaLeg[]}};
  try{data=await this.request<{trip?:{legs?:ValhallaLeg[]}}>(url,signal);}
  catch(error){if(error instanceof ProviderError&&error.status===400&&error.code===154)throw new ProviderError(capMessage(profile),400,154);throw error;}
  const result=routeRecord(data.trip?.legs),path=result.path;
  if(path.length<2||path.length>100000)throw new ProviderError('Route geometry is empty or too large.');
  this.routeRecords=[...this.routeRecords,result].slice(-8);return path;
 }
 async routeDetails(path:Point[],profile:RouteProfile,signal:AbortSignal):Promise<RouteData>{
  signal.throwIfAborted();
  const record=this.routeRecords.find(item=>sameRoute(path,item.path)),routeData:RouteData={...(record?.data.streetNames?{streetNames:record.data.streetNames}: {})};
  if(!this.prefs().surfaceDataEnabled)return routeData;
  try{
   const surfaceData=await this.traceAttributes(path,profile,signal);
   if(surfaceData.surfaceEdges?.length)routeData.surfaceEdges=surfaceData.surfaceEdges;
  }catch(error){if(signal.aborted)throw signal.reason;}
  return routeData;
 }
 private async traceAttributes(path:Point[],profile:RouteProfile,signal:AbortSignal):Promise<RouteData>{
  const c=cumulative(path),total=c.at(-1)||0;if(!(total>0))return {};
  const count=Math.max(2,Math.min(500,Math.ceil(total/1000)+1)),shape=resample(path,count).map(p=>({lat:+p.lat.toFixed(6),lon:+p.lon.toFixed(6)}));
  const prefs=this.prefs(),{costing,options}=PROFILE_OPTIONS[profile]??PROFILE_OPTIONS.walk,opts:Record<string,unknown>={...options};
  if(prefs.avoidHills)opts.use_hills=0;if(prefs.avoidHighways&&costing==='bicycle')opts.use_roads=0;
  const url=new URL(endpoint(prefs.routingUrl)),base=url.pathname.replace(/\/$/,'');
  url.pathname=/\/route$/.test(base)?base.replace(/\/route$/,'/trace_attributes'):`${base}/trace_attributes`;
  url.searchParams.set('json',JSON.stringify({shape,costing,costing_options:Object.keys(opts).length?{[costing]:opts}:undefined,units:'kilometers',shape_match:'map_snap',filters:{action:'include',attributes:['edge.length','edge.road_class','edge.surface']}}));
  const data=await this.request<{units?:string;edges?:{length?:number;surface?:unknown;road_class?:unknown}[]}>(url,signal,false);
  const factor=data.units==='kilometers'?1000:data.units==='miles'?1609.344:data.units==='meters'?1:0;if(!factor)return {};
  const surfaceEdges:RouteSurfaceEdge[]=[];
  for(const edge of data.edges??[]){
   if(!Number.isFinite(edge.length)||edge.length!<=0)continue;
   const length=edge.length!*factor,surface=routeLabel(edge.surface),roadClass=routeLabel(edge.road_class);
   if(surface||roadClass)surfaceEdges.push({distance:length,...(surface?{surface}:{}),...(roadClass?{roadClass}:{})});

  }
  return surfaceEdges.length?{surfaceEdges}:{};
 }
 async elevation(path:Point[],signal:AbortSignal):Promise<Point[]>{
  const c=cumulative(path),total=c[c.length-1];
  // One small request, at most 120 samples (about one per 50 m): finer terrain without giant GET URLs.
  const count=Math.max(2,Math.min(120,Math.ceil(total/50)+1));
  const shape=resample(path,count).map(p=>({lat:+p.lat.toFixed(6),lon:+p.lon.toFixed(6)}));
  const url=new URL(endpoint(this.prefs().elevationUrl));url.searchParams.set('json',JSON.stringify({shape,height_precision:1}));
  const data=await this.request<{height?:(number|null)[]}>(url,signal,false);const h=data.height;
  if(!h||h.length!==count||h.every(x=>x===null))throw new ProviderError('Elevation is unavailable. Route and GPX remain usable.');
  return path.map((p,i)=>{const f=c[i]/total*(count-1),lo=Math.min(count-2,Math.floor(f)),hi=lo+1,a=h[lo],b=h[hi];return typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=12000&&Math.abs(b)<=12000?{...p,ele:a+(b-a)*(f-lo)}:{...p};});
 }
}
const searchCache=new Map<string,Place[]>();
export async function searchPlaces(query:string,prefs:Preferences,signal:AbortSignal):Promise<Place[]>{
 const coordinate=parseCoordinateQuery(query);if(coordinate)return [coordinate];
 if(!prefs.geocodingEnabled)throw Error('Enable place search in Settings after reviewing the provider policy, or enter latitude, longitude.');
 const key=prefs.geocodingUrl+'|'+query.trim().toLowerCase();if(searchCache.has(key))return searchCache.get(key)!;
 try{const saved=JSON.parse(localStorage.getItem('simrun-search')||'{}');if(saved[key]&&Date.now()-saved[key].at<7*86400000){const places=saved[key].places;if(Array.isArray(places)&&places.every((p:Place)=>validPoint(p)&&typeof p.name==='string')){searchCache.set(key,places);return places;}}}catch{}
 const url=new URL(endpoint(prefs.geocodingUrl));url.searchParams.set('q',query.trim().slice(0,200));url.searchParams.set('format','jsonv2');url.searchParams.set('limit','5');
 const data=await getJSON<{display_name:string;lat:string;lon:string}[]>(url,signal,false);
 const places=data.map(p=>({name:p.display_name,lat:+p.lat,lon:+p.lon})).filter(validPoint).slice(0,5);
 searchCache.set(key,places);try{const old=JSON.parse(localStorage.getItem('simrun-search')||'{}');const entries=Object.entries(old).slice(-19);localStorage.setItem('simrun-search',JSON.stringify({...Object.fromEntries(entries),[key]:{at:Date.now(),places}}));}catch{}return places;
}
export async function searchPhoton(query:string,photonUrl:string,signal:AbortSignal):Promise<Place[]> {
 const url=new URL(endpoint(photonUrl));url.searchParams.set('q',query.trim().slice(0,200));url.searchParams.set('limit','5');
 return parsePhotonResponse(await getJSON<unknown>(url,signal,false));
}

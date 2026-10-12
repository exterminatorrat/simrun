import type {Activity,Preferences,SavedPlace} from './types.js';
import {defaultPreferences,validateActivity,plannedPath,simulate} from './model.js';
import {MAX_SAVED_PLACES,validateSavedPlaces} from './places.js';
import {cumulative} from './geometry.js';
import {endpoint} from './providers.js';
export function readPreferences():Preferences {try{return validatePreferences(JSON.parse(localStorage.getItem('simrun-preferences')||'{}'));}catch{return {...defaultPreferences};}}
export function validatePreferences(value:unknown):Preferences {
 const p=value&&typeof value==='object'?value as Partial<Preferences>:{};
 const hrMax=Number.isFinite(p.hrMax)?Math.min(240,Math.max(100,Math.round(p.hrMax!))):defaultPreferences.hrMax;
 const corridorZoom=Number.isFinite(p.corridorZoom)?Math.min(14,Math.max(8,Math.round(p.corridorZoom!))):defaultPreferences.corridorZoom;
 const trimpRestingHr=p.trimpRestingHr===undefined?undefined:Number.isFinite(p.trimpRestingHr)&&p.trimpRestingHr>=30&&p.trimpRestingHr<=120?Math.round(p.trimpRestingHr):undefined;
 const trimpMaxHr=p.trimpMaxHr===undefined?undefined:Number.isFinite(p.trimpMaxHr)&&p.trimpMaxHr>=100&&p.trimpMaxHr<=240?Math.round(p.trimpMaxHr):undefined;
 if(p.trimpRestingHr!==undefined&&trimpRestingHr===undefined||p.trimpMaxHr!==undefined&&trimpMaxHr===undefined||trimpMaxHr!==undefined&&trimpMaxHr<=(trimpRestingHr??60)||trimpRestingHr!==undefined&&(trimpMaxHr??hrMax)<=trimpRestingHr)throw Error('TRIMP heart-rate preferences are invalid.');
 return {units:p.units==='imperial'?'imperial':'metric',theme:p.theme==='dark'?'dark':'light',mapBaseLayer:p.mapBaseLayer==='topo'?'topo':'vector',mapCyclingOverlay:p.mapCyclingOverlay===true,mapHikingOverlay:p.mapHikingOverlay===true,geocodingEnabled:p.geocodingEnabled===true,searchSuggestions:p.searchSuggestions===true,mapStyle:p.mapStyle?endpoint(p.mapStyle):defaultPreferences.mapStyle,mapStyleDark:p.mapStyleDark?endpoint(p.mapStyleDark):defaultPreferences.mapStyleDark,routingUrl:p.routingUrl?endpoint(p.routingUrl):defaultPreferences.routingUrl,elevationUrl:p.elevationUrl?endpoint(p.elevationUrl):defaultPreferences.elevationUrl,geocodingUrl:p.geocodingUrl?endpoint(p.geocodingUrl):defaultPreferences.geocodingUrl,photonUrl:p.photonUrl?endpoint(p.photonUrl):defaultPreferences.photonUrl,overpassUrl:p.overpassUrl?endpoint(p.overpassUrl):defaultPreferences.overpassUrl,poiEnabled:p.poiEnabled===true,surfaceDataEnabled:p.surfaceDataEnabled===true,hrMax,...(trimpRestingHr!==undefined?{trimpRestingHr}:{}),...(trimpMaxHr!==undefined?{trimpMaxHr}:{}),offlineRouting:p.offlineRouting===true,corridorZoom,avoidHighways:p.avoidHighways===true,avoidHills:p.avoidHills===true,alternates:p.alternates===true,tipsDismissed:p.tipsDismissed===true};
}
export function writePreferences(p:Preferences):void {localStorage.setItem('simrun-preferences',JSON.stringify(p));}
export class LocalStore {
 private db:IDBDatabase|null=null;private memory=new Map<string,Activity>();private draft:Activity|null=null;private savedPlaces:SavedPlace[]=[];available=false;
 async open():Promise<void>{
  this.db=await new Promise<IDBDatabase>((resolve,reject)=>{
   if(!globalThis.indexedDB){reject(Error('Browser storage is unavailable.'));return;}
   const req=indexedDB.open('simrun-local',1);let settled=false;const fail=(e:unknown)=>{settled=true;reject(e);};const timeout=setTimeout(()=>fail(Error('Local storage is blocked. Close other SimRun tabs and reload.')),4000);
   req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('activities'))d.createObjectStore('activities',{keyPath:'id'});if(!d.objectStoreNames.contains('meta'))d.createObjectStore('meta');};
   req.onsuccess=()=>{clearTimeout(timeout);if(settled){req.result.close();return;}settled=true;resolve(req.result);};req.onerror=()=>{clearTimeout(timeout);fail(req.error);};req.onblocked=()=>{clearTimeout(timeout);fail(Error('Local storage is blocked by another tab.'));};
  });this.available=true;this.db.onversionchange=()=>{this.db?.close();this.available=false;};
 }
 private transaction<T>(store:string,mode:IDBTransactionMode,work:(s:IDBObjectStore)=>IDBRequest<T>):Promise<T>{
  if(!this.db)return Promise.reject(Error('Local storage is unavailable.'));
  return new Promise((resolve,reject)=>{const tx=this.db!.transaction(store,mode),req=work(tx.objectStore(store));let result:T;req.onsuccess=()=>result=req.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||Error('Local data could not be saved.'));tx.onabort=()=>reject(tx.error||Error('Local save was aborted.'));});
 }
 async list():Promise<Activity[]>{const rows=this.available?await this.transaction<Activity[]>('activities','readonly',s=>s.getAll()):[...this.memory.values()];return rows.map(validateActivity).sort((a,b)=>b.updatedAt-a.updatedAt);}
 async save(a:Activity):Promise<void>{const clean=validateActivity(a);if(!this.available){this.memory.set(a.id,clean);return;}await this.transaction('activities','readwrite',s=>s.put(clean));}
 async remove(id:string):Promise<void>{if(!this.available){this.memory.delete(id);return;}await this.transaction('activities','readwrite',s=>s.delete(id));}
 async listSavedPlaces():Promise<SavedPlace[]>{const rows=this.available?await this.transaction<unknown>('meta','readonly',s=>s.get('saved-places')):this.savedPlaces;return validateSavedPlaces(rows);}
 async saveSavedPlace(value:SavedPlace):Promise<void>{const place=validateSavedPlaces([value])[0];if(!place)throw Error('Saved place is invalid.');const rows=await this.listSavedPlaces(),index=rows.findIndex(item=>item.id===place.id);if(index<0&&rows.length>=MAX_SAVED_PLACES)throw Error(`You can save up to ${MAX_SAVED_PLACES} places.`);if(index<0)rows.push(place);else rows[index]=place;this.savedPlaces=rows;if(this.available)await this.transaction('meta','readwrite',s=>s.put(rows,'saved-places'));}
 async removeSavedPlace(id:string):Promise<void>{const rows=(await this.listSavedPlaces()).filter(place=>place.id!==id);this.savedPlaces=rows;if(this.available)await this.transaction('meta','readwrite',s=>s.put(rows,'saved-places'));}
 async saveDraft(a:Activity):Promise<void>{const clean=validateActivity(a);if(!this.available){this.draft=clean;return;}await this.transaction('meta','readwrite',s=>s.put(clean,'draft'));}
 async readDraft():Promise<Activity|null>{const d=this.available?await this.transaction<Activity|undefined>('meta','readonly',s=>s.get('draft')):this.draft;return d?validateActivity(d):null;}
 async restore(activities:Activity[],savedPlaces:SavedPlace[]=[]):Promise<void>{
  const clean=activities.map(validateActivity),places=validateSavedPlaces(savedPlaces);
  if(!this.available){clean.forEach(a=>this.memory.set(a.id,a));this.savedPlaces=places;return;}
  await new Promise<void>((resolve,reject)=>{const tx=this.db!.transaction('activities','readwrite');const store=tx.objectStore('activities');clean.forEach(a=>store.put(a));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  await this.transaction('meta','readwrite',s=>s.put(places,'saved-places'));this.savedPlaces=places;
 }
}
export function createBackup(activities:Activity[],preferences:Preferences,savedPlaces:SavedPlace[]=[]):string {
 if(activities.length>500)throw Error('Backup can contain at most 500 activities.');
 const backup=JSON.stringify({product:'SimRun',version:1,createdAt:new Date().toISOString(),activities:activities.map(validateActivity),preferences:validatePreferences(preferences),savedPlaces:validateSavedPlaces(savedPlaces)},null,2);
 if(backup.length>50000000)throw Error('Backup must be smaller than 50 MB.');
 return backup;
}
export function parseBackup(text:string):{activities:Activity[];preferences:Preferences;savedPlaces:SavedPlace[]}{
 if(text.length>50000000)throw Error('Backup must be smaller than 50 MB.');const b=JSON.parse(text);
 if(b?.product!=='SimRun'||b.version!==1||!Array.isArray(b.activities)||b.activities.length>500)throw Error('Unsupported SimRun backup.');
 return {activities:b.activities.map(validateActivity),preferences:validatePreferences(b.preferences),savedPlaces:validateSavedPlaces(b.savedPlaces??[])};
}
export function serializeBackup(activities:Activity[],preferences:Preferences,savedPlaces:SavedPlace[],createdAt=new Date().toISOString()):string {
 return JSON.stringify({product:'SimRun',version:1,createdAt,activities,preferences,savedPlaces:validateSavedPlaces(savedPlaces)},null,2);
}
export function sanitizeTags(value:unknown):string[]|undefined{
 if(!Array.isArray(value))return undefined;
 const out:string[]=[],seen=new Set<string>();
 for(const v of value){
  if(typeof v!=='string')continue;
  const tag=v.trim().slice(0,24),key=tag.toLowerCase();
  if(!tag||seen.has(key))continue;
  seen.add(key);out.push(tag);
  if(out.length>=8)break;
 }
 return out.length?out:undefined;
}
export function collectionNames(rows:Activity[]):string[]{return [...new Set(rows.map(a=>a.collection).filter((name):name is string=>Boolean(name)))].sort((a,b)=>a.localeCompare(b));}
export function filterActivitiesByCollection(rows:Activity[],collection:string|null|undefined):Activity[]{
 if(collection===undefined)return rows;
 return rows.filter(a=>collection===null?!a.collection:a.collection===collection);
}
export async function removeActivities(store:LocalStore,ids:string[]):Promise<number>{
 const existing=new Set((await store.list()).map(a=>a.id)),selected=[...new Set(ids)].filter(id=>existing.has(id));
 await Promise.all(selected.map(id=>store.remove(id)));
 return selected.length;
}
export function searchActivities(rows:Activity[],query:string):Activity[]{
 const tokens=query.toLowerCase().split(/\s+/).filter(Boolean);
 if(!tokens.length)return rows;
 return rows.filter(a=>{const hay=[a.name,...(a.tags??[])].join('\n').toLowerCase();return tokens.every(t=>hay.includes(t));});
}
export function sortActivities(rows:Activity[],key:'updated'|'name'|'distance'|'duration'):Activity[]{
 const distances=new Map<Activity,number>(),durations=new Map<Activity,number>();
 for(const a of rows){
  if(key==='distance')distances.set(a,cumulative(plannedPath(a)).at(-1)??0);
  else if(key==='duration'){
   try{durations.set(a,simulate(a).duration);}catch{durations.set(a,Number.POSITIVE_INFINITY);}
  }
 }
 return [...rows].sort((a,b)=>{
  if(key==='updated')return b.updatedAt-a.updatedAt;
  if(key==='name')return a.name.localeCompare(b.name);
  if(key==='distance')return (distances.get(a)??0)-(distances.get(b)??0);
  return (durations.get(a)??Number.POSITIVE_INFINITY)-(durations.get(b)??Number.POSITIVE_INFINITY);
 });
}
export async function storageUsage():Promise<{usage:number;quota:number}|null>{
 const storage=globalThis.navigator?.storage;
 if(typeof storage?.estimate!=='function')return null;
 try{
  // Call through the receiver: a detached platform method throws "Illegal invocation".
  const e=await storage.estimate(),usage=Number(e?.usage),quota=Number(e?.quota);
  return Number.isFinite(usage)&&Number.isFinite(quota)?{usage,quota}:null;
}catch{return null;}
}

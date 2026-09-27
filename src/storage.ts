import type {Activity,Preferences} from './types.js';
import {defaultPreferences,validateActivity} from './model.js';
import {endpoint} from './providers.js';
export function readPreferences():Preferences {try{return validatePreferences(JSON.parse(localStorage.getItem('simrun-preferences')||'{}'));}catch{return {...defaultPreferences};}}
export function validatePreferences(value:unknown):Preferences {
 const p=value&&typeof value==='object'?value as Partial<Preferences>:{};
 return {units:p.units==='imperial'?'imperial':'metric',theme:p.theme==='dark'?'dark':'light',geocodingEnabled:p.geocodingEnabled===true,mapStyle:p.mapStyle?endpoint(p.mapStyle):defaultPreferences.mapStyle,routingUrl:p.routingUrl?endpoint(p.routingUrl):defaultPreferences.routingUrl,elevationUrl:p.elevationUrl?endpoint(p.elevationUrl):defaultPreferences.elevationUrl,geocodingUrl:p.geocodingUrl?endpoint(p.geocodingUrl):defaultPreferences.geocodingUrl};
}
export function writePreferences(p:Preferences):void {localStorage.setItem('simrun-preferences',JSON.stringify(p));}
export class LocalStore {
 private db:IDBDatabase|null=null;private memory=new Map<string,Activity>();private draft:Activity|null=null;available=false;
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
 async saveDraft(a:Activity):Promise<void>{const clean=validateActivity(a);if(!this.available){this.draft=clean;return;}await this.transaction('meta','readwrite',s=>s.put(clean,'draft'));}
 async readDraft():Promise<Activity|null>{const d=this.available?await this.transaction<Activity|undefined>('meta','readonly',s=>s.get('draft')):this.draft;return d?validateActivity(d):null;}
 async restore(activities:Activity[]):Promise<void>{
  const clean=activities.map(validateActivity);
  if(!this.available){clean.forEach(a=>this.memory.set(a.id,a));return;}
  await new Promise<void>((resolve,reject)=>{const tx=this.db!.transaction('activities','readwrite');const store=tx.objectStore('activities');clean.forEach(a=>store.put(a));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
 }
}
export function parseBackup(text:string):{activities:Activity[];preferences:Preferences}{
 if(text.length>50000000)throw Error('Backup must be smaller than 50 MB.');const b=JSON.parse(text);
 if(b?.product!=='SimRun'||b.version!==1||!Array.isArray(b.activities)||b.activities.length>500)throw Error('Unsupported SimRun backup.');
 return {activities:b.activities.map(validateActivity),preferences:validatePreferences(b.preferences)};
}

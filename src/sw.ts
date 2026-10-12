import type {CorridorBounds} from './offline.js';
export interface CorridorStatus {id:string;name:string;bounds:CorridorBounds;tileCount:number;estimatedBytes:number;createdAt:number}
export interface CacheStatus {shell:number;map:number;limit:number;bytes:number;corridors:CorridorStatus[]}
export interface CorridorDownloadInfo {id:string;name:string;bounds:CorridorBounds;createdAt:number}
export interface CorridorProgress {done:number;total:number;stored:number;failed:number;bytes:number;quota:boolean}
export interface CorridorDownloadResult {stored:number;failed:number;bytes:number;cancelled:boolean;quota:boolean}
const REQUEST_TIMEOUT=4000;
const ask=<T>(message:unknown):Promise<T|null>=>new Promise(resolve=>{
 const worker=navigator.serviceWorker?.controller;
 if(!worker){resolve(null);return;}
 const channel=new MessageChannel();
 const timer=setTimeout(()=>resolve(null),REQUEST_TIMEOUT);
 channel.port1.onmessage=event=>{clearTimeout(timer);resolve(event.data as T);};
 worker.postMessage(message,[channel.port2]);
});
export const offlineSupported=():boolean=>'serviceWorker' in navigator;
export function registerOfflineCache():void {
 if(!offlineSupported())return;
 try{navigator.serviceWorker.register('./sw.js').catch(()=>{});}catch{}
}
export const offlineStatus=():Promise<CacheStatus|null>=>ask<CacheStatus>({type:'simrun-cache-status'});
export const clearCachedMap=async():Promise<boolean>=>{
 const result=await ask<{cleared:boolean}>({type:'simrun-clear-map'});
 return result?.cleared===true;
};
export const deleteCorridor=(id:string):Promise<{deleted:boolean}|null>=>ask<{deleted:boolean}>({type:'simrun-corridor-delete',id});
export const cancelCorridor=(id:string):Promise<{cancelled:boolean}|null>=>ask<{cancelled:boolean}>({type:'simrun-corridor-cancel',id});
export function downloadCorridor(urls:string[],record:CorridorDownloadInfo,onProgress:(progress:CorridorProgress)=>void):Promise<CorridorDownloadResult|null> {
 const worker=navigator.serviceWorker?.controller;if(!worker)return Promise.resolve(null);
 return new Promise(resolve=>{
  const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(null);},300000);
  channel.port1.onmessage=event=>{
   const data=event.data as {type?:string;progress?:CorridorProgress;result?:CorridorDownloadResult};
   if(data?.type==='progress'&&data.progress){onProgress(data.progress);return;}
   if(data?.type==='complete'&&data.result){clearTimeout(timer);channel.port1.close();resolve(data.result);}
  };
  worker.postMessage({type:'simrun-corridor-download',urls,record},[channel.port2]);
 });
}

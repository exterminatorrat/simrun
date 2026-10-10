export interface CacheStatus {shell:number;map:number;limit:number}
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
/** Downloads bounded route-corridor tiles into the dedicated corridor cache. */
export const downloadCorridor=(urls:string[]):Promise<{stored:number;failed:number}|null>=>ask<{stored:number;failed:number}>({type:'simrun-corridor-download',urls});

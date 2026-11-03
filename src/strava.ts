import {t} from './i18n.js';
import type {SendFile} from './send.js';
export type StravaState=Readonly<{configured:boolean;connected:boolean}>;
const offline:StravaState={configured:false,connected:false};
export async function stravaState():Promise<StravaState> {
 try{const response=await fetch('./api/strava/config',{cache:'no-store'});if(!response.ok)return offline;const data=await response.json() as Partial<StravaState>;return {configured:Boolean(data.configured),connected:Boolean(data.connected)};}catch{return offline;}
}
export const stravaLoginUrl='./api/strava/login';
export async function stravaDisconnect():Promise<void> {
 await fetch('./api/strava/logout',{method:'POST'});
}
export interface StravaUploadResult{activityId?:number;pending?:boolean}
export async function stravaUpload(file:SendFile,name:string,description:string):Promise<StravaUploadResult> {
 const dataType=(file.name.slice(file.name.lastIndexOf('.')+1)||'').toLowerCase();
 const response=await fetch('./api/strava/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':file.name,'X-Data-Type':dataType,'X-Activity-Name':encodeURIComponent(name),'X-Activity-Description':encodeURIComponent(description)},body:file.data as BlobPart});
 const data=await response.json().catch(()=>({})) as {error?:string;activityId?:number;pending?:boolean};
 if(response.status===401)throw Error(t('Connect Strava before uploading.'));
 if(!response.ok)throw Error(data.error||t('Strava refused the upload.'));
 return data;
}

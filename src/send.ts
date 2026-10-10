import type {Activity} from './types.js';
import {exportGPX,safeFilename} from './gpx.js';
import {exportTCX} from './tcx.js';
import {exportFIT} from './fit.js';
import {simulate} from './model.js';
import {createBackup} from './storage.js';
import {createZip,type ZipEntry} from './zip.js';

export type FileFormat='gpx'|'tcx'|'fit';
export interface SendFile {name:string;type:string;data:string|Uint8Array}
export const platformGuidance=[
 {id:'strava',name:'Strava',format:'fit',url:'https://support.strava.com/en-us/articles/15402066-how-do-i-get-my-activities-to-strava',instruction:'Open Strava’s file uploader, choose the FIT file, and confirm the activity details.'},
 {id:'garmin',name:'Garmin Connect',format:'gpx',url:'https://support.garmin.com/en-US/?faq=ACgfZF717vAeVfhHgPrFv6',instruction:'Use Garmin Connect’s web upload flow to import the GPX activity file.'},
 {id:'coros',name:'COROS Training Hub',format:'gpx',url:'https://support.coros.com/hc/en-us/articles/24181489692436-Downloading-and-Using-Routes',instruction:'COROS documents GPX route import, not completed-activity file upload; this adds route geometry, not a training activity.'},
 {id:'trainingpeaks',name:'TrainingPeaks',format:'fit',url:'https://help.trainingpeaks.com/hc/en-us/articles/204072994-How-do-I-manually-upload-a-workout-file-into-TrainingPeaks',instruction:'Open or create a completed calendar workout, choose Upload → Browse, and select the FIT file.'},
 {id:'intervals',name:'intervals.icu',format:'gpx',url:'https://forum.intervals.icu/t/gpx-file-upload-now-supported/3405',instruction:'On the Calendar page choose Upload, then select the GPX file.'},
 {id:'ridewithgps',name:'Ride with GPS',format:'gpx',url:'https://support.ridewithgps.com/hc/en-us/articles/4419024044827-Upload-Activities-Routes-GPS-Files',instruction:'Choose Upload on the web, then save the GPX as a route or add it to activities.'}
] as const;
export type PlatformId=typeof platformGuidance[number]['id'];
export function createActivityFiles(activity:Activity):SendFile[] {
 if(activity.source==='draft')throw Error('Resolve the route before exporting. A waypoint preview is not a routed path.');
 const simulation=simulate(activity),base=`${activity.settings.start.slice(0,10)}-${safeFilename(activity.name)}`;
 return [
  {name:`${base}.gpx`,type:'application/gpx+xml',data:exportGPX(activity,simulation)},
  {name:`${base}.tcx`,type:'application/vnd.garmin.tcx+xml',data:exportTCX(activity,simulation)},
  {name:`${base}.fit`,type:'application/vnd.ant.fit',data:exportFIT(activity,simulation)}
 ];
}
export function selectPlatformFile(files:SendFile[],platform:PlatformId):SendFile|undefined {
 const format=platformGuidance.find(item=>item.id===platform)?.format;
 return files.find(file=>file.name.toLowerCase().endsWith(`.${format}`));
}
export function zipActivities(activities:Activity[],preferences?:Parameters<typeof createBackup>[1],savedPlaces:Parameters<typeof createBackup>[2]=[]):Uint8Array {
 const entries:ZipEntry[]=[];
 if(preferences)entries.push({name:'simrun-backup.json',data:createBackup(activities,preferences,savedPlaces)});
 for(const activity of activities){
  if(activity.source==='draft')continue;
  const files=createActivityFiles(activity),prefix=`${activity.settings.start.slice(0,10)}-${safeFilename(activity.name)}-${safeFilename(activity.id).slice(0,20)}`;
  for(const file of files){const extension=file.name.slice(file.name.lastIndexOf('.'));entries.push({name:`activities/${prefix}${extension}`,data:file.data,modifiedAt:new Date(activity.updatedAt)});}
 }
 if(!entries.length)throw Error('No resolved activities to export.');
 return createZip(entries);
}
export function downloadFiles(files:SendFile[]):void {
 for(const file of files){const url=URL.createObjectURL(new Blob([file.data],{type:file.type})),anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
}
export async function shareFiles(files:SendFile[]):Promise<'shared'|'downloaded'|'cancelled'> {
 const nativeFiles=files.map(file=>new File([file.data],file.name,{type:file.type}));
 if(typeof navigator.share!=='function'||typeof navigator.canShare!=='function'||!navigator.canShare({files:nativeFiles})){downloadFiles(files);return 'downloaded';}
 try{await navigator.share({title:'Simulated activity files from SimRun',files:nativeFiles});return 'shared';}
 catch(error){if(error instanceof DOMException&&error.name==='AbortError')return 'cancelled';downloadFiles(files);return 'downloaded';}
}
type WritableFile={write(data:Blob):Promise<void>;close():Promise<void>};
type DirectoryHandle={getFileHandle(name:string,options:{create:true}):Promise<{createWritable():Promise<WritableFile>}>};
type DirectoryPickerWindow=Window&{showDirectoryPicker?:(options:{mode:'readwrite'})=>Promise<DirectoryHandle>};
export async function saveFilesToFolder(files:SendFile[]):Promise<'saved'|'downloaded'|'cancelled'> {
 const picker=(window as DirectoryPickerWindow).showDirectoryPicker;
 if(typeof picker!=='function'){downloadFiles(files);return 'downloaded';}
 try{
  const directory=await picker.call(window,{mode:'readwrite'});
  for(const file of files){const handle=await directory.getFileHandle(file.name,{create:true}),writable=await handle.createWritable();await writable.write(new Blob([file.data],{type:file.type}));await writable.close();}
  return 'saved';
 }catch(error){if(error instanceof DOMException&&error.name==='AbortError')return 'cancelled';downloadFiles(files);return 'downloaded';}
}

import type {Activity,Point} from './types.js';
import {importedActivity} from './model.js';
import {validPoint} from './geometry.js';
import {importGPX} from './gpx.js';
export interface ImportResult {activity:Activity;notice:string}
const MAX_LENGTH=15000000,MAX_POINTS=100000;
function checkSize(text:string,label:string):void {if(text.length>MAX_LENGTH)throw Error(`${label} must be smaller than 15 MB.`);}
function position(lon:unknown,lat:unknown,ele:unknown):Point {
 const p:Point={lat:Number(lat),lon:Number(lon)};
 if(!validPoint(p))throw Error('Route file contains invalid coordinates.');
 if(ele!==undefined&&ele!==null&&String(ele).trim()!==''&&Number.isFinite(Number(ele))&&Math.abs(Number(ele))<=12000)p.ele=Number(ele);
 return p;
}
/** Keeps the largest continuous segment; never invents a connecting line across gaps. */
function largest(candidates:Point[][],label:string):{points:Point[];notice:string} {
 const usable=candidates.filter(c=>c.length>=2);
 if(!usable.length)throw Error(`${label} has no line with at least two points.`);
 if(usable.reduce((n,c)=>n+c.length,0)>MAX_POINTS)throw Error(`${label} exceeds 100,000 points.`);
 const points=usable.reduce((a,b)=>b.length>a.length?b:a);
 const notice=usable.length>1?`Imported the largest of ${usable.length} disjoint segments; no artificial connections were added.`:'';
 return {points,notice};
}
function merge(segmentNotice:string,result:{activity:Activity;notices:string[]}):ImportResult {
 return {activity:result.activity,notice:[segmentNotice,...result.notices].filter(Boolean).join(' ')};
}
/** Parses a KML <coordinates> value: whitespace-separated `lon,lat[,alt]` tuples. */
export function parseKmlCoordinates(text:string):Point[] {
 const out:Point[]=[];
 for(const tuple of text.trim().split(/\s+/).filter(Boolean)){
  const parts=tuple.split(',');if(parts.length<2)continue;
  out.push(position(parts[0],parts[1],parts[2]));
 }
 return out;
}
export function importGeoJSON(text:string):ImportResult {
 checkSize(text,'GeoJSON');
 let data:unknown;try{data=JSON.parse(text);}catch{throw Error('This file is not valid GeoJSON.');}
 const candidates:Point[][]=[];let name='';
 const walk=(node:any):void=>{
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){node.forEach(walk);return;}
  if(node.type==='FeatureCollection'){if(!name&&typeof node.name==='string')name=node.name;(node.features??[]).forEach(walk);return;}
  if(node.type==='Feature'){const p=node.properties??{};if(!name)name=String(p.name??p.title??'');walk(node.geometry);return;}
  if(node.type==='GeometryCollection'){(node.geometries??[]).forEach(walk);return;}
  if(node.type==='LineString'){candidates.push((node.coordinates??[]).map((c:any)=>position(c?.[0],c?.[1],c?.[2])));return;}
  if(node.type==='MultiLineString'){(node.coordinates??[]).forEach((line:any)=>candidates.push((line??[]).map((c:any)=>position(c?.[0],c?.[1],c?.[2]))));return;}
 };
 walk(data);
 const {points,notice}=largest(candidates,'GeoJSON');
 return merge(notice,importedActivity(points,name,name,'GeoJSON'));
}
export function importKML(text:string):ImportResult {
 checkSize(text,'KML');
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('KML with document types or entities is not supported.');
 const doc=new DOMParser().parseFromString(text,'application/xml');
 if(doc.getElementsByTagName('parsererror').length||doc.documentElement.localName!=='kml')throw Error('This file is not valid KML XML.');
 const all=(node:Element|Document,tag:string)=>Array.from(node.getElementsByTagNameNS('*',tag));
 const candidates:Point[][]=[];
 for(const line of all(doc,'LineString')){const pts=parseKmlCoordinates(all(line,'coordinates')[0]?.textContent??'');if(pts.length)candidates.push(pts);}
 for(const track of all(doc,'Track')){
  const whens=all(track,'when').map(w=>Date.parse(w.textContent??''));
  const pts=all(track,'coord').map((c,i)=>{const parts=(c.textContent??'').trim().split(/\s+/);const p=position(parts[0],parts[1],parts[2]);if(Number.isFinite(whens[i]))p.time=whens[i];return p;});
  if(pts.length)candidates.push(pts);
 }
 const {points,notice}=largest(candidates,'KML');
 const name=all(doc,'name')[0]?.textContent?.trim()??'';
 return merge(notice,importedActivity(points,name,name,'KML'));
}
export function importRouteFile(text:string,filename:string):ImportResult {
 const lower=filename.toLowerCase();
 if(lower.endsWith('.kml'))return importKML(text);
 if(lower.endsWith('.geojson')||lower.endsWith('.json'))return importGeoJSON(text);
 if(lower.endsWith('.gpx'))return importGPX(text);
 const head=text.replace(/^\uFEFF/,'').trimStart().slice(0,400).toLowerCase();
 if(head.startsWith('{')||head.startsWith('['))return importGeoJSON(text);
 if(head.includes('<kml'))return importKML(text);
 if(head.includes('<gpx'))return importGPX(text);
 throw Error('Unsupported route file. Use GPX, KML or GeoJSON.');
}

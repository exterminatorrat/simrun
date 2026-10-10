import type {Activity,Point,Sport} from './types.js';
import {validPoint} from './geometry.js';

/** Shared links carry geometry only; the recipient re-simulates timing. */
export const SHARE_POINT_LIMIT=20000,SHARE_WARN_CHARS=8000,QR_CHAR_LIMIT=2000;

function encodeChunk(value:number):string {
 let v=value<0?~(value<<1):value<<1,out='';
 do{let c=v&31;v>>>=5;if(v)c|=32;out+=String.fromCharCode(c+63);}while(v);
 return out;
}

export function encodePolyline(points:Point[],precision=1e5):string {
 let out='',pLat=0,pLon=0;
 for(const p of points){
  const lat=Math.round(p.lat*precision),lon=Math.round(p.lon*precision);
  out+=encodeChunk(lat-pLat)+encodeChunk(lon-pLon);pLat=lat;pLon=lon;
 }
 return out;
}

export function decodePolyline(text:string,precision=1e5):Point[] {
 const out:Point[]=[];let lat=0,lon=0,i=0;
 const chunk=()=>{
  let result=0,shift=0,c:number;
  do{
   if(i>=text.length)throw Error('Truncated polyline.');
   c=text.charCodeAt(i++)-63;
   if(c<0||c>63)throw Error('Malformed polyline.');
   result|=(c&31)<<shift;shift+=5;
  }while(c&32);
  return result&1?~(result>>1):result>>1;
 };
 while(i<text.length){lat+=chunk();lon+=chunk();out.push({lat:lat/precision,lon:lon/precision});}
 return out;
}

const sportTag:Record<Sport,string>={run:'0',ride:'1',walk:'2',hike:'3','trail-run':'4',mtb:'5'};
const tagSport:Record<string,Sport>={'0':'run','1':'ride','2':'walk','3':'hike','4':'trail-run','5':'mtb'};

function toBase64Url(text:string):string {
 const bytes=new TextEncoder().encode(text);let bin='';
 for(const b of bytes)bin+=String.fromCharCode(b);
 return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function fromBase64Url(text:string):string {
 const b64=text.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(text.length/4)*4,'=');
 const bin=atob(b64);
 return new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0)));
}

export function encodeShare(a:Activity):string {
 if(a.path.length>SHARE_POINT_LIMIT)throw Error(`Route has ${a.path.length} points; share links support at most ${SHARE_POINT_LIMIT}.`);
 return `r=${toBase64Url(sportTag[a.settings.sport]+encodePolyline(a.path))}`;
}

export function decodeShare(fragment:string):{points:Point[];sport:Sport}|null {
 try{
  if(!fragment)return null;
  let s=fragment;
  const hash=s.indexOf('#');
  if(hash>=0)s=s.slice(hash+1);
  s=s.trim();
  if(!s)return null;
  const param=/(?:^|[?&])r=([A-Za-z0-9_-]+)/.exec(s);
  const payload=param?param[1]!:s.startsWith('r=')?s.slice(2):s;
  if(payload.length>SHARE_POINT_LIMIT*32)return null;
  const text=fromBase64Url(payload);
  const tag=text[0];
  if(!(tag in tagSport))return null;
  const points=decodePolyline(text.slice(1));
  if(points.length>SHARE_POINT_LIMIT)return null;
  for(const p of points)if(!validPoint(p))return null;
  return {points,sport:tagSport[tag]!};
 }catch{return null;}
}

export function shareUrl(base:string,a:Activity):string {
 return `${base}#${encodeShare(a)}`;
}

export function shareWarning(url:string):string|null {
 if(url.length>QR_CHAR_LIMIT)return `Share link is ${url.length} characters — too long for a QR code, export GPX instead.${url.length>SHARE_WARN_CHARS?' It is also long enough that some apps may truncate it.':''}`;
 if(url.length>SHARE_WARN_CHARS)return `Share link is ${url.length} characters — some apps may truncate links this long.`;
 return null;
}

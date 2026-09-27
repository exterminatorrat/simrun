import type {Point,ElevationStats} from './types.js';
const R=6371008.8, rad=Math.PI/180;
export const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
export const wrapLon=(n:number)=>((n+180)%360+360)%360-180;
export function validPoint(p:Point):boolean {return !!p && Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;}
export function distance(a:Point,b:Point):number {
 const x=(b.lat-a.lat)*rad,y=wrapLon(b.lon-a.lon)*rad;
 const h=Math.sin(x/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(y/2)**2;
 return R*2*Math.atan2(Math.sqrt(clamp(h,0,1)),Math.sqrt(clamp(1-h,0,1)));
}
export function cumulative(path:Point[]):number[] {
 const c:number[]=[];let sum=0;
 path.forEach((p,i)=>{if(!validPoint(p))throw Error('Route contains an invalid coordinate.');if(i)sum+=distance(path[i-1],p);c.push(sum);});return c;
}
export function lowerBound(values:number[],x:number):number {
 let a=0,b=values.length-1;
 while(a<b){const m=(a+b)>>1;if(values[m]<x)a=m+1;else b=m;}return a;
}
export function interpolate(a:Point,b:Point,t:number):Point {
 t=clamp(t,0,1);if(t===0)return {...a};if(t===1)return {...b};
 const arc=distance(a,b)/R;let lat:number,lon:number;
 if(arc<1e-8||Math.abs(Math.sin(arc))<1e-8){lat=a.lat+(b.lat-a.lat)*t;lon=wrapLon(a.lon+wrapLon(b.lon-a.lon)*t);}
 else {
  const f=Math.sin((1-t)*arc)/Math.sin(arc),g=Math.sin(t*arc)/Math.sin(arc);
  const x=f*Math.cos(a.lat*rad)*Math.cos(a.lon*rad)+g*Math.cos(b.lat*rad)*Math.cos(b.lon*rad);
  const y=f*Math.cos(a.lat*rad)*Math.sin(a.lon*rad)+g*Math.cos(b.lat*rad)*Math.sin(b.lon*rad);
  const z=f*Math.sin(a.lat*rad)+g*Math.sin(b.lat*rad);
  lat=Math.atan2(z,Math.hypot(x,y))/rad;lon=Math.atan2(y,x)/rad;
 }
 const p:Point={lat,lon};
 if(Number.isFinite(a.ele)&&Number.isFinite(b.ele))p.ele=a.ele!+(b.ele!-a.ele!)*t;
 return p;
}
export function atDistance(path:Point[],c:number[],d:number):Point {
 if(!path.length)throw Error('No route available.');
 const i=lowerBound(c,clamp(d,0,c[c.length-1]));if(i===0)return {...path[0]};
 return interpolate(path[i-1],path[i],c[i]===c[i-1]?1:(d-c[i-1])/(c[i]-c[i-1]));
}
export function resample(path:Point[],count:number):Point[] {const c=cumulative(path);return Array.from({length:count},(_,i)=>atDistance(path,c,c[c.length-1]*i/(count-1)));}
export function outAndBack<T>(path:T[]):T[]{return [...path,...path.slice(0,-1).reverse()];}
export function elevationStats(path:Point[]):ElevationStats {
 const values=path.filter(p=>Number.isFinite(p.ele));if(values.length<2)return {gain:null,loss:null,min:null,max:null};
 let gain=0,loss=0,anchor=values[0].ele!,min=anchor,max=anchor;
 // Three-meter deadband prevents tiny vertical jitter from becoming false climbing.
 for(const p of values){const h=p.ele!;min=Math.min(min,h);max=Math.max(max,h);const d=h-anchor;if(Math.abs(d)>=3){if(d>0)gain+=d;else loss-=d;anchor=h;}}
 return {gain,loss,min,max};
}
export function nearestSegmentIndex(points:Point[],p:Point):number {
 let best=Infinity,index=0;
 for(let i=1;i<points.length;i++){const score=distance(points[i-1],p)+distance(p,points[i])-distance(points[i-1],points[i]);if(score<best){best=score;index=i-1;}}return index;
}
/** Valhalla's default encoded shape uses six decimal digits, not five. */
export function decodePolyline(s:string):Point[] {
 let i=0,lat=0,lon=0;const out:Point[]=[];
 const value=()=>{let n=0,shift=0,b=0;do {if(i>=s.length||shift>30)throw Error('Invalid encoded route.');b=s.charCodeAt(i++)-63;n|=(b&31)<<shift;shift+=5;}while(b>=32);return n&1?~(n>>1):n>>1;};
 while(i<s.length){lat+=value();lon+=value();const p={lat:lat/1e6,lon:lon/1e6};if(!validPoint(p))throw Error('Invalid routed coordinate.');out.push(p);}return out;
}

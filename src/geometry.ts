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
export function closeLoop<T>(path:T[]):T[]{return path.length?[...path,path[0]]:[];}
/** A loop is a route whose end returns to its start, within a small tolerance for recorded GPS. */
export function isClosedLoop(path:Point[]):boolean {
 if(path.length<4)return false;
 const c=cumulative(path),total=c[c.length-1];
 return total>0&&distance(path[0],path[path.length-1])<=Math.max(5,total*.002);
}
/** Rotates a closed route so that `start` (a fraction of the loop) becomes its first point. */
export function rotatedLoop(path:Point[],start:number):Point[] {
 const c=cumulative(path),n=path.length-1,total=c[n],s=(clamp(start,0,1)%1)*total;
 let i=1;while(i<n&&c[i]<s)i++;
 const seg=c[i]-c[i-1],q=seg>0?interpolate(path[i-1],path[i],(s-c[i-1])/seg):{...path[i-1]};
 return [q,...path.slice(i,n),...path.slice(0,i),q];
}
/** Walks `laps` (fractional allowed) around a closed route from its rotated start. */
export function loopPath(path:Point[],start:number,laps:number):Point[] {
 const ring=rotatedLoop(path,start);if(ring.length<2||!(laps>0))return [];
 const c=cumulative(ring),total=c[c.length-1];if(!(total>0))return [];
 const full=Math.floor(laps),remainder=laps-full,out:Point[]=[];
 for(let k=0;k<full;k++)out.push(...(k?ring.slice(1):ring));
 if(remainder>1e-9){
  const target=remainder*total,part:Point[]=[];
  for(let i=1;i<ring.length&&c[i]<target;i++)part.push(ring[i]);
  part.push(atDistance(ring,c,target));if(!full)part.unshift(ring[0]);out.push(...part);
 }
 return out;
}
/** Distance along a route to the nearest point on its polyline; pass `c` to reuse a cumulative array. */
export function nearestOnPath(path:Point[],p:Point,c:number[]=cumulative(path)):number {
 let best=Infinity,d=0;
 for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i],seg=c[i]-c[i-1];let t=0;
  if(seg>0){
   const cos=Math.cos(a.lat*rad),bx=wrapLon(b.lon-a.lon)*cos,by=b.lat-a.lat,den=bx*bx+by*by;
   if(den>0)t=clamp((wrapLon(p.lon-a.lon)*cos*bx+(p.lat-a.lat)*by)/den,0,1);
  }
  const v=distance(p,interpolate(a,b,t));
  if(v<best){best=v;d=c[i-1]+seg*t;}
 }
 return d;
}
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

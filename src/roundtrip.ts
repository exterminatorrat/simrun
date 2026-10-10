import type {Point,RouteProfile} from './types.js';
import {clamp,cumulative,validPoint,wrapLon} from './geometry.js';

export interface RoundTripRouter {
 route(points:Point[],profile:RouteProfile,signal:AbortSignal):Promise<Point[]>;
}
export interface RoundTripResult {
 path:Point[];
 waypoints:Point[];
 targetMeters:number;
 achievedMeters:number;
 toleranceMeters:number;
 withinTolerance:boolean;
 calls:number;
 seed:number;
}

function randomFor(seed:number):()=>number {
 let value=seed>>>0;
 return ()=>{value=(value+0x6d2b79f5)>>>0;let next=Math.imul(value^(value>>>15),1|value);next=(next+Math.imul(next^(next>>>7),61|next))^next;return ((next^(next>>>14))>>>0)/4294967296;};
}
function offset(point:Point,meters:number,bearing:number):Point {
 const angle=bearing*Math.PI/180,lat=point.lat+meters*Math.cos(angle)/111320,lon=wrapLon(point.lon+meters*Math.sin(angle)/(111320*Math.max(.01,Math.cos(point.lat*Math.PI/180))));
 return {lat,lon};
}

export function roundTripWaypoints(start:Point,targetMeters:number,bearingDegrees:number,seed:number,scale=1):Point[] {
 if(!validPoint(start))throw Error('Enter a valid round-trip start coordinate.');
 if(!Number.isFinite(targetMeters)||targetMeters<=0||targetMeters>5000000)throw Error('Target distance must be between zero and 5,000 km.');
 if(!Number.isFinite(bearingDegrees)||!Number.isInteger(seed)||!Number.isFinite(scale)||scale<=0)throw Error('Bearing, seed, or route scale is invalid.');
 const random=randomFor(seed),bearing=bearingDegrees+random()*360,radius=targetMeters/(8*Math.sin(Math.PI/4))*scale,center=offset(start,radius,bearing),points:Point[]=[{lat:start.lat,lon:start.lon}];
 for(let i=1;i<4;i++)points.push(offset(center,radius,bearing+180+i*90));
 points.push({lat:start.lat,lon:start.lon});
 if(!points.every(validPoint))throw Error('Target loop falls outside valid latitude/longitude bounds.');
 return points;
}

export async function generateRoundTrip(router:RoundTripRouter,start:Point,targetMeters:number,bearingDegrees:number,seed:number,profile:RouteProfile,signal:AbortSignal,toleranceMeters=Math.max(25,targetMeters*.05)):Promise<RoundTripResult> {
 if(!Number.isFinite(toleranceMeters)||toleranceMeters<=0)throw Error('Round-trip tolerance must be greater than zero.');
 let scale=1,calls=0,best:RoundTripResult|null=null;
 for(;calls<4;calls++){
  signal.throwIfAborted();
  const waypoints=roundTripWaypoints(start,targetMeters,bearingDegrees,seed,scale),path=await router.route(waypoints,profile,signal);
  if(path.length<2)throw Error('Routing provider returned no road geometry.');
  const achievedMeters=cumulative(path).at(-1)??0;
  if(!(achievedMeters>0))throw Error('Routing provider returned a zero-distance route.');
  const result:RoundTripResult={path,waypoints,targetMeters,achievedMeters,toleranceMeters,withinTolerance:Math.abs(achievedMeters-targetMeters)<=toleranceMeters,calls:calls+1,seed};
  if(!best||Math.abs(result.achievedMeters-targetMeters)<Math.abs(best.achievedMeters-targetMeters))best=result;
  if(result.withinTolerance)return result;
  scale*=clamp(targetMeters/achievedMeters,.5,2);
 }
 if(!best)throw Error('No road route was returned.');
 return {...best,calls};
}

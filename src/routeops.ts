import {atDistance,clamp,cumulative,distance,nearestOnPath,validPoint,wrapLon} from './geometry.js';
import type {Point} from './types.js';

export const MAX_ROUTE_POINTS=100_000;
export const MAX_ROUTE_WAYPOINTS=50;

export interface MergeOptions {
 maxGapMeters:number;
 endpointToleranceMeters?:number;
 snapToleranceMeters?:number;
 connector?:Point[];
}

function assertPath(path:Point[]):number[] {
 if(!Array.isArray(path)||path.length<2)throw Error('A route needs at least two points.');
 if(path.length>MAX_ROUTE_POINTS)throw Error(`Routes are limited to ${MAX_ROUTE_POINTS.toLocaleString()} points.`);
 if(!path.every(validPoint))throw Error('Route contains an invalid coordinate.');
 return cumulative(path);
}

export function trimRouteByDistance(path:Point[],start:number,end:number):Point[] {
 const c=assertPath(path),total=c.at(-1)!;
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>total||start>=end||end-start<1)throw Error('Trim distances must form a range of at least one meter inside the route.');
 const result=[atDistance(path,c,start)];
 for(let i=1;i<path.length-1;i++)if(c[i]>start&&c[i]<end)result.push({...path[i]});
 result.push(atDistance(path,c,end));
 if(result.length>MAX_ROUTE_POINTS)throw Error(`Routes are limited to ${MAX_ROUTE_POINTS.toLocaleString()} points.`);
 return result;
}

export function trimRouteBetweenWaypoints(path:Point[],start:Point,end:Point):Point[] {
 assertPath(path);
 if(!validPoint(start)||!validPoint(end))throw Error('Trim waypoints contain an invalid coordinate.');
 return trimRouteByDistance(path,nearestOnPath(path,start),nearestOnPath(path,end));
}

export function waypointsInRange(path:Point[],waypoints:Point[],start:number,end:number):Point[] {
 const c=assertPath(path);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||end>c.at(-1)!)throw Error('Waypoint range must be inside the route.');
 if(waypoints.length>MAX_ROUTE_WAYPOINTS)throw Error(`Use at most ${MAX_ROUTE_WAYPOINTS} routing waypoints.`);
 if(!waypoints.every(validPoint))throw Error('Invalid waypoint.');
 return waypoints.filter(p=>{const d=nearestOnPath(path,p,c);return d>=start&&d<=end;}).map(p=>({...p}));
}

export function splitRouteAtDistance(path:Point[],splitDistance:number):[Point[],Point[]] {
 const c=assertPath(path),total=c.at(-1)!;
 if(!Number.isFinite(splitDistance)||splitDistance<1||splitDistance>total-1)throw Error('Choose a split point at least one meter inside the route.');
 const split=atDistance(path,c,splitDistance);
 const left=[atDistance(path,c,0)];
 for(let i=1;i<path.length-1;i++)if(c[i]<splitDistance)left.push({...path[i]});
 left.push(split);
 const right=[split];
 for(let i=1;i<path.length-1;i++)if(c[i]>splitDistance)right.push({...path[i]});
 right.push(atDistance(path,c,total));
 return [left,right];
}

export function splitRouteAtPoint(path:Point[],point:Point):[Point[],Point[]] {
 assertPath(path);
 if(!validPoint(point))throw Error('Split point contains an invalid coordinate.');
 return splitRouteAtDistance(path,nearestOnPath(path,point));
}

export function mergeRoutes(first:Point[],second:Point[],options:MergeOptions):Point[] {
 assertPath(first);
 assertPath(second);
 const gap=distance(first.at(-1)!,second[0]);
 const endpointTolerance=options.endpointToleranceMeters??1;
 const snapTolerance=options.snapToleranceMeters??50;
 if(!Number.isFinite(options.maxGapMeters)||options.maxGapMeters<0||!Number.isFinite(endpointTolerance)||endpointTolerance<0||!Number.isFinite(snapTolerance)||snapTolerance<0)throw Error('Merge gap limits must be finite and nonnegative.');
 if(gap>options.maxGapMeters)throw Error('Routes are too far apart to merge.');
 const connector=options.connector??[];
 if(gap>endpointTolerance){
  if(!connector.length)throw Error('Route the gap through the provider before merging these routes.');
  assertPath(connector);
  if(distance(first.at(-1)!,connector[0])>snapTolerance||distance(connector.at(-1)!,second[0])>snapTolerance)throw Error('The routed gap does not reach both route endpoints.');
 }else if(connector.length)assertPath(connector);
 const size=first.length+second.length+(gap>endpointTolerance?connector.length:0);
 if(size>MAX_ROUTE_POINTS+2)throw Error(`Routes are limited to ${MAX_ROUTE_POINTS.toLocaleString()} points.`);
 const merged=[...first.map(p=>({...p}))];
 const append=(points:Point[])=>{for(const p of points){if(distance(merged.at(-1)!,p)>0.01)merged.push({...p});}};
 if(gap>endpointTolerance)append(connector);
 append(second);
 if(merged.length>MAX_ROUTE_POINTS)throw Error(`Routes are limited to ${MAX_ROUTE_POINTS.toLocaleString()} points.`);
 return merged;
}

function segmentDistance(point:Point,start:Point,end:Point):number {
 const lat=(start.lat+end.lat+point.lat)/3*Math.PI/180,scale=111_195;
 const bx=wrapLon(end.lon-start.lon)*Math.cos(lat)*scale,by=(end.lat-start.lat)*scale;
 const px=wrapLon(point.lon-start.lon)*Math.cos(lat)*scale,py=(point.lat-start.lat)*scale;
 const den=bx*bx+by*by,t=den?clamp((px*bx+py*by)/den,0,1):0;
 return Math.hypot(px-bx*t,py-by*t);
}

export function simplifyRoute(path:Point[],toleranceMeters:number,maxPoints=MAX_ROUTE_POINTS):Point[] {
 assertPath(path);
 if(!Number.isFinite(toleranceMeters)||toleranceMeters<=0)throw Error('Simplification tolerance must be greater than zero.');
 if(!Number.isInteger(maxPoints)||maxPoints<2||maxPoints>MAX_ROUTE_POINTS)throw Error('Simplified route point limit is invalid.');
 const keep=new Uint8Array(path.length);keep[0]=1;keep[path.length-1]=1;
 const stack:[number,number][]=[[0,path.length-1]];
 while(stack.length){
  const [start,end]=stack.pop()!;let farthest=0,index=-1;
  for(let i=start+1;i<end;i++){const d=segmentDistance(path[i],path[start],path[end]);if(d>farthest){farthest=d;index=i;}}
  if(index>=0&&farthest>toleranceMeters){keep[index]=1;stack.push([start,index],[index,end]);}
 }
 const result=path.filter((_,i)=>keep[i]).map(p=>({...p}));
 if(result.length>maxPoints)throw Error(`Simplify the line to at most ${maxPoints} points.`);
 return result;
}

export function simplifyFreehand(path:Point[],toleranceMeters=20):Point[] {
 return simplifyRoute(path,toleranceMeters,MAX_ROUTE_WAYPOINTS);
}

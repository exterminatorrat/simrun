import type {Activity,Point,RouteSource,Settings} from './types.js';
import {defaults} from './model.js';
import {closeLoop,distance,outAndBack,validPoint} from './geometry.js';
import type {RoutingProvider} from './providers.js';
type Snapshot={path:Point[];waypoints:Point[];source:RouteSource};
export class Editor {
 activity:Activity=defaults();selected=-1;drawing=true;pending=false;status='Click the map to begin.';
 private past:Snapshot[]=[];private future:Snapshot[]=[];private controller:AbortController|null=null;private sequence=0;private timer:ReturnType<typeof setTimeout>|undefined;
 onChange:()=>void=()=>{};onMessage:(s:string)=>void=()=>{};
 constructor(private provider:RoutingProvider){}
 get canUndo(){return this.past.length>0;}get canRedo(){return this.future.length>0;}
 private snapshot():Snapshot {const {path,waypoints,source}=this.activity;return {path,waypoints,source};}
 private invalidate(){this.sequence++;this.controller?.abort();clearTimeout(this.timer);this.pending=false;}
 private notify(){this.activity.updatedAt=Date.now();this.onChange();}
 private checkpoint(){this.past.push(this.snapshot());if(this.past.length>35)this.past.shift();this.future=[];}
 load(a:Activity){this.invalidate();this.activity=a;this.past=[];this.future=[];this.selected=-1;this.status=a.source==='imported'?'Imported geometry · exports are simulated':a.path.length?'Route restored':'Click the map to begin.';this.notify();if(a.source==='draft'&&a.waypoints.length>=2)this.recalculate();}
 changeSettings(s:Partial<Settings>){const old=this.activity.settings.sport;this.activity.settings={...this.activity.settings,...s};this.notify();if(old!==this.activity.settings.sport&&this.activity.source!=='imported'&&this.activity.waypoints.length>=2){this.activity.source='draft';this.recalculate();}}
 edit(points:Point[]){if(points.length>50){this.onMessage('Use at most 50 routing waypoints.');return;}if(!points.every(validPoint)){this.onMessage('Invalid waypoint.');return;}this.checkpoint();this.invalidate();this.activity.waypoints=points.map(({lat,lon})=>({lat,lon}));this.activity.source='draft';if(points.length<2)this.activity.path=[];this.selected=Math.min(this.selected,points.length-1);this.notify();this.recalculate();}
 add(p:Point){this.edit([...this.activity.waypoints,p]);}
 move(i:number,p:Point){this.edit(this.activity.waypoints.map((v,j)=>i===j?p:v));this.selected=i;}
 insert(i:number,p:Point){const pts=[...this.activity.waypoints];pts.splice(i+1,0,p);this.edit(pts);this.selected=i+1;}
 remove(i:number){this.edit(this.activity.waypoints.filter((_,j)=>j!==i));}
 reorder(i:number,d:number){const pts=[...this.activity.waypoints];if(i+d<0||i+d>=pts.length)return;[pts[i],pts[i+d]]=[pts[i+d],pts[i]];this.edit(pts);this.selected=i+d;}
 clear(){this.checkpoint();this.invalidate();this.activity.path=[];this.activity.waypoints=[];this.activity.source='draft';this.selected=-1;this.status='Click the map to begin.';this.notify();}
 reverse(){if(this.activity.source==='imported'){this.checkpoint();this.activity.path=[...this.activity.path].reverse();this.notify();}else this.edit([...this.activity.waypoints].reverse());}
 outAndBack(){if(this.activity.source==='imported'){this.checkpoint();this.activity.path=outAndBack(this.activity.path);this.notify();}else this.edit(outAndBack(this.activity.waypoints));}
 closeLoop(){if(this.activity.source==='imported'){this.onMessage('Imported geometry is preserved. Use Waypoints → Convert to edit its road route.');return;}const points=this.activity.waypoints;if(points.length<2){this.onMessage('Add at least two waypoints before closing a loop.');return;}if(distance(points[0],points[points.length-1])<=5){this.onMessage('This route already returns to its start.');return;}this.edit(closeLoop(points));}
 undo(){const s=this.past.pop();if(!s)return;this.future.push(this.snapshot());this.restore(s);}
 redo(){const s=this.future.pop();if(!s)return;this.past.push(this.snapshot());this.restore(s);}
 private restore(s:Snapshot){this.invalidate();Object.assign(this.activity,s);this.selected=-1;this.status=s.source==='draft'?'Restoring waypoints…':'Route restored';this.notify();if(s.source==='draft')this.recalculate();}
 async recalculate(){
  this.invalidate();if(this.activity.waypoints.length<2){this.status=this.activity.waypoints.length?'Add another point to route.':'Click the map to begin.';this.notify();return;}
  this.activity.source='draft';this.pending=true;this.status='Finding accessible paths…';this.notify();const n=this.sequence;
  this.timer=setTimeout(async()=>{
   const controller=new AbortController();this.controller=controller;
   try{
    const path=await this.provider.route(this.activity.waypoints,this.activity.settings.sport,controller.signal);
    if(n!==this.sequence)return;this.activity.path=path;this.activity.source='routed';this.pending=false;this.status='Route ready · loading elevation';this.notify();
    try{const elevated=await this.provider.elevation(path,controller.signal);if(n!==this.sequence)return;this.activity.path=elevated;this.status='Route ready';this.notify();}
    catch(error){if(n!==this.sequence)return;this.status='Route ready · elevation unavailable';this.notify();}
   }catch(error){if(n!==this.sequence)return;this.pending=false;this.status='Route unavailable · move a point or retry';this.onMessage(error instanceof Error?error.message:'Route unavailable.');this.notify();}
  },450);
 }
 dispose(){this.invalidate();}
}

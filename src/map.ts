import type {Activity,Point} from './types.js';
import {atDistance,cumulative,interpolate,nearestOnPath,wrapLon} from './geometry.js';
import {el} from './ui.js';
// The only untyped boundary is MapLibre's optional browser UMD bundle.
// Application geometry and all provider contracts remain strictly typed.
declare global {interface Window {maplibregl?:any}}
type Actions={add:(p:Point)=>void;move:(i:number,p:Point)=>void;insert:(i:number,p:Point)=>void;select:(i:number)=>void;message:(s:string)=>void;loopStart:(fraction:number)=>void;freehand:(points:Point[])=>void};
type PlanMarks={start:Point;end:Point};
type MapClickEvent={originalEvent:{target:EventTarget|null};lngLat:{lat:number;lng:number}};
const NS='http://www.w3.org/2000/svg';
const world=(p:Point):[number,number]=>{const lat=Math.max(-85.0511,Math.min(85.0511,p.lat))*Math.PI/180;return [(p.lon+180)/360,(1-Math.log(Math.tan(Math.PI/4+lat/2))/Math.PI)/2];};
const unworld=(x:number,y:number):Point=>({lon:wrapLon(x*360-180),lat:Math.atan(Math.sinh(Math.PI*(1-2*Math.max(0,Math.min(1,y)))))*180/Math.PI});
/** Gradient legend: blue descending, green near-flat, red-orange climbing. */
const gradeColor=(g:number):string=>g<-.02?'#2f7fd0':g>.02?'#d94f2b':'#8fa66a';
const GRADE_STOPS:unknown[]=[-.15,'#2f7fd0',0,'#8fa66a',.15,'#d94f2b'];
export class RouteMap {
 private map:any=null;private markers:any[]=[];private hoverMarker:any=null;private a:Activity|null=null;private plan:PlanMarks|null=null;private selected=-1;private drawing=true;private svg:SVGSVGElement;private view={x:0,y:0,zoom:13};private ready=false;private everReady=false;private missingSince=Date.now();private healthTimer:ReturnType<typeof setInterval>|null=null;private lastMapError='';private disposed=false;private resized:ResizeObserver;private moveCleanup:(()=>void)|null=null;private hoverPoint:Point|null=null;
 private freehand=false;private freehandCleanup:(()=>void)|null=null;private suppressClick=false;
 private scrubberMarker:any=null;
 constructor(private host:HTMLElement,private actions:Actions){
  const [x,y]=world({lat:31.2304,lon:121.4737});this.view={x,y,zoom:13};
  this.svg=document.createElementNS(NS,'svg');this.svg.classList.add('coordinate-map');this.svg.setAttribute('aria-label','Coordinate canvas: basemap unavailable');this.host.append(this.svg);
  this.resized=new ResizeObserver(()=>{this.map?.resize();this.drawFallback();});this.resized.observe(host);this.bindFallback();this.bindFreehand();this.drawFallback();
 }
 async init(style:string):Promise<void>{
  try{
   const status=await fetch('./vendor-status.json').then(r=>r.json());
   if(status.bundled!==true)throw Error('Local map files are missing.');
   const base='./vendor/';
   await new Promise<void>((resolve,reject)=>{const css=el('link');css.rel='stylesheet';css.href=base+'maplibre-gl.css';const t=setTimeout(()=>reject(Error('Map styles did not load.')),10000);css.onload=()=>{clearTimeout(t);resolve();};css.onerror=()=>{clearTimeout(t);reject(Error('Map styles unavailable.'));};document.head.append(css);});
   if(!window.maplibregl)await new Promise<void>((resolve,reject)=>{const script=el('script');script.src=base+'maplibre-gl-csp.js';const t=setTimeout(()=>reject(Error('Map library did not load.')),10000);script.onload=()=>{clearTimeout(t);resolve();};script.onerror=()=>{clearTimeout(t);reject(Error('Map library unavailable.'));};document.head.append(script);});
   if(this.disposed)return;
   const gl=window.maplibregl;
   gl.setWorkerUrl(new URL('./vendor/maplibre-gl-csp-worker.js',document.baseURI).href);
   this.map=new gl.Map({container:this.host,style,center:[121.4737,31.2304],zoom:13,attributionControl:false});
   // Keep the honest coordinate canvas above MapLibre until real vector features render.
   this.showCoordinateCanvas();
   this.map.addControl(new gl.AttributionControl({customAttribution:'<a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a>'}));
   this.missingSince=Date.now();this.healthTimer=setInterval(()=>this.checkBasemap(),1200);
   this.map.on('load',()=>this.markBasemapReady());
   this.map.on('style.load',()=>{this.markBasemapReady();this.installLayers();this.render();});
   this.map.on('click',(e:MapClickEvent)=>{if(!this.suppressClick&&!this.freehand&&this.drawing&&e.originalEvent.target instanceof HTMLCanvasElement)this.actions.add({lat:e.lngLat.lat,lon:wrapLon(e.lngLat.lng)});});
   // A single missing tile or glyph does not take the map down. The health check
   // falls back only when the whole basemap has no rendered vector features.
   this.map.on('error',(event:any)=>{this.lastMapError=String(event?.error?.message||'Map resources unavailable.');if(this.ready){const warning=document.getElementById('map-warning')!;warning.hidden=false;warning.textContent='Some map data is unavailable. Route editing still works.';}});
   this.map.on('webglcontextlost',()=>this.useCoordinateCanvas('Map graphics unavailable. Coordinate view remains usable.'));
  }catch(error){const message=error instanceof Error?error.message:'';this.useCoordinateCanvas(/webgl|graphics/i.test(message)?'Map graphics unavailable. Coordinate view remains usable.':/style|library|local map/i.test(message)?'Map renderer unavailable. Coordinate view remains usable.':'Basemap unavailable. Coordinate view remains usable.');}
 }
 private showCoordinateCanvas():void {
  if(this.map){const center=this.map.getCenter(),[x,y]=world({lat:center.lat,lon:center.lng});this.view={x,y,zoom:this.map.getZoom()};}
  this.host.append(this.svg);this.host.classList.add('map-pending');this.drawFallback();
  const warning=document.getElementById('map-warning')!;warning.hidden=false;warning.textContent='Loading basemap · coordinate canvas available';
 }
 private markBasemapReady():void {
  if(!this.map||this.disposed||this.ready)return;
  this.ready=true;this.everReady=true;this.missingSince=0;
  if(this.healthTimer){clearInterval(this.healthTimer);this.healthTimer=null;}
  this.svg.remove();this.host.classList.remove('map-pending');document.getElementById('map-warning')!.hidden=true;
  this.installLayers();this.render();if(this.a?.path.length)this.fit();
 }
 private checkBasemap():void {
  if(!this.map||this.disposed||this.ready)return;
  if(Date.now()-this.missingSince>(this.everReady?12000:18000)){
   const detail=/worker|Content Security Policy|SecurityError/i.test(this.lastMapError)?'Map worker unavailable.':'Map style or tiles did not finish loading.';
   this.useCoordinateCanvas(`${detail} Coordinate view remains usable.`);
  }
 }
 private useCoordinateCanvas(message:string):void {
  if(this.healthTimer){clearInterval(this.healthTimer);this.healthTimer=null;}
  this.ready=false;
  try{this.map?.remove();}catch{}
  this.map=null;this.markers=[];this.hoverMarker=null;
  this.host.querySelectorAll('.maplibregl-canvas-container,.maplibregl-control-container').forEach(node=>node.remove());
  this.host.append(this.svg);this.host.classList.remove('map-pending');this.drawFallback();
  const warning=document.getElementById('map-warning')!;warning.hidden=false;warning.textContent=message;
  this.actions.message(message);
 }
 setStyle(style:string):void{if(!this.map)return;this.ready=false;this.missingSince=Date.now();this.lastMapError='';this.showCoordinateCanvas();try{this.map.setStyle(style,{diff:false});}catch{this.useCoordinateCanvas('Basemap unavailable. Coordinate view remains usable.');}}
 update(a:Activity,selected:number,drawing:boolean,plan?:PlanMarks):void {this.a=a;this.selected=selected;this.drawing=drawing;this.plan=plan??null;this.render();}
 setFreehand(enabled:boolean):void {this.freehand=enabled;if(!enabled)this.freehandCleanup?.();this.svg.style.cursor=enabled||this.drawing?'crosshair':'grab';}
 private installLayers():void {
  if(!this.map||this.map.getSource('route'))return;
  this.map.addSource('route',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  this.map.addLayer({id:'route-casing',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#fff','line-width':8,'line-opacity':.9}});
  this.map.addLayer({id:'route-line',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#e4552b','line-width':4}});
  this.map.addSource('draft',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  this.map.addLayer({id:'draft-line',type:'line',source:'draft',paint:{'line-color':'#a66146','line-width':2,'line-dasharray':[2,3]}});
  this.map.addSource('grade',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  this.map.addLayer({id:'route-gradient',type:'line',source:'grade',layout:{'line-cap':'round','line-join':'round','visibility':'none'},paint:{'line-color':['interpolate',['linear'],['get','g'],...GRADE_STOPS],'line-width':4}});
 }
 private render():void {
  if(!this.a)return;
  if(!this.map||!this.ready){this.drawFallback();return;}
  const data=(p:Point[])=>({type:'FeatureCollection',features:p.length>1?[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:p.map(p=>[p.lon,p.lat])}}]:[]});
  this.map.getSource('route')?.setData(data(this.a.path));this.map.getSource('draft')?.setData(data(this.a.source==='draft'?this.a.waypoints:[]));
  const grade=this.gradeSegments(this.a.path);
  this.map.getSource('grade')?.setData(grade);
  const shaded=grade.features.length>0;
  this.map.setLayoutProperty('route-line','visibility',shaded?'none':'visible');
  this.map.setLayoutProperty('route-gradient','visibility',shaded?'visible':'none');
  this.map.getCanvas().style.cursor=this.freehand||this.drawing?'crosshair':'grab';this.markers.forEach(m=>m.remove());this.markers=[];
  const gl=window.maplibregl,pts=this.a.waypoints;
  const add=(p:Point,i:number,mid=false)=>{const b=el('button',`waypoint ${mid?'midpoint':i===0?'start':i===pts.length-1?'finish':''} ${this.selected===i&&!mid?'selected':''}`,mid?'':String(i+1));b.type='button';b.title=mid?'Drag to insert waypoint':`Waypoint ${i+1}: drag to move`;b.setAttribute('aria-label',b.title);b.onclick=e=>{e.stopPropagation();if(mid)this.actions.insert(i,p);else this.actions.select(i);};const m=new gl.Marker({element:b,draggable:true}).setLngLat([p.lon,p.lat]).addTo(this.map);m.on('dragend',()=>{const ll=m.getLngLat(),q={lat:ll.lat,lon:wrapLon(ll.lng)};if(mid)this.actions.insert(i,q);else this.actions.move(i,q);});this.markers.push(m);};
  pts.forEach((p,i)=>{add(p,i);if(i<pts.length-1)add(this.middle(i),i,true);});
  if(!pts.length&&this.a.path.length){[this.a.path[0],this.a.path.at(-1)!].forEach((p,i)=>{const b=el('span',`waypoint ${i?'finish':'start'}`,i?'B':'A');this.markers.push(new gl.Marker({element:b}).setLngLat([p.lon,p.lat]).addTo(this.map));});}
  if(this.plan)this.planMarks().forEach(m=>{const b=el('span',`waypoint ${m.cls}`,m.text);b.title=m.title;b.setAttribute('aria-label',m.title);const mk=new gl.Marker({element:b,draggable:m.draggable}).setLngLat([m.p.lon,m.p.lat]).addTo(this.map);if(m.draggable)mk.on('dragend',()=>{const ll=mk.getLngLat();this.actions.loopStart(this.fractionAt({lat:ll.lat,lon:wrapLon(ll.lng)}));});this.markers.push(mk);});
 }
 private planMarks():{p:Point;cls:string;text:string;title:string;draggable:boolean}[] {
  const plan=this.plan;if(!plan)return [];
  return [{p:plan.start,cls:'plan-start',text:'S',title:'Loop start: drag along the loop',draggable:true},{p:plan.end,cls:'plan-finish',text:'E',title:'Loop end',draggable:false}];
 }
 /** Normalized distance of the point on the closed route nearest `p`. */
 private fractionAt(p:Point):number {const path=this.a?.path??[];if(path.length<2)return 0;const c=cumulative(path),total=c.at(-1)||0;return total>0?(nearestOnPath(path,p,c)/total)%1:0;}
 private middle(i:number):Point {
  const a=this.a!;if(a.source==='draft'||a.path.length<2)return interpolate(a.waypoints[i],a.waypoints[i+1],.5);
  // Find the nearest route samples to each waypoint, then follow route distance.
  const near=(p:Point)=>{const w=world(p);let best=Infinity,index=0;a.path.forEach((q,j)=>{const v=world(q),d=(v[0]-w[0])**2+(v[1]-w[1])**2;if(d<best){best=d;index=j;}});return index;};
  const lo=near(a.waypoints[i]),hi=near(a.waypoints[i+1]),part=a.path.slice(Math.min(lo,hi),Math.max(lo,hi)+1);if(part.length<2)return interpolate(a.waypoints[i],a.waypoints[i+1],.5);const c=cumulative(part);return atDistance(part,c,c.at(-1)!/2);
 }
 focus(p:Point):void {if(this.map)this.map.flyTo({center:[p.lon,p.lat],zoom:14});const [x,y]=world(p);this.view={x,y,zoom:14};this.drawFallback();}
 fit():void {
  const p=this.a?.path.length?this.a.path:this.a?.waypoints;if(!p?.length)return;
  if(this.map&&this.ready){const bounds=new window.maplibregl.LngLatBounds();p.forEach(p=>bounds.extend([p.lon,p.lat]));this.map.fitBounds(bounds,{padding:innerWidth>760?{top:100,bottom:230,left:100,right:390}:{top:100,bottom:210,left:50,right:50},maxZoom:16,duration:450});return;}
  // Reduce rather than spread: a 100,000-point route would exceed the argument limit of Math.min.
  const ps=p.map(world);let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const q of ps){if(q[0]<minX)minX=q[0];if(q[0]>maxX)maxX=q[0];if(q[1]<minY)minY=q[1];if(q[1]>maxY)maxY=q[1];}const r=this.host.getBoundingClientRect();
  this.view.x=(minX+maxX)/2;this.view.y=(minY+maxY)/2;this.view.zoom=Math.min(17,Math.max(1,Math.log2(Math.min(Math.max(100,r.width-(innerWidth>760?460:100))/Math.max(1e-7,maxX-minX),Math.max(100,r.height-350)/Math.max(1e-7,maxY-minY))/256)));this.drawFallback();
 }
 zoom(by:number):void {if(this.map){by>0?this.map.zoomIn():this.map.zoomOut();if(this.ready)return;}this.view.zoom=Math.max(1,Math.min(19,this.view.zoom+by));this.drawFallback();}
 hover(p:Point|null):void {this.hoverPoint=p;if(this.map&&this.ready){this.hoverMarker?.remove();if(p){const b=el('span','hover-marker');this.hoverMarker=new window.maplibregl.Marker({element:b}).setLngLat([p.lon,p.lat]).addTo(this.map);}}else this.drawFallback();}
 private dimensions(){const r=this.host.getBoundingClientRect();return {w:r.width,h:r.height,cx:r.width/2-(innerWidth>760?145:0),cy:r.height/2-60,scale:256*2**this.view.zoom};}
 private xy(p:Point):[number,number]{const {cx,cy,scale}=this.dimensions(),[x,y]=world(p);let dx=x-this.view.x;if(dx>.5)dx--;if(dx<-.5)dx++;return [cx+dx*scale,cy+(y-this.view.y)*scale];}
 private point(e:PointerEvent):Point {const {cx,cy,scale}=this.dimensions(),r=this.host.getBoundingClientRect();return unworld(this.view.x+(e.clientX-r.left-cx)/scale,this.view.y+(e.clientY-r.top-cy)/scale);}
 private drawFallback():void {
  if(!this.svg.isConnected)return;const {w,h}=this.dimensions();this.svg.setAttribute('viewBox',`0 0 ${w} ${h}`);this.svg.replaceChildren();
  const make=(tag:string,attrs:Record<string,string>)=>{const n=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));this.svg.append(n);return n;};
  const path=(p:Point[],cls:string)=>{if(p.length<2)return;const step=Math.max(1,Math.ceil(p.length/5000));const v=p.filter((_,i)=>i%step===0||i===p.length-1);make('path',{d:v.map((p,i)=>`${i?'L':'M'}${this.xy(p).map(n=>n.toFixed(1)).join(',')}`).join(' '),class:cls});};
  if(this.a){const grade=this.gradeSegments(this.a.path);
   if(grade.features.length){for(const f of grade.features){const [x1,y1]=this.xy({lat:f.geometry.coordinates[0][1],lon:f.geometry.coordinates[0][0]}),[x2,y2]=this.xy({lat:f.geometry.coordinates[1][1],lon:f.geometry.coordinates[1][0]});make('line',{x1:x1.toFixed(1),y1:y1.toFixed(1),x2:x2.toFixed(1),y2:y2.toFixed(1),class:'fallback-route','stroke-width':'4',stroke:gradeColor(f.properties.g)});}}
   else path(this.a.path,'fallback-route');if(this.a.source==='draft')path(this.a.waypoints,'fallback-draft');this.a.waypoints.forEach((p,i)=>{const [x,y]=this.xy(p);make('circle',{cx:String(x),cy:String(y),r:'12',class:`fallback-point ${i===this.selected?'selected':''}`,'data-index':String(i)});const t=make('text',{x:String(x),y:String(y+4),class:'fallback-number','data-index':String(i)});t.textContent=String(i+1);if(i<this.a!.waypoints.length-1){const [mx,my]=this.xy(this.middle(i));make('circle',{cx:String(mx),cy:String(my),r:'6',class:'fallback-mid','data-mid':String(i)});}});}
  if(this.plan)this.planMarks().forEach(m=>{const [x,y]=this.xy(m.p),flag:Record<string,string>=m.draggable?{'data-loop-start':'1'}:{};make('circle',{cx:String(x),cy:String(y),r:'10',class:`fallback-${m.cls}`,'data-loop':'1',...flag});const t=make('text',{x:String(x),y:String(y+3.5),class:'fallback-plan-label','data-loop':'1',...flag});t.textContent=m.text;});
  if(this.hoverPoint){const [x,y]=this.xy(this.hoverPoint);make('circle',{cx:String(x),cy:String(y),r:'6',class:'chart-map-marker'});}
  this.svg.style.cursor=this.freehand||this.drawing?'crosshair':'grab';
 }
 private bindFreehand():void {
  this.host.addEventListener('pointerdown',event=>{
   if(!this.freehand||event.button!==0)return;
   const target=event.target;
   if(target instanceof Element&&target.closest('[data-index],[data-mid],[data-loop]'))return;
   event.preventDefault();event.stopPropagation();this.startFreehand(event);
  },true);
 }
 private mapPoint(event:PointerEvent):Point {
  if(this.map&&this.ready){const rect=this.host.getBoundingClientRect(),p=this.map.unproject([event.clientX-rect.left,event.clientY-rect.top]);return {lat:p.lat,lon:wrapLon(p.lng)};}
  return this.point(event);
 }
 private startFreehand(event:PointerEvent):void {
  const rect=this.host.getBoundingClientRect(),points=[this.mapPoint(event)],line=document.createElementNS(NS,'polyline'),preview=document.createElementNS(NS,'svg');
  preview.classList.add('freehand-preview');preview.setAttribute('viewBox',`0 0 ${rect.width} ${rect.height}`);line.classList.add('freehand-stroke');preview.append(line);this.host.append(preview);this.suppressClick=true;
  let lastX=event.clientX,lastY=event.clientY;
  const update=()=>{line.setAttribute('points',points.map(p=>{const q=this.map&&this.ready?this.map.project([p.lon,p.lat]):{x:this.xy(p)[0],y:this.xy(p)[1]};return `${q.x},${q.y}`;}).join(' '));};
  const cleanup=()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',cancel,true);preview.remove();this.freehandCleanup=null;setTimeout(()=>{this.suppressClick=false;},0);};
  const move=(e:PointerEvent)=>{if(e.pointerId!==event.pointerId)return;if(Math.hypot(e.clientX-lastX,e.clientY-lastY)<3)return;const r=this.host.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return;lastX=e.clientX;lastY=e.clientY;if(points.length<5000)points.push(this.mapPoint(e));update();};
  const up=(e:PointerEvent)=>{if(e.pointerId!==event.pointerId)return;cleanup();if(points.length>1)this.actions.freehand(points);};
  const cancel=(e:PointerEvent)=>{if(e.pointerId===event.pointerId)cleanup();};
  this.freehandCleanup=()=>cleanup();window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',cancel,true);
  update();
 }
 private bindFallback():void {
  this.svg.addEventListener('wheel',e=>{e.preventDefault();this.zoom(e.deltaY<0?.5:-.5);},{passive:false});
  this.svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;const target=e.target as Element,loopStart=target.getAttribute('data-loop-start')==='1';if(target.getAttribute('data-loop')&&!loopStart)return;const idx=target.getAttribute('data-index'),mid=target.getAttribute('data-mid'),x=e.clientX,y=e.clientY,start={...this.view};let moved=false;this.svg.setPointerCapture(e.pointerId);
   const move=(v:PointerEvent)=>{moved ||=Math.hypot(v.clientX-x,v.clientY-y)>4;if(!loopStart&&idx===null&&mid===null&&moved){const scale=this.dimensions().scale;this.view.x=start.x-(v.clientX-x)/scale;this.view.y=start.y-(v.clientY-y)/scale;this.drawFallback();}};
   const up=(v:PointerEvent)=>{this.svg.removeEventListener('pointermove',move);this.svg.removeEventListener('pointerup',up);this.svg.removeEventListener('pointercancel',cancel);this.moveCleanup=null;if(loopStart)this.actions.loopStart(this.fractionAt(this.point(v)));else if(idx!==null){if(moved)this.actions.move(+idx,this.point(v));else this.actions.select(+idx);}else if(mid!==null)this.actions.insert(+mid,this.point(v));else if(!moved&&this.drawing)this.actions.add(this.point(v));else if(moved&&this.map){const p=unworld(this.view.x,this.view.y);this.map.jumpTo({center:[p.lon,p.lat],zoom:this.view.zoom});}};
   const cancel=()=>{this.svg.removeEventListener('pointermove',move);this.svg.removeEventListener('pointerup',up);this.svg.removeEventListener('pointercancel',cancel);};this.moveCleanup=cancel;this.svg.addEventListener('pointermove',move);this.svg.addEventListener('pointerup',up);this.svg.addEventListener('pointercancel',cancel);
  });
 }
 /** Gradient segments capped at 400, or an empty collection when elevation is missing. */
 private gradeSegments(path:Point[]):{type:'FeatureCollection';features:any[]} {
  const empty:{type:'FeatureCollection';features:any[]}={type:'FeatureCollection',features:[]};
  if(path.length<2)return empty;
  if(path.filter(p=>Number.isFinite(p.ele)).length<2)return empty;
  const c=cumulative(path),total=c.at(-1)||0;if(!(total>0))return empty;
  const count=Math.min(400,Math.max(1,path.length-1)),step=total/count,features:any[]=[];
  for(let i=0;i<count;i++){
   const d0=i*step,d1=Math.min(total,(i+1)*step),p=atDistance(path,c,d0),q=atDistance(path,c,d1);
   if(!Number.isFinite(p.ele)||!Number.isFinite(q.ele))continue;
   const g=Math.max(-.15,Math.min(.15,(q.ele!-p.ele!)/Math.max(1e-6,d1-d0)));
   features.push({type:'Feature',properties:{g},geometry:{type:'LineString',coordinates:[[p.lon,p.lat],[q.lon,q.lat]]}});
  }
  return {type:'FeatureCollection',features};
 }
 /** Persistent marker for the chart scrubber; cleared with null. */
 scrub(p:Point|null):void {
  this.hoverPoint=p;
  if(this.map&&this.ready){this.scrubberMarker?.remove();this.scrubberMarker=null;if(p){const b=el('span','scrub-marker');this.scrubberMarker=new window.maplibregl.Marker({element:b}).setLngLat([p.lon,p.lat]).addTo(this.map);}return;}
  this.drawFallback();
 }
 dispose():void {this.disposed=true;if(this.healthTimer)clearInterval(this.healthTimer);this.resized.disconnect();this.moveCleanup?.();this.freehandCleanup?.();this.markers.forEach(m=>m.remove());this.hoverMarker?.remove();this.scrubberMarker?.remove();this.map?.remove();}
}

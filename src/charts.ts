import type {Activity,Point,Preferences,Simulation} from './types.js';
import {cumulative} from './geometry.js';
import {clock,plannedPath} from './model.js';
export type ChartMode='elevation'|'pace'|'hr';
const NS='http://www.w3.org/2000/svg';
export class Charts {
 mode:ChartMode='elevation';private rows:{p:Point;d:number;v:number}[]=[];private total=0;private pref!:Preferences;private sport='run';private width=1000;
 constructor(private host:HTMLElement,private hover:(p:Point|null)=>void){host.addEventListener('pointermove',e=>this.cursor(e));host.addEventListener('pointerleave',()=>{this.hover(null);this.host.querySelector('.chart-tooltip')?.remove();this.host.querySelector('.cursor')?.remove();});}
 render(a:Activity,s:Simulation|null,pref:Preferences):void {
  this.pref=pref;this.sport=a.settings.sport;const imperial=pref.units==='imperial',path=plannedPath(a),c=cumulative(path);this.total=c.at(-1)||0;this.rows=[];this.host.replaceChildren();
  if(this.mode==='elevation')this.rows=path.map((p,i)=>({p,d:c[i],v:p.ele===undefined?NaN:p.ele*(imperial?3.28084:1)}));
  else if(this.mode==='hr'&&!a.settings.hrEnabled)this.rows=path.map((p,i)=>({p,d:c[i],v:p.hr??NaN}));
  else if(s)this.rows=s.points.map(p=>({p,d:p.distance,v:this.mode==='hr'?p.hr??NaN:a.settings.sport==='run'?(imperial?1609.344:1000)/p.speed:p.speed*3.6/(imperial?1.609344:1)}));
  const valid=this.rows.filter(r=>Number.isFinite(r.v));
  if(valid.length<2){const empty=document.createElement('div');empty.className='chart-empty';empty.textContent=!path.length?'Your route profile will appear here.':this.mode==='elevation'?'Elevation unavailable. Route and GPX export still work.':this.mode==='hr'?'Enable simulated heart rate in Activity settings.':'A completed route is needed for this profile.';this.host.append(empty);return;}
  const svg=document.createElementNS(NS,'svg');this.width=Math.max(250,this.host.clientWidth);svg.setAttribute('viewBox',`0 0 ${this.width} 125`);svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('role','img');svg.setAttribute('aria-label',`${this.mode} profile along route`);this.host.append(svg);
  const make=(tag:string,attrs:Record<string,string>,text='')=>{const n=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));n.textContent=text;svg.append(n);return n;};
  let lo=Math.min(...valid.map(r=>r.v)),hi=Math.max(...valid.map(r=>r.v));const pad=Math.max((hi-lo)*.2,this.mode==='elevation'?2:this.mode==='pace'?this.sport==='run'?5:1:2);lo-=pad;hi+=pad;
  const span=this.width-70;const px=(d:number)=>50+d/Math.max(1,this.total)*span,py=(v:number)=>98-(v-lo)/(hi-lo)*85;
  for(let i=0;i<3;i++){const y=15+i*41.5,v=hi-i*(hi-lo)/2;make('line',{x1:'50',x2:String(this.width-20),y1:String(y),y2:String(y),class:'grid'});make('text',{x:'40',y:String(y+3),'text-anchor':'end',class:'axis'},this.format(v));}
  const step=Math.max(1,Math.ceil(this.rows.length/1000)),sample=this.rows.filter((_,i)=>i%step===0||i===this.rows.length-1);let d='',started=false,lastTime:number|undefined;const gapMs=s?Math.max(1,s.interval*1000)*1.5:0;
  for(const r of sample){if(!Number.isFinite(r.v)){started=false;lastTime=undefined;continue;}if(started&&gapMs>0&&lastTime!==undefined&&r.p.time!==undefined&&r.p.time-lastTime>gapMs)started=false;d+=`${started?'L':'M'}${px(r.d).toFixed(2)} ${py(r.v).toFixed(2)} `;started=true;lastTime=r.p.time;}
  make('path',{d,class:'profile-line'});
  for(let i=0;i<5;i++)make('text',{x:String(50+i*span/4),y:'119','text-anchor':i===0?'start':i===4?'end':'middle',class:'axis'},`${(this.total*i/4/(imperial?1609.344:1000)).toFixed(1)} ${imperial?'mi':'km'}`);
 }
 private format(v:number):string{return this.mode==='pace'&&this.sport==='run'?clock(v):this.mode==='pace'?v.toFixed(1):String(Math.round(v));}
 private cursor(e:PointerEvent):void {
  if(this.rows.length<2||!this.host.querySelector('svg'))return;const r=this.host.getBoundingClientRect(),f=Math.max(0,Math.min(1,((e.clientX-r.left)/r.width*this.width-50)/(this.width-70))),d=f*this.total;let best=this.rows[0];for(const row of this.rows)if(Math.abs(row.d-d)<Math.abs(best.d-d))best=row;
  this.host.querySelector('.chart-tooltip')?.remove();this.host.querySelector('.cursor')?.remove();if(!Number.isFinite(best.v))return;
  const tip=document.createElement('div');tip.className='chart-tooltip';const imperial=this.pref.units==='imperial';tip.textContent=`${(best.d/(imperial?1609.344:1000)).toFixed(2)} ${imperial?'mi':'km'} · ${this.format(best.v)} ${this.mode==='elevation'?imperial?'ft':'m':this.mode==='hr'?'bpm':this.sport==='run'?imperial?'/mi':'/km':imperial?'mph':'km/h'}`;tip.style.left=`${Math.max(5,Math.min(r.width-170,e.clientX-r.left))}px`;this.host.append(tip);
  const line=document.createElementNS(NS,'line');Object.entries({x1:String(50+f*(this.width-70)),x2:String(50+f*(this.width-70)),y1:'5',y2:'101',class:'cursor'}).forEach(([k,v])=>line.setAttribute(k,v));this.host.querySelector('svg')!.append(line);this.hover(best.p);
 }
}

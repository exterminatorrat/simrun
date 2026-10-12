import type {Activity,Point,Preferences,Simulation,Sport} from './types.js';
import {atDistance,cumulative} from './geometry.js';
import {plannedPath} from './model.js';
import {formatClock,formatNumber,t} from './i18n.js';
import {perUnitSplits} from './analysis.js';
import {usesPace} from './sports.js';
export type ChartMode='elevation'|'pace'|'hr'|'power'|'cadence'|'splits';
const NS='http://www.w3.org/2000/svg';
const chartNames:Record<ChartMode,()=>string>={elevation:()=>t('Elevation'),pace:()=>t('Pace'),hr:()=>t('Heart rate'),power:()=>t('Power'),cadence:()=>t('Cadence'),splits:()=>t('Splits')};
export class Charts {
 mode:ChartMode='elevation';private rows:{p:Point;d:number;v:number}[]=[];private total=0;private pref!:Preferences;private sport:Sport='run';private width=1000;
 private grades:{d:number;g:number}[]=[];private scrubDistance:number|null=null;private scrubbing=false;
 constructor(private host:HTMLElement,private hover:(p:Point|null)=>void,private scrub?:(p:Point|null)=>void){
  host.setAttribute('tabindex','0');
  host.addEventListener('pointermove',e=>this.cursor(e));
  host.addEventListener('pointerdown',e=>{if(!this.rows.length)return;this.scrubbing=true;host.setPointerCapture?.(e.pointerId);this.cursor(e);});
  host.addEventListener('pointerup',e=>{this.scrubbing=false;host.releasePointerCapture?.(e.pointerId);});
  host.addEventListener('pointerleave',()=>{if(!this.scrubbing)this.clearOverlay();});
  host.addEventListener('keydown',e=>{if(e.key==='Escape'){this.clearOverlay();}else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();this.step(e.key==='ArrowRight'?1:-1);}});
 }
 render(a:Activity,s:Simulation|null,pref:Preferences):void {
  this.pref=pref;this.sport=a.settings.sport;const imperial=pref.units==='imperial',path=plannedPath(a),c=cumulative(path);this.total=c.at(-1)||0;this.rows=[];this.host.replaceChildren();
  this.grades=[];for(let i=1;i<path.length;i++){if(Number.isFinite(path[i].ele)&&Number.isFinite(path[i-1].ele)){const dd=c[i]-c[i-1];if(dd>0)this.grades.push({d:(c[i]+c[i-1])/2,g:(path[i].ele!-path[i-1].ele!)/dd});}}
  if(this.mode==='elevation')this.rows=path.map((p,i)=>({p,d:c[i],v:p.ele===undefined?NaN:p.ele*(imperial?3.28084:1)}));
  else if(this.mode==='hr'&&!a.settings.hrEnabled)this.rows=path.map((p,i)=>({p,d:c[i],v:p.hr??NaN}));
  else if(this.mode==='power'&&!a.settings.power?.enabled)this.rows=[];
  else if(this.mode==='cadence'&&!a.settings.cadence?.enabled)this.rows=[];
  else if(this.mode==='power')this.rows=s?s.points.map(p=>({p,d:p.distance,v:p.power??NaN})):[];
  else if(this.mode==='cadence')this.rows=s?s.points.map(p=>({p,d:p.distance,v:p.cad??NaN})):[];
  else if(this.mode==='splits')this.rows=(s?perUnitSplits(s,imperial?1609.344:1000):[]).map(sp=>({p:atDistance(path,c,(sp.start+sp.end)/2),d:(sp.start+sp.end)/2,v:usesPace(a.settings.sport)?(sp.duration>0?sp.duration/(sp.distance/1000):0):sp.speed*(imperial?2.2369362920544:3.6)}));
  else if(s)this.rows=s.points.map(p=>({p,d:p.distance,v:this.mode==='hr'?p.hr??NaN:usesPace(a.settings.sport)?(imperial?1609.344:1000)/p.speed:p.speed*3.6/(imperial?1.609344:1)}));
  const valid=this.rows.filter(r=>Number.isFinite(r.v));
  if(valid.length<2){const empty=document.createElement('div');empty.className='chart-empty';empty.setAttribute('role','status');empty.textContent=!path.length?t('Your route profile will appear here.'):this.mode==='elevation'?t('Elevation unavailable. Route and GPX export still work.'):this.mode==='hr'?t('Enable simulated heart rate in Activity settings.'):this.mode==='power'?t('Enable estimated power in Activity settings.'):this.mode==='cadence'?t('Enable estimated cadence in Activity settings.'):t('A completed route is needed for this profile.');this.host.append(empty);return;}
  const chartName=chartNames[this.mode](),unit=this.unit(),values=valid.map(row=>row.v),summary=document.createElement('p');summary.className='sr-only';summary.id='chart-summary';summary.textContent=t('The {chart} chart covers {distance} {distanceUnit}, with values from {minimum} to {maximum} {unit}.',{chart:chartName,distance:formatNumber(this.total/(imperial?1609.344:1000),{maximumFractionDigits:1}),distanceUnit:imperial?t('mi'):t('km'),minimum:formatNumber(Math.min(...values)),maximum:formatNumber(Math.max(...values)),unit});this.host.append(summary);const svg=document.createElementNS(NS,'svg');this.width=Math.max(250,this.host.clientWidth);svg.setAttribute('viewBox',`0 0 ${this.width} 125`);svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('role','img');svg.setAttribute('aria-label',t('{chart} profile along route',{chart:chartName}));svg.setAttribute('aria-describedby','chart-summary');this.host.append(svg);
  const make=(tag:string,attrs:Record<string,string>,text='')=>{const n=document.createElementNS(NS,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));n.textContent=text;svg.append(n);return n;};
  let lo=Math.min(...valid.map(r=>r.v)),hi=Math.max(...valid.map(r=>r.v));const paceLike=this.mode==='pace'||this.mode==='splits';const pad=Math.max((hi-lo)*.2,this.mode==='elevation'?2:paceLike?usesPace(this.sport)?5:1:2);lo-=pad;hi+=pad;
  const span=this.width-70;const px=(d:number)=>50+d/Math.max(1,this.total)*span,py=(v:number)=>98-(v-lo)/(hi-lo)*85;
  for(let i=0;i<3;i++){const y=15+i*41.5,v=hi-i*(hi-lo)/2;make('line',{x1:'50',x2:String(this.width-20),y1:String(y),y2:String(y),class:'grid'});make('text',{x:'40',y:String(y+3),'text-anchor':'end',class:'axis'},this.format(v));}
  const step=Math.max(1,Math.ceil(this.rows.length/1000)),sample=this.rows.filter((_,i)=>i%step===0||i===this.rows.length-1);let d='',started=false,lastTime:number|undefined;const gapMs=s?Math.max(1,s.interval*1000)*1.5:0;
  for(const r of sample){if(!Number.isFinite(r.v)){started=false;lastTime=undefined;continue;}if(started&&gapMs>0&&lastTime!==undefined&&r.p.time!==undefined&&r.p.time-lastTime>gapMs)started=false;d+=`${started?'L':'M'}${px(r.d).toFixed(2)} ${py(r.v).toFixed(2)} `;started=true;lastTime=r.p.time;}
  make('path',{d,class:'profile-line'});
  for(let i=0;i<5;i++)make('text',{x:String(50+i*span/4),y:'119','text-anchor':i===0?'start':i===4?'end':'middle',class:'axis'},`${formatNumber(this.total*i/4/(imperial?1609.344:1000),{maximumFractionDigits:1})} ${imperial?t('mi'):t('km')}`);
 }
 private format(v:number):string{const paceLike=this.mode==='pace'||this.mode==='splits';return paceLike&&usesPace(this.sport)?formatClock(v):formatNumber(v,{maximumFractionDigits:paceLike?1:0});}
 private unit():string{const imperial=this.pref.units==='imperial';return t(this.mode==='elevation'?imperial?'ft':'m':this.mode==='hr'?'bpm':this.mode==='power'?'W':this.mode==='cadence'?'rpm':usesPace(this.sport)?imperial?'/mi':'/km':imperial?'mph':'km/h');}
 private cursor(e:PointerEvent):void {
  if(this.rows.length<2||!this.host.querySelector('svg'))return;const r=this.host.getBoundingClientRect(),f=Math.max(0,Math.min(1,((e.clientX-r.left)/r.width*this.width-50)/(this.width-70)));
  this.paint(f,Math.max(5,Math.min(r.width-170,e.clientX-r.left)));
 }
 private paint(f:number,leftPx:number):void {
  const d=f*this.total;let best=this.rows[0];for(const row of this.rows)if(Math.abs(row.d-d)<Math.abs(best.d-d))best=row;
  this.host.querySelector('.chart-tooltip')?.remove();this.host.querySelector('.cursor')?.remove();this.scrubDistance=best.d;
  if(!Number.isFinite(best.v))return;
  const imperial=this.pref.units==='imperial',grade=this.gradeAt(best.d);
  const unit=this.unit(),distance=formatNumber(best.d/(imperial?1609.344:1000),{minimumFractionDigits:2,maximumFractionDigits:2}),value=this.format(best.v),gradeText=grade===null?'':t(', grade {grade} percent',{grade:formatNumber(grade*100,{maximumFractionDigits:1,signDisplay:'exceptZero'})});
  const tip=document.createElement('div');tip.className='chart-tooltip';tip.textContent=t('{distance} {distanceUnit}: {value} {unit}{grade}',{distance,distanceUnit:imperial?t('mi'):t('km'),value,unit,grade:gradeText});tip.style.left=`${leftPx}px`;this.host.append(tip);
  const line=document.createElementNS(NS,'line');Object.entries({x1:String(50+f*(this.width-70)),x2:String(50+f*(this.width-70)),y1:'5',y2:'101',class:'cursor'}).forEach(([k,v])=>line.setAttribute(k,v));this.host.querySelector('svg')!.append(line);this.hover(best.p);this.scrub?.(best.p);
 }
 private gradeAt(d:number):number|null {let best:number|null=null,dist=Infinity;for(const g of this.grades){const v=Math.abs(g.d-d);if(v<dist){dist=v;best=g.g;}}return best;}
 private step(dir:number):void {
  if(this.rows.length<2)return;const span=Math.max(this.total/50,10),d=Math.max(0,Math.min(this.total,(this.scrubDistance??0)+dir*span)),r=this.host.getBoundingClientRect();
  this.paint(d/Math.max(1e-6,this.total),Math.max(5,Math.min(r.width-170,50+(d/Math.max(1e-6,this.total))*(this.width-70))));
 }
 private clearOverlay():void {
  this.scrubDistance=null;this.host.querySelector('.chart-tooltip')?.remove();this.host.querySelector('.cursor')?.remove();this.hover(null);this.scrub?.(null);
 }
}

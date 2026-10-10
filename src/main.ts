import type {Activity,Point,Preferences,RouteProfile,Settings,Simulation,WeatherPreset} from './types.js';
import {defaults,simulate,clock,parseClock,validateSettings,loopPlan,plannedPath,mapStyleFor,computeSplits,WEATHER_PRESETS,importedActivity} from './model.js';
import {atDistance,cumulative,elevationStats,isClosedLoop,resample} from './geometry.js';
import {download,downloadActivity,safeFilename} from './gpx.js';
import {exportTCX} from './tcx.js';
import {decodeShare,shareUrl,shareWarning} from './share.js';
import {importRouteFile} from './import.js';
import {downloadCues} from './cues.js';
import {clearCachedMap,offlineSupported,offlineStatus,registerOfflineCache} from './sw.js';
import {readPreferences,writePreferences,validatePreferences,LocalStore,parseBackup,sanitizeTags,searchActivities,sortActivities,storageUsage} from './storage.js';
import {ValhallaProvider,resolveProfile,searchPlaces} from './providers.js';
import {Editor} from './editor.js';
import {RouteMap} from './map.js';
import {Charts,type ChartMode} from './charts.js';
import {hrZones,paceHistogram,compareActivities} from './analysis.js';
import {corridorTiles} from './offline.js';
import {downloadCorridor} from './sw.js';
import {exportFIT} from './fit.js';
import {qrSvg} from './qr.js';
import {$,el,button,installIcons,setText,setInput,toast} from './ui.js';
import {newId} from './id.js';
let preferences=readPreferences();document.documentElement.dataset.theme=preferences.theme;installIcons();
const store=new LocalStore(),editor=new Editor(new ValhallaProvider(()=>preferences));
let initialized=false,saveTimer:ReturnType<typeof setTimeout>|undefined,sim:Simulation|null=null,lastPath:Point[]|null=null,lastSettings='',simulationError='';
let searchController:AbortController|null=null,searchId=0;
let emptyDismissed=false;
const map=new RouteMap($('map'),{add:p=>{if(editor.activity.source==='imported'){toast('Imported geometry is preserved. Use Waypoints → Convert to edit its road route.');return;}editor.add(p);},move:(i,p)=>editor.move(i,p),insert:(i,p)=>editor.insert(i,p),select:i=>{editor.selected=i;render();$('waypoint-details').setAttribute('open','');},message:toast,loopStart:f=>editor.setLoop({start:f}),freehand:points=>editor.drawFreehand(points)});
const charts=new Charts($('chart'),p=>map.hover(p),p=>map.scrub(p));
editor.alternatesEnabled=preferences.alternates;
function guarded(fn:()=>void|Promise<void>):()=>void{return ()=>{try{Promise.resolve(fn()).catch(e=>toast(e instanceof Error?e.message:'The action could not be completed.'));}catch(e){toast(e instanceof Error?e.message:'The action could not be completed.');}};}
function on(id:string,fn:()=>void|Promise<void>):void{$(id).addEventListener('click',guarded(fn));}
function distanceValue(m:number):string{return (m/(preferences.units==='imperial'?1609.344:1000)).toFixed(2);}
function distanceUnit():string{return preferences.units==='imperial'?'mi':'km';}
function lapLabel(n:number):string{return `${Number(n.toFixed(2))} lap${Math.abs(n-1)<1e-9?'':'s'}`;}
function heightValue(v:number|null):string{return v===null?'—':String(Math.round(v*(preferences.units==='imperial'?3.28084:1)));}
function stat(id:string,value:string,unit=''):void{const e=$(id);e.replaceChildren(document.createTextNode(value));if(unit)e.append(document.createTextNode(' '),el('small','',unit));}
function mark(id:string,on:boolean):void{$(id).classList.toggle('active',on);$(id).setAttribute('aria-pressed',String(on));}
function validRoute():void{if(editor.activity.path.length<2)throw Error('Draw or import a route first.');if(editor.activity.source==='draft')throw Error(editor.pending?'Routing is still in progress.':'Resolve the route before saving or exporting. A dashed line is only a waypoint preview.');if(!sim)throw Error(simulationError||'Check activity settings before exporting.');}
function updateSettings(p:Partial<Settings>):void {if(p.sport&&/^(Morning|Afternoon|Evening) (run|ride)$/.test(editor.activity.name))editor.activity.name=editor.activity.name.replace(/run|ride$/,p.sport);const s={...editor.activity.settings,...p};validateSettings(s);editor.changeSettings(p);}
let freehandEnabled=false;
editor.onSplitOutputsChange=(outputs,previous,committed)=>{
 if(committed)return;
 const next=new Map(outputs.map(a=>[a.id,a]));
 for(const activity of previous)if(!next.has(activity.id))void store.remove(activity.id).then(refreshStorageUsage).catch(e=>toast(e instanceof Error?e.message:'Split activity could not be removed from local history.'));
 const prior=new Set(previous.map(a=>a.id));
 for(const activity of outputs)if(!prior.has(activity.id))void store.save(activity).then(refreshStorageUsage).catch(e=>toast(e instanceof Error?e.message:'Split activity could not be saved to local history.'));
};
function render():void {
 const a=editor.activity,s=a.settings,key=JSON.stringify([s,a.loop,a.pauses,a.workout]);
 if(lastPath!==a.path||lastSettings!==key){lastPath=a.path;lastSettings=key;sim=null;simulationError='';if(a.path.length>1)try{sim=simulate(a);}catch(e){simulationError=e instanceof Error?e.message:'Invalid simulation.';}}
 const plan=loopPlan(a),route=plan?plan.path:a.path;
 map.update(a,editor.selected,editor.drawing,plan?{start:route[0],end:route[route.length-1]}:undefined);charts.render(a,sim,preferences);
 $('empty').hidden=emptyDismissed||a.path.length>0||a.waypoints.length>0;
 const meters=sim?.distance||cumulative(route).at(-1)||0,imperial=preferences.units==='imperial',unit=distanceUnit(),heights=elevationStats(route),pace=s.pace*(imperial?1.609344:1),speed=s.speed/(imperial?1.609344:1);
 stat('distance',distanceValue(meters),unit);stat('duration-stat',sim?clock(sim.duration):'0:00');stat('pace-stat',s.sport==='run'?clock(pace):speed.toFixed(1),s.sport==='run'?`/${unit}`:imperial?'mph':'km/h');stat('elevation-stat',heightValue(heights.gain),imperial?'ft':'m');
 setText('moving-stat',sim?clock(Math.max(0,sim.duration-(a.pauses?.rests??[]).reduce((n,r)=>n+r.seconds,0))):'0:00');
 setText('pace-stat-label',s.sport==='run'?'Avg. pace':'Avg. speed');setText('target-label',s.sport==='run'?`Target pace /${unit}`:`Target speed ${imperial?'mph':'km/h'}`);
 setInput('activity-name',a.name);setInput('start',s.start);setInput('offset',s.utcOffset);setInput('target',s.sport==='run'?clock(pace):speed.toFixed(2));setInput('duration',sim?clock(sim.duration):'0:00');setInput('sample',s.sample);$<HTMLSelectElement>('profile').value=resolveProfile(s.sport,s.profile);setInput('variation',s.variation*100);setInput('hr-average',s.hrAverage);setInput('hr-variation',s.hrVariation);setInput('gps-noise',s.gps?.noise??0);setInput('gps-dropout',Math.round((s.gps?.dropout??0)*100));
 $<HTMLInputElement>('hr-enabled').checked=s.hrEnabled;$('hr-fields').hidden=!s.hrEnabled;$('variation-wrap').hidden=s.mode!=='natural';setText('variation-value',`${Math.round(s.variation*100)}%`);
 $<HTMLSelectElement>('weather').value=s.weather?.preset??'';$('weather-fields').hidden=!s.weather;$('weather-wind-wrap').hidden=!s.weather;setInput('weather-temp',s.weather?.tempC??15);setInput('weather-humidity',s.weather?.humidity??50);setInput('weather-wind',s.weather?.headwindKph??0);$<HTMLInputElement>('power-enabled').checked=!!s.power?.enabled;$('power-fields').hidden=!s.power?.enabled;setInput('power-weight',s.power?.weightKg??70);$<HTMLInputElement>('cadence-enabled').checked=!!s.cadence?.enabled;setInput('fatigue',s.fatigue?.percent??0);setText('fatigue-value',`${Math.round(s.fatigue?.percent??0)}%`);
 mark('run',s.sport==='run');mark('ride',s.sport==='ride');mark('constant',s.mode==='constant');mark('natural',s.mode==='natural');mark('draw',editor.drawing&&!freehandEnabled);mark('pan',!editor.drawing&&!freehandEnabled);mark('freehand',freehandEnabled);
 $<HTMLButtonElement>('undo').disabled=!editor.canUndo;$<HTMLButtonElement>('redo').disabled=!editor.canRedo;
 setText('source-label',a.source==='imported'?'Imported geometry':a.source==='draft'&&a.path.length?'Last route · changes pending':'Route planning');
 setText('sample-count',sim?`${sim.points.length.toLocaleString()} points${sim.interval!==s.sample?' · capped':''}`:'0 points');
 setText('route-status',simulationError||editor.status);$('status-dot').classList.toggle('pending',editor.pending);$('retry').hidden=editor.pending||a.source!=='draft'||a.waypoints.length<2;
 setText('chart-note',sim?`${distanceValue(meters)} ${unit} · ${clock(sim.duration)}`:'No route yet');setText('chart-pace',s.sport==='run'?'Pace':'Speed');
 setText('elevation-detail',heights.min===null?'Elevation unavailable; no climbing is invented.':`Low ${heightValue(heights.min)} ${imperial?'ft':'m'} · High ${heightValue(heights.max)} ${imperial?'ft':'m'} · Descent ${heightValue(heights.loss)} ${imperial?'ft':'m'}`);
 const splits=sim?computeSplits(a,sim):[],hasSplits=!!a.splits&&(a.splits.auto>0||a.splits.markers.length>0);
 setText('splits-count',sim?String(splits.length):'—');
 setText('splits-summary',!sim?'A completed route is needed for splits.':hasSplits?`${splits.length} segment${splits.length===1?'':'s'} across ${distanceValue(sim.distance)} ${unit}.`:'Set an auto-split distance or add custom markers to see per-segment pace.');
 setText('splits-auto-unit',unit);setText('splits-markers-unit',unit);
 setInput('splits-auto',a.splits&&a.splits.auto>0?distanceValue(a.splits.auto):'');
 setInput('splits-markers',(a.splits?.markers??[]).map(m=>distanceValue(m)).join(', '));
 const rests=a.pauses?.rests??[];setText('pauses-count',rests.length?String(rests.length):'—');setText('pauses-unit',unit);setInput('pauses-rests',rests.map(r=>`${distanceValue(r.distance)}:${r.seconds}`).join(', '));$('pauses-clear').hidden=!rests.length;
 const wsteps=a.workout?.steps??[];setText('workout-count',wsteps.length?String(wsteps.length):'—');
 const alts=$('alternates');alts.replaceChildren();
 if(editor.alternatePaths.length>1){alts.hidden=false;editor.alternatePaths.forEach((_,i)=>alts.append(button(i===0?'Route A':`Route ${String.fromCharCode(65+i)}`,()=>{void editor.selectAlternate(i);},undefined,'text-button')));}
 else alts.hidden=true;setText('workout-unit',unit);setInput('workout-steps',wsteps.map(st=>`${distanceValue(st.distance)}:${s.sport==='run'?(st.pace!==undefined?clock(st.pace):''):(st.speed!==undefined?st.speed:'')}`).join(', '));$('workout-clear').hidden=!wsteps.length;
 setInput('tags',(a.tags??[]).join(', '));
 $('splits-clear').hidden=!hasSplits;
 const splitTable=$('splits-table');splitTable.replaceChildren();
 if(sim&&hasSplits){
  const head=el('div','split-row split-head');head.append(el('span','','#'),el('span','','Split'),el('span','','Time'),el('span','',s.sport==='run'?'Pace':'Speed'),el('span','','Gain'));splitTable.append(head);
  splits.forEach((sp,i)=>{const row=el('div','split-row');const value=s.sport==='run'?(sp.duration>0?sp.duration/(sp.distance/(imperial?1609.344:1000)):0):sp.speed*(imperial?2.2369362920544:3.6);row.append(el('span','',String(i+1)),el('span','',`${distanceValue(sp.distance)} ${unit}`),el('span','',sp.stopped?`${clock(sp.duration)} · rest`:clock(sp.duration)),el('span','',s.sport==='run'?clock(value):value.toFixed(1)),el('span','',sp.gain===null?'—':heightValue(sp.gain)));splitTable.append(row);});
 }
 setText('waypoint-count',String(a.waypoints.length));$('edit-import').hidden=a.source!=='imported';const list=$('waypoints');list.replaceChildren();
 const zoneBox=$('hr-zones');zoneBox.replaceChildren();
 if(sim&&s.hrEnabled){for(const z of hrZones(sim.points,preferences.hrMax)){const row=el('div','zone-row');row.append(el('span','',`Z${z.index} · ${z.min}\u2013${z.max} bpm`),el('span','',`${clock(z.seconds)} \u00b7 ${z.percent.toFixed(0)}%`));zoneBox.append(row);}}
 else zoneBox.append(el('p','fine-print','Enable simulated heart rate to see time in each zone.'));
 const hist=sim?paceHistogram(sim.points,s.sport,preferences.units)[0]:null,histBox=$('pace-hist');histBox.replaceChildren();
 if(hist&&hist.bins.length){for(const b of hist.bins){if(b.seconds<=0)continue;const row=el('div','hist-row');row.append(el('span','',s.sport==='run'?`${clock(b.min)}\u2013${clock(b.max)} /${unit}`:`${b.min}\u2013${b.max} ${hist.unit}`),el('span','',clock(b.seconds)));histBox.append(row);}}
 else histBox.append(el('p','fine-print','A completed route is needed for the pace histogram.'));
 setText('energy-note',sim?`Estimated energy ${sim.calories??0} kcal — a simulated estimate, not a measurement.`:'');
 a.waypoints.forEach((p,i)=>{const row=el('div',`waypoint-row ${i===editor.selected?'selected':''}`);row.append(el('span','point-index',String(i+1)),button(`${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`,()=>{editor.selected=i;map.focus(p);render();},undefined,'coordinate'),button('Move earlier',()=>editor.reorder(i,-1),'up','icon-button'),button('Move later',()=>editor.reorder(i,1),'down','icon-button'),button(`Delete waypoint ${i+1}`,()=>editor.remove(i),'close','icon-button'));list.append(row);});
 const closed=isClosedLoop(a.path),loopLen=closed?cumulative(a.path).at(-1)??0:0,loopMode=a.loop?.mode??'distance';
 setText('loop-count',plan?lapLabel(plan.laps):'—');
 setText('loop-summary',!closed?'Close the loop — the route must return to its start — to plan laps or a target distance.':plan?`Loop ${distanceValue(plan.loopLength)} ${unit} · ${lapLabel(plan.laps)} · ${distanceValue(plan.distance)} ${unit} to the finish${plan.capped?' · laps reduced to stay within export limits':''}`:`Loop ${distanceValue(loopLen)} ${unit} long. Set laps or a target distance to place the finish.`);
 mark('loop-mode-laps',loopMode==='laps');mark('loop-mode-distance',loopMode==='distance');
 const loopInput=$<HTMLInputElement>('loop-value');setText('loop-value-label',loopMode==='laps'?'Laps':`Target distance (${unit})`);loopInput.step=loopMode==='laps'?'0.25':'0.1';loopInput.min=loopMode==='laps'?'0.25':'0.01';
 setInput('loop-value',a.loop?(loopMode==='laps'?Number((plan?.laps??a.loop.value).toFixed(2)):distanceValue(plan?.distance??a.loop.value)):loopMode==='laps'?1:closed?distanceValue(loopLen):'');
 loopInput.disabled=!closed;$<HTMLButtonElement>('loop-mode-laps').disabled=!closed;$<HTMLButtonElement>('loop-mode-distance').disabled=!closed;$<HTMLButtonElement>('loop-clear').hidden=!a.loop;
 const startSelect=$<HTMLSelectElement>('loop-start');startSelect.replaceChildren();startSelect.disabled=!closed;
 if(closed){const seen:number[]=[];a.waypoints.forEach((p,i)=>{const f=editor.startFor(i);if(f===null||seen.some(v=>Math.abs(v-f)<1e-6))return;seen.push(f);const o=el('option');o.value=String(f);o.textContent=`Waypoint ${i+1} · ${distanceValue(f*loopLen)} ${unit} in`;startSelect.append(o);});
  const current=a.loop?.start??0;if(!seen.some(v=>Math.abs(v-current)<1e-6)){const o=el('option');o.value=String(current);o.textContent=`${Math.abs(current)<1e-9?"Route's first point":'Custom start'} · ${distanceValue(current*loopLen)} ${unit} in`;startSelect.append(o);}startSelect.value=String(current);}
 if(initialized){clearTimeout(saveTimer);const snapshot=structuredClone(a);saveTimer=setTimeout(()=>store.saveDraft(snapshot).catch(e=>{setText('storage-state','Save failed');$('storage-state').classList.add('warning');toast(`Draft not saved: ${e.message}`);}),350);}
}
editor.onChange=render;editor.onMessage=toast;
// Fixed UTC offsets are explicit, so serialized UTC never silently shifts with the machine's timezone.
for(let offset=-720;offset<=840;offset+=15){const option=el('option');option.value=String(offset);option.textContent=`UTC${offset<0?'−':'+'}${String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')}:${String(Math.abs(offset)%60).padStart(2,'0')}`;$('offset').append(option);}
for(const [value,preset] of Object.entries(WEATHER_PRESETS)){const option=el('option');option.value=value;option.textContent=preset.label;$('weather').append(option);}
on('run',()=>updateSettings({sport:'run'}));on('ride',()=>updateSettings({sport:'ride'}));
function disableFreehand():void {freehandEnabled=false;map.setFreehand(false);}
function openRangeDialog(action:'trim'|'split'):void {
 if(editor.activity.source==='draft'||editor.activity.path.length<2)throw Error('Resolve a route before trimming or splitting it.');
 const total=cumulative(editor.activity.path).at(-1)??0,scale=preferences.units==='imperial'?1609.344:1000;
 setText('range-unit',distanceUnit());$('range-end-field').hidden=action==='split';$('range-description').textContent=action==='trim'?'Choose the distance range to keep.':'Choose the distance from the route start where it should split. The second part is saved in your local activity library.';
 setText('range-start-label',action==='trim'?'Start distance':'Split at distance');setText('range-end-label','End distance');setText('range-apply',action==='trim'?'Trim route':'Split route');
 setInput('range-start',action==='trim'?'0':(total/scale/2).toFixed(3));setInput('range-end',(total/scale).toFixed(3));$('route-range-dialog').dataset.action=action;$<HTMLDialogElement>('route-range-dialog').showModal();
}
function applyRangeAction():void {
 const action=$('route-range-dialog').dataset.action,scale=preferences.units==='imperial'?1609.344:1000,start=Number($<HTMLInputElement>('range-start').value)*scale,end=Number($<HTMLInputElement>('range-end').value)*scale;
 if(!Number.isFinite(start)||!Number.isFinite(end))throw Error('Enter valid route distances.');
 if(action==='trim')editor.trim(start,end);
 else if(action==='split'){if(!initialized)throw Error('The local activity library is still opening. Try again in a moment.');const path=editor.activity.path,point=atDistance(path,cumulative(path),start);editor.split(point,newId());}
 else throw Error('Choose a route operation.');
 $<HTMLDialogElement>('route-range-dialog').close();map.fit();
}
async function openMergeDialog():Promise<void> {
 const activities=(await store.list()).filter(a=>a.id!==editor.activity.id&&a.source!=='draft'&&a.path.length>1),select=$<HTMLSelectElement>('merge-source');select.replaceChildren(new Option('Choose a saved activity',''));
 for(const a of activities){const meters=cumulative(a.path).at(-1)??0;select.append(new Option(`${a.name} · ${distanceValue(meters)} ${distanceUnit()} · ${a.settings.start.replace('T',' ')}`,a.id));}
 if(!activities.length)throw Error('Save another activity with a route before merging.');$<HTMLDialogElement>('merge-dialog').showModal();
}
async function applyMerge():Promise<void> {
 const id=$<HTMLSelectElement>('merge-source').value;if(!id)throw Error('Choose a saved activity to merge.');
 const other=(await store.list()).find(a=>a.id===id);if(!other)throw Error('That saved activity is no longer available.');
 await editor.merge(other);$<HTMLDialogElement>('merge-dialog').close();map.fit();toast('Routes merged.');
}
on('draw',()=>{disableFreehand();editor.drawing=true;render();});on('pan',()=>{disableFreehand();editor.drawing=false;render();});
on('freehand',()=>{freehandEnabled=!freehandEnabled;map.setFreehand(freehandEnabled);editor.drawing=false;render();});on('trim',()=>openRangeDialog('trim'));on('split',()=>openRangeDialog('split'));on('range-apply',applyRangeAction);on('merge',openMergeDialog);on('merge-apply',applyMerge);
for(const [id,fn] of Object.entries({undo:()=>editor.undo(),redo:()=>editor.redo(),reverse:()=>editor.reverse(),'out-back':()=>editor.outAndBack(),loop:()=>editor.closeLoop(),clear:()=>editor.clear(),fit:()=>map.fit(),retry:()=>editor.recalculate(),'zoom-in':()=>map.zoom(1),'zoom-out':()=>map.zoom(-1)}))on(id,fn);
on('new',async()=>{const previous=editor.activity;if(previous.path.length>1||previous.waypoints.length){await store.save(previous);}editor.load(defaults());toast(store.available?'New activity. The previous project remains in local history.':'New activity. History lasts for this session only.');});
on('constant',()=>updateSettings({mode:'constant'}));on('natural',()=>updateSettings({mode:'natural'}));
on('loop-mode-laps',()=>editor.setLoopMode('laps'));on('loop-mode-distance',()=>editor.setLoopMode('distance'));on('loop-clear',()=>editor.setLoop(null));on('splits-clear',()=>editor.setSplits(null));
const change=(id:string,fn:(input:HTMLInputElement)=>void)=>$(id).addEventListener('change',guarded(()=>{try{fn($<HTMLInputElement>(id));}catch(e){($<HTMLInputElement>(id)).blur();render();throw e;}}));
change('activity-name',e=>{editor.activity.name=e.value.trim()||'Untitled activity';editor.activity.updatedAt=Date.now();render();});
change('start',e=>updateSettings({start:e.value}));change('offset',e=>updateSettings({utcOffset:Number(e.value)}));
change('target',e=>{const imperial=preferences.units==='imperial';updateSettings(editor.activity.settings.sport==='run'?{pace:parseClock(e.value)/(imperial?1.609344:1)}:{speed:Number(e.value)*(imperial?1.609344:1)});});
change('duration',e=>{if(!sim)throw Error('Create a route before setting its duration.');const seconds=parseClock(e.value);if(seconds<=0)throw Error('Duration must be greater than zero.');updateSettings(editor.activity.settings.sport==='run'?{pace:seconds/(sim.distance/1000)}:{speed:sim.distance/1000/seconds*3600});});
change('sample',e=>updateSettings({sample:Number(e.value) as 1|2|5}));change('profile',e=>updateSettings({profile:e.value as RouteProfile}));change('variation',e=>updateSettings({variation:Number(e.value)/100}));change('hr-enabled',e=>updateSettings({hrEnabled:e.checked}));change('hr-average',e=>updateSettings({hrAverage:Number(e.value)}));change('hr-variation',e=>updateSettings({hrVariation:Number(e.value)}));
change('loop-value',e=>{const raw=Number(e.value);if(!Number.isFinite(raw)||raw<=0)throw Error('Enter a value above zero.');const mode=editor.activity.loop?.mode??'distance';editor.setLoop(mode==='laps'?{mode,value:raw}:{mode,value:raw*(preferences.units==='imperial'?1609.344:1000)});});
change('loop-start',e=>editor.setLoop({start:Number(e.value)}));
change('gps-noise',e=>updateSettings({gps:{noise:Number(e.value),dropout:editor.activity.settings.gps?.dropout??0}}));
change('gps-dropout',e=>updateSettings({gps:{noise:editor.activity.settings.gps?.noise??0,dropout:Number(e.value)/100}}));
change('weather',e=>{if(!e.value){updateSettings({weather:undefined});return;}const preset=e.value as WeatherPreset,w=WEATHER_PRESETS[preset];updateSettings({weather:{preset,tempC:w.tempC,humidity:w.humidity,headwindKph:w.headwindKph}});});
change('weather-temp',e=>{const w=editor.activity.settings.weather;if(w)updateSettings({weather:{...w,tempC:Number(e.value)}});});
change('weather-humidity',e=>{const w=editor.activity.settings.weather;if(w)updateSettings({weather:{...w,humidity:Number(e.value)}});});
change('weather-wind',e=>{const w=editor.activity.settings.weather;if(w)updateSettings({weather:{...w,headwindKph:Number(e.value)}});});
change('power-enabled',e=>updateSettings({power:{enabled:e.checked,weightKg:editor.activity.settings.power?.weightKg??70}}));
change('power-weight',e=>updateSettings({power:{enabled:editor.activity.settings.power?.enabled??false,weightKg:Number(e.value)}}));
change('cadence-enabled',e=>updateSettings({cadence:{enabled:e.checked}}));
change('fatigue',e=>updateSettings({fatigue:{percent:Number(e.value)}}));
change('pauses-rests',e=>{const raw=e.value.trim();if(!raw){editor.setPauses(null);return;}const factor=preferences.units==='imperial'?1609.344:1000;const rests=raw.split(',').map(v=>v.trim()).filter(Boolean).map(v=>{const parts=v.split(':');const dm=Number(parts[0]),sec=Number(parts[1]);if(!Number.isFinite(dm)||dm<=0||!Number.isFinite(sec)||sec<=0)throw Error(`Invalid rest stop: ${v}. Use distance:seconds.`);return {distance:dm*factor,seconds:sec};});editor.setPauses({rests});});
on('pauses-clear',()=>editor.setPauses(null));
change('workout-steps',e=>{const raw=e.value.trim();if(!raw){editor.setWorkout(null);return;}const factor=preferences.units==='imperial'?1609.344:1000,run=editor.activity.settings.sport==='run';const steps=raw.split(',').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf(':');const d=Number(v.slice(0,i)),rest=v.slice(i+1);if(!(d>0))throw Error(`Invalid workout step: ${v}. Use distance:target.`);const step:{kind:'work';distance:number;pace?:number;speed?:number}={kind:'work',distance:d*factor};if(run){const pace=parseClock(rest);if(!(pace>0))throw Error(`Invalid pace: ${rest}.`);step.pace=pace;}else{const speed=Number(rest);if(!(speed>0))throw Error(`Invalid speed: ${rest}.`);step.speed=speed;}return step;});editor.setWorkout({steps});});
on('workout-clear',()=>editor.setWorkout(null));
change('tags',e=>editor.setTags(sanitizeTags(e.value.split(','))));
on('export-tcx',()=>{validRoute();if(!sim)throw Error('Create a route before exporting.');download(exportTCX(editor.activity,sim),`${editor.activity.settings.start.slice(0,10)}-${safeFilename(editor.activity.name)}.tcx`,'application/vnd.garmin.tcx+xml');toast('TCX downloaded. Exports are simulated, not recorded.');});
on('export-fit',()=>{validRoute();if(!sim)throw Error('Create a route before exporting.');downloadBytes(exportFIT(editor.activity,sim),`${editor.activity.settings.start.slice(0,10)}-${safeFilename(editor.activity.name)}.fit`,'application/vnd.ant.fit');toast('FIT downloaded. Exports are simulated, not recorded.');});
function downloadBytes(bytes:Uint8Array,filename:string,type:string):void{const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type}));const a=el('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
on('share',()=>{if(editor.activity.path.length<2)throw Error('Draw or import a route before sharing.');const url=shareUrl(location.origin+location.pathname,editor.activity);$<HTMLInputElement>('share-url').value=url;const warning=shareWarning(url);setText('share-warning',warning??'');$('share-warning').hidden=!warning;const qr=$('share-qr');qr.replaceChildren();if(url.length<=2000)qr.innerHTML=qrSvg(url,{size:4,margin:2});else qr.append(el('p','fine-print','This link is too long for a QR code; export GPX instead.'));$<HTMLDialogElement>('share-dialog').showModal();});
on('share-copy',guarded(async()=>{const value=$<HTMLInputElement>('share-url').value;if(!value)throw Error('Open Share again to build a link.');try{await navigator.clipboard.writeText(value);toast('Share link copied.');}catch{$<HTMLInputElement>('share-url').select();document.execCommand('copy');toast('Share link copied.');}}));
on('share-print',()=>{if(editor.activity.path.length<2)throw Error('Draw or import a route before printing.');buildPrintSheet();window.print();});
function buildPrintSheet():void{
 const a=editor.activity,sheet=$('print-sheet');sheet.replaceChildren();
 sheet.append(el('h1','',a.name),el('p','',`${a.settings.sport==='run'?'Run':'Ride'} · ${distanceValue(sim?.distance??0)} ${distanceUnit()} · ${sim?clock(sim.duration):'—'} · simulated activity, not a recorded workout.`));
 const path=plannedPath(a);
 if(path.length>1){
  const NS='http://www.w3.org/2000/svg',svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 400 200');
  let minLat=Infinity,maxLat=-Infinity,minLon=Infinity,maxLon=-Infinity;for(const p of path){if(p.lat<minLat)minLat=p.lat;if(p.lat>maxLat)maxLat=p.lat;if(p.lon<minLon)minLon=p.lon;if(p.lon>maxLon)maxLon=p.lon;}
  const scale=Math.min(380/Math.max(1e-9,maxLon-minLon),180/Math.max(1e-9,maxLat-minLat));
  const ox=(400-(maxLon-minLon)*scale)/2,oy=(200-(maxLat-minLat)*scale)/2;
  const poly=document.createElementNS(NS,'polyline');poly.setAttribute('points',path.map(p=>`${(ox+(p.lon-minLon)*scale).toFixed(1)},${(200-oy-(p.lat-minLat)*scale).toFixed(1)}`).join(' '));poly.setAttribute('fill','none');poly.setAttribute('stroke','#e2571e');poly.setAttribute('stroke-width','2');svg.append(poly);sheet.append(svg);
 }
 const url=$<HTMLInputElement>('share-url').value;sheet.append(el('p','',url?`Share link: ${url}`:'Route sketch only; the basemap is not printed.'));
}
change('splits-auto',e=>{if(e.value.trim()===''){editor.setSplits({auto:0});return;}const raw=Number(e.value);if(!Number.isFinite(raw)||raw<0)throw Error('Enter an auto-split distance of zero or more.');editor.setSplits({auto:raw*(preferences.units==='imperial'?1609.344:1000)});});
change('splits-markers',e=>{const markers=e.value.split(',').map(v=>v.trim()).filter(Boolean).map(v=>{const n=Number(v);if(!Number.isFinite(n)||n<=0)throw Error(`Invalid split marker: ${v}`);return n*(preferences.units==='imperial'?1609.344:1000);});editor.setSplits({markers});});
on('save',async()=>{validRoute();await store.save(editor.activity);toast(store.available?'Saved to your local route library.':'Kept for this session only. Export a backup before closing.');});
on('cues',()=>{validRoute();if(!sim)throw Error('Create a route before exporting a cue sheet.');downloadCues(editor.activity,sim,preferences.units);toast('Cue sheet downloaded. Turns come from the route geometry, not street names.');});
on('export',async()=>{validRoute();downloadActivity(editor.activity);try{await store.save(editor.activity);toast(store.available?'GPX downloaded. Activity saved locally.':'GPX downloaded. History is session-only in this browser.');}catch{toast('GPX downloaded, but local history could not be saved.');}});
on('edit-import',()=>{if(!confirm('Replace the imported geometry with a freshly routed path through up to 8 waypoints? Undo restores the original geometry.'))return;editor.edit(resample(editor.activity.path,Math.min(8,editor.activity.path.length)));editor.drawing=true;render();});
const upload=()=>{$<HTMLInputElement>('gpx-file').value='';$('gpx-file').click();};on('import',upload);on('empty-import',upload);on('empty-close',()=>{emptyDismissed=true;render();});
document.addEventListener('dragover',e=>{e.preventDefault();});
document.addEventListener('drop',e=>{e.preventDefault();if(document.querySelector('dialog[open]'))return;const file=(e as DragEvent).dataTransfer?.files?.[0];if(!file)return;void (async()=>{try{if(file.size>15000000)throw Error('Dropped file must be smaller than 15 MB.');if(/\.json$/i.test(file.name)){const b=parseBackup(await file.text());if(!confirm(`Restore ${b.activities.length} activities from this backup?`))return;await store.restore(b.activities);preferences=b.preferences;try{writePreferences(preferences);}catch{}document.documentElement.dataset.theme=preferences.theme;map.setStyle(mapStyleFor(preferences));render();await showHistory();toast('Backup restored.');return;}const result=importRouteFile(await file.text(),file.name);if(editor.activity.path.length||editor.activity.waypoints.length)await store.save(editor.activity);editor.load(result.activity);map.fit();toast(result.notice);}catch(err){toast(err instanceof Error?err.message:'The dropped file could not be imported.');}})();});
$('gpx-file').addEventListener('change',guarded(async()=>{const file=$<HTMLInputElement>('gpx-file').files?.[0];if(!file)return;if(file.size>15000000)throw Error('Route file must be smaller than 15 MB.');const result=importRouteFile(await file.text(),file.name);if(editor.activity.path.length||editor.activity.waypoints.length)await store.save(editor.activity);editor.load(result.activity);map.fit();toast(result.notice);}));
for(const mode of ['elevation','pace','hr','power','cadence','splits'] as ChartMode[])on(`chart-${mode}`,()=>{charts.mode=mode;for(const m of ['elevation','pace','hr','power','cadence','splits']){$(`chart-${m}`).classList.toggle('active',m===mode);$(`chart-${m}`).setAttribute('aria-selected',String(m===mode));}charts.render(editor.activity,sim,preferences);});
on('toggle-chart',()=>{const collapsed=$('chart-panel').classList.toggle('collapsed');$('toggle-chart').setAttribute('aria-expanded',String(!collapsed));$('toggle-chart').setAttribute('aria-label',collapsed?'Expand chart':'Collapse chart');});
on('open-inspector',()=>{$('inspector').classList.add('open');$('activity-name').focus();});on('close-inspector',()=>$('inspector').classList.remove('open'));
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog')!.close());
for(const id of ['history-dialog','settings-dialog'])$(id).addEventListener('click',e=>{if(e.target===$(id)){const r=$(id).getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)($<HTMLDialogElement>(id)).close();}});
async function showHistory():Promise<void>{
 const list=$('history-list');list.replaceChildren();const query=$<HTMLInputElement>('history-search').value.trim(),sortKey=$<HTMLSelectElement>('history-sort').value as 'updated'|'name'|'distance'|'duration';const rows=sortActivities(searchActivities(await store.list(),query),sortKey);if(!rows.length)list.append(el('p','history-empty',query?'No saved routes match that search.':'No saved routes yet. Draw or import a route, then save it here.'));
 for(const a of rows){const row=el('article','history-row'),open=button('Open activity',guarded(async()=>{if(editor.activity.path.length||editor.activity.waypoints.length)await store.save(editor.activity);editor.load(a);$('inspector').querySelector('.inspector-scroll')!.scrollTop=0;map.fit();$<HTMLDialogElement>('history-dialog').close();}),undefined,'history-main');const planned=plannedPath(a),c=cumulative(planned),m=c.at(-1)||0;let duration='—';try{duration=clock(simulate(a).duration);}catch{}const h=elevationStats(planned);open.replaceChildren(el('strong','',a.name),el('span','',`${a.source==='draft'?'Draft · ':''}${a.settings.sport==='run'?'Run':'Ride'} · ${a.settings.start.replace('T',' ')} · ${distanceValue(m)} ${distanceUnit()} · ${duration} · ↑ ${heightValue(h.gain)} ${preferences.units==='imperial'?'ft':'m'}`));
  const actions=el('div','history-actions');actions.append(button('Duplicate activity',guarded(async()=>{const copy=structuredClone(a);copy.id=newId();copy.name=`${a.name.slice(0,150)} copy`;copy.createdAt=copy.updatedAt=Date.now();await store.save(copy);await showHistory();}),'duplicate','icon-button'),button('Export saved GPX',guarded(()=>downloadActivity(a)),'download','icon-button'),button('Compare activities',()=>{void openCompare();},'duplicate','icon-button'),button('Delete activity',guarded(async()=>{if(confirm(`Delete “${a.name}” from this browser?`)){await store.remove(a.id);await showHistory();}}),'trash','icon-button'));row.append(open,actions);list.append(row);
 }
 if(!$<HTMLDialogElement>('history-dialog').open)$<HTMLDialogElement>('history-dialog').showModal();
}
on('history',showHistory);
async function openCompare():Promise<void>{
 const rows=await store.list();if(rows.length<2){toast('Save at least two activities to compare.');return;}
 const left=$<HTMLSelectElement>('compare-left'),right=$<HTMLSelectElement>('compare-right');
 const fill=(select:HTMLSelectElement,selected:string)=>{select.replaceChildren();for(const a of rows){const o=el('option');o.value=a.id;o.textContent=a.name;select.append(o);}select.value=selected;};
 fill(left,rows[1].id);fill(right,rows[0].id);
 const draw=()=>{const l=rows.find(a=>a.id===left.value),r=rows.find(a=>a.id===right.value),box=$('compare-table');box.replaceChildren();if(!l||!r)return;let cmp;try{cmp=compareActivities({activity:l,sim:simulate(l)},{activity:r,sim:simulate(r)});}catch(e){box.append(el('p','fine-print',`One activity could not be simulated: ${e instanceof Error?e.message:'unknown error'}`));return;}
  const u=distanceUnit(),hUnit=preferences.units==='imperial'?'ft':'m';
  const data:[string,string,string,string][]=[['',cmp.left.name.slice(0,18),cmp.right.name.slice(0,18),'Δ'],[`Distance (${u})`,distanceValue(cmp.left.distance),distanceValue(cmp.right.distance),distanceValue(cmp.delta.distance)],['Duration',clock(cmp.left.duration),clock(cmp.right.duration),clock(cmp.delta.duration)],[`Avg ${cmp.left.sport==='run'?'pace':'speed'}`,cmp.left.avgPace!==null?clock(cmp.left.avgPace):cmp.left.avgSpeed.toFixed(1),cmp.right.avgPace!==null?clock(cmp.right.avgPace):cmp.right.avgSpeed.toFixed(1),'—'],[`Elevation (${hUnit})`,cmp.left.elevationGain===null?'—':heightValue(cmp.left.elevationGain),cmp.right.elevationGain===null?'—':heightValue(cmp.right.elevationGain),cmp.delta.elevationGain===null?'—':heightValue(cmp.delta.elevationGain)],['Energy (kcal)',cmp.left.calories===null?'—':String(cmp.left.calories),cmp.right.calories===null?'—':String(cmp.right.calories),cmp.delta.calories===null?'—':String(cmp.delta.calories)]];
  for(const [a,b,c,d] of data){const row=el('div','compare-row');row.append(el('span','',a),el('span','',b),el('span','',c),el('span','',d));box.append(row);}};
 left.onchange=draw;right.onchange=draw;draw();$<HTMLDialogElement>('compare-dialog').showModal();
}
$('history-search').addEventListener('input',guarded(()=>{void showHistory();}));
$('history-sort').addEventListener('change',guarded(()=>{void showHistory();}));
on('backup',async()=>{const activities=await store.list();const draft=editor.activity;if(!activities.some(a=>a.id===draft.id)&&(draft.path.length||draft.waypoints.length))activities.push(draft);else {const i=activities.findIndex(a=>a.id===draft.id);if(i>=0)activities[i]=draft;}download(JSON.stringify({product:'SimRun',version:1,createdAt:new Date().toISOString(),activities,preferences},null,2),'simrun-backup.json','application/json');});
on('restore',()=>{$<HTMLInputElement>('backup-file').value='';$('backup-file').click();});
$('backup-file').addEventListener('change',guarded(async()=>{const file=$<HTMLInputElement>('backup-file').files?.[0];if(!file)return;if(file.size>50000000)throw Error('Backup must be smaller than 50 MB.');const b=parseBackup(await file.text());if(!confirm(`Restore ${b.activities.length} activities and preferences? Matching activity IDs will be replaced.`))return;await store.restore(b.activities);preferences=b.preferences;try{writePreferences(preferences);}catch{toast('Preferences could not be persisted.');}document.documentElement.dataset.theme=preferences.theme;map.setStyle(mapStyleFor(preferences));render();await showHistory();toast('Backup restored. Open a route from the library.');}));
on('settings',()=>{setInput('units',preferences.units);setInput('theme',preferences.theme);$<HTMLInputElement>('geocoding-enabled').checked=preferences.geocodingEnabled;for(const [id,key] of Object.entries({'map-style':'mapStyle','map-style-dark':'mapStyleDark','routing-url':'routingUrl','elevation-url':'elevationUrl','geocoding-url':'geocodingUrl'}))setInput(id,String(preferences[key as keyof Preferences]));setInput('hr-max',preferences.hrMax);setInput('corridor-zoom',preferences.corridorZoom);$<HTMLInputElement>('offline-routing').checked=preferences.offlineRouting;$<HTMLInputElement>('avoid-highways').checked=preferences.avoidHighways;$<HTMLInputElement>('avoid-hills').checked=preferences.avoidHills;$<HTMLInputElement>('alternates-enabled').checked=preferences.alternates;void refreshOfflineStatus();void refreshStorageUsage();$<HTMLDialogElement>('settings-dialog').showModal();});
async function refreshStorageUsage():Promise<void>{try{const count=(await store.list()).length,usage=await storageUsage();setText('storage-usage',usage?`${count} saved ${count===1?'activity':'activities'} · about ${(usage.usage/1048576).toFixed(1)} MB of ${(usage.quota/1048576).toFixed(0)} MB used.`:`${count} saved ${count===1?'activity':'activities'}. Storage usage is unavailable in this browser.`);}catch{setText('storage-usage','Storage usage is unavailable in this browser.');}}
async function refreshOfflineStatus():Promise<void>{
 if(!offlineSupported()){setText('offline-status','Offline caching is unavailable in this browser.');return;}
 const status=await offlineStatus();
 setText('offline-status',status?(status.map?`${status.map} of up to ${status.limit} basemap resources cached on this device.`:'No basemap resources cached yet; open the map to fill the cache.'):'Offline cache is not active in this page yet; reload once to enable it.');
}
on('offline-clear',async()=>{if(await clearCachedMap()){toast('Cached basemap data cleared. It will be downloaded again as you view the map.');await refreshOfflineStatus();}else toast('The offline cache is not active in this page yet. Reload once and try again.');});
let installPrompt:any=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('install-app').hidden=false;});
on('install-app',guarded(async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('install-app').hidden=true;toast('Install prompt dismissed.');}else toast('Use your browser menu: “Install app” or “Add to Home screen”.');}));
on('corridor-download',guarded(async()=>{const path=plannedPath(editor.activity);if(path.length<2)throw Error('Draw or import a route before downloading map data.');const templates=await tileTemplates();if(!templates.length)throw Error('The map style exposes no tile templates to download.');const plan=corridorTiles(path,2000,preferences.corridorZoom,400),urls:string[]=[];for(const tile of plan.tiles)for(const template of templates)urls.push(template.replace('{z}',String(tile.z)).replace('{x}',String(tile.x)).replace('{y}',String(tile.y)).replace('{s}',['a','b','c'][(tile.x+tile.y)%3]));setText('corridor-status',`Downloading ${urls.length} map ${urls.length===1?'tile':'tiles'}…`);const result=await downloadCorridor(urls);setText('corridor-status',result?`${result.stored} of ${urls.length} map tiles stored for offline use${plan.capped?' · corridor capped':''}.`:'Offline caching is not active in this page yet; reload once and try again.');toast(result&&result.stored>0?'Corridor map data downloaded.':'No map tiles could be downloaded; check your connection.');}));
async function tileTemplates():Promise<string[]>{
 try{const style=await fetch(mapStyleFor(preferences)).then(r=>r.json()),out:string[]=[];for(const source of Object.values(style.sources??{}) as any[]){if(Array.isArray(source?.tiles))for(const t of source.tiles)if(typeof t==='string')out.push(t);}return out;}catch{return [];}
}
$('preferences-form').addEventListener('submit',e=>{e.preventDefault();guarded(()=>{const before=mapStyleFor(preferences);const next=validatePreferences({units:$<HTMLSelectElement>('units').value,theme:$<HTMLSelectElement>('theme').value,geocodingEnabled:$<HTMLInputElement>('geocoding-enabled').checked,mapStyle:$<HTMLInputElement>('map-style').value,mapStyleDark:$<HTMLInputElement>('map-style-dark').value,routingUrl:$<HTMLInputElement>('routing-url').value,elevationUrl:$<HTMLInputElement>('elevation-url').value,geocodingUrl:$<HTMLInputElement>('geocoding-url').value,hrMax:Number($<HTMLInputElement>('hr-max').value),offlineRouting:$<HTMLInputElement>('offline-routing').checked,corridorZoom:Number($<HTMLInputElement>('corridor-zoom').value),avoidHighways:$<HTMLInputElement>('avoid-highways').checked,avoidHills:$<HTMLInputElement>('avoid-hills').checked,alternates:$<HTMLInputElement>('alternates-enabled').checked});preferences=next;editor.alternatesEnabled=next.alternates;try{writePreferences(next);}catch{toast('Preferences apply to this session only; local storage is unavailable.');}document.documentElement.dataset.theme=next.theme;if(mapStyleFor(next)!==before)map.setStyle(mapStyleFor(next));$<HTMLDialogElement>('settings-dialog').close();render();})();});
$('search-form').addEventListener('submit',e=>{e.preventDefault();guarded(async()=>{const query=$<HTMLInputElement>('search').value.trim();if(!query)return;searchController?.abort();const controller=new AbortController();searchController=controller;const id=++searchId;const submit=$<HTMLButtonElement>('search-submit');submit.disabled=true;const list=$('search-results');list.hidden=true;try{const places=await searchPlaces(query,preferences,controller.signal);if(id!==searchId)return;list.replaceChildren();if(!places.length){toast('No places found. Try coordinates or another search.');return;}places.forEach(place=>list.append(button(place.name,()=>{map.focus(place);list.hidden=true;},undefined,'')));list.hidden=false;}catch(error){if(!controller.signal.aborted)throw error;}finally{if(id===searchId)submit.disabled=false;}})();});
document.addEventListener('pointerdown',e=>{if(!(e.target as Element).closest('.search-wrap'))$('search-results').hidden=true;});
document.addEventListener('keydown',e=>{const target=e.target as Element;if(target.closest('input,textarea,select,[contenteditable=true]')||document.querySelector('dialog[open]'))return;if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?editor.redo():editor.undo();}else if(e.key==='Escape'){disableFreehand();editor.drawing=false;$('inspector').classList.remove('open');$('search-results').hidden=true;render();}else if((e.key==='Backspace'||e.key==='Delete')&&editor.selected>=0){e.preventDefault();editor.remove(editor.selected);}else if(e.key.toLowerCase()==='f'){e.preventDefault();map.fit();}});
let resizeFrame=0;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{render();map.fit();});});
window.addEventListener('pagehide',()=>{if(initialized)void store.saveDraft(editor.activity).catch(()=>{});});
render();void map.init(mapStyleFor(preferences));registerOfflineCache();
async function initialize():Promise<void>{try{await store.open();setText('storage-state','Saved on this device');const shared=decodeShare(location.hash);if(shared){const {activity,notices}=importedActivity(shared.points,'Shared route',shared.sport==='ride'?'Ride':'Run','Shared link');editor.load(activity);map.fit();toast(`${notices} Timing was re-simulated locally.`);}else{const a=await store.readDraft();if(a){editor.load(a);map.fit();}}}catch(e){setText('storage-state','Session only');$('storage-state').classList.add('warning');toast('Browser storage is unavailable here. History is session-only; export GPX or a backup before closing.');}finally{initialized=true;render();}}
void initialize();

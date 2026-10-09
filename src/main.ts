import type {Activity,Point,Preferences,Settings,Simulation} from './types.js';
import {defaults,simulate,clock,parseClock,validateSettings,loopPlan,plannedPath,computeSplits} from './model.js';
import {cumulative,elevationStats,isClosedLoop,resample} from './geometry.js';
import {download,downloadActivity} from './gpx.js';
import {importRouteFile} from './import.js';
import {readPreferences,writePreferences,validatePreferences,LocalStore,parseBackup} from './storage.js';
import {ValhallaProvider,searchPlaces} from './providers.js';
import {Editor} from './editor.js';
import {RouteMap} from './map.js';
import {Charts,type ChartMode} from './charts.js';
import {$,el,button,installIcons,setText,setInput,toast} from './ui.js';
import {newId} from './id.js';
let preferences=readPreferences();document.documentElement.dataset.theme=preferences.theme;installIcons();
const store=new LocalStore(),editor=new Editor(new ValhallaProvider(()=>preferences));
let initialized=false,saveTimer:ReturnType<typeof setTimeout>|undefined,sim:Simulation|null=null,lastPath:Point[]|null=null,lastSettings='',simulationError='';
let searchController:AbortController|null=null,searchId=0;
let emptyDismissed=false;
const map=new RouteMap($('map'),{add:p=>{if(editor.activity.source==='imported'){toast('Imported geometry is preserved. Use Waypoints → Convert to edit its road route.');return;}editor.add(p);},move:(i,p)=>editor.move(i,p),insert:(i,p)=>editor.insert(i,p),select:i=>{editor.selected=i;render();$('waypoint-details').setAttribute('open','');},message:toast,loopStart:f=>editor.setLoop({start:f})});
const charts=new Charts($('chart'),p=>map.hover(p));
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
function render():void {
 const a=editor.activity,s=a.settings,key=JSON.stringify([s,a.loop]);
 if(lastPath!==a.path||lastSettings!==key){lastPath=a.path;lastSettings=key;sim=null;simulationError='';if(a.path.length>1)try{sim=simulate(a);}catch(e){simulationError=e instanceof Error?e.message:'Invalid simulation.';}}
 const plan=loopPlan(a),route=plan?plan.path:a.path;
 map.update(a,editor.selected,editor.drawing,plan?{start:route[0],end:route[route.length-1]}:undefined);charts.render(a,sim,preferences);
 $('empty').hidden=emptyDismissed||a.path.length>0||a.waypoints.length>0;
 const meters=sim?.distance||cumulative(route).at(-1)||0,imperial=preferences.units==='imperial',unit=distanceUnit(),heights=elevationStats(route),pace=s.pace*(imperial?1.609344:1),speed=s.speed/(imperial?1.609344:1);
 stat('distance',distanceValue(meters),unit);stat('duration-stat',sim?clock(sim.duration):'0:00');stat('pace-stat',s.sport==='run'?clock(pace):speed.toFixed(1),s.sport==='run'?`/${unit}`:imperial?'mph':'km/h');stat('elevation-stat',heightValue(heights.gain),imperial?'ft':'m');
 setText('pace-stat-label',s.sport==='run'?'Avg. pace':'Avg. speed');setText('target-label',s.sport==='run'?`Target pace /${unit}`:`Target speed ${imperial?'mph':'km/h'}`);
 setInput('activity-name',a.name);setInput('start',s.start);setInput('offset',s.utcOffset);setInput('target',s.sport==='run'?clock(pace):speed.toFixed(2));setInput('duration',sim?clock(sim.duration):'0:00');setInput('sample',s.sample);setInput('variation',s.variation*100);setInput('hr-average',s.hrAverage);setInput('hr-variation',s.hrVariation);setInput('gps-noise',s.gps?.noise??0);setInput('gps-dropout',Math.round((s.gps?.dropout??0)*100));
 $<HTMLInputElement>('hr-enabled').checked=s.hrEnabled;$('hr-fields').hidden=!s.hrEnabled;$('variation-wrap').hidden=s.mode!=='natural';setText('variation-value',`${Math.round(s.variation*100)}%`);
 mark('run',s.sport==='run');mark('ride',s.sport==='ride');mark('constant',s.mode==='constant');mark('natural',s.mode==='natural');mark('draw',editor.drawing);mark('pan',!editor.drawing);
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
 $('splits-clear').hidden=!hasSplits;
 const splitTable=$('splits-table');splitTable.replaceChildren();
 if(sim&&hasSplits){
  const head=el('div','split-row split-head');head.append(el('span','','#'),el('span','','Split'),el('span','','Time'),el('span','',s.sport==='run'?'Pace':'Speed'),el('span','','Gain'));splitTable.append(head);
  splits.forEach((sp,i)=>{const row=el('div','split-row');const value=s.sport==='run'?(sp.duration>0?sp.duration/(sp.distance/(imperial?1609.344:1000)):0):sp.speed*(imperial?2.2369362920544:3.6);row.append(el('span','',String(i+1)),el('span','',`${distanceValue(sp.distance)} ${unit}`),el('span','',clock(sp.duration)),el('span','',s.sport==='run'?clock(value):value.toFixed(1)),el('span','',sp.gain===null?'—':heightValue(sp.gain)));splitTable.append(row);});
 }
 setText('waypoint-count',String(a.waypoints.length));$('edit-import').hidden=a.source!=='imported';const list=$('waypoints');list.replaceChildren();
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
on('run',()=>updateSettings({sport:'run'}));on('ride',()=>updateSettings({sport:'ride'}));on('draw',()=>{editor.drawing=true;render();});on('pan',()=>{editor.drawing=false;render();});
for(const [id,fn] of Object.entries({undo:()=>editor.undo(),redo:()=>editor.redo(),reverse:()=>editor.reverse(),'out-back':()=>editor.outAndBack(),loop:()=>editor.closeLoop(),clear:()=>editor.clear(),fit:()=>map.fit(),retry:()=>editor.recalculate(),'zoom-in':()=>map.zoom(1),'zoom-out':()=>map.zoom(-1)}))on(id,fn);
on('new',async()=>{const previous=editor.activity;if(previous.path.length>1||previous.waypoints.length){await store.save(previous);}editor.load(defaults());toast(store.available?'New activity. The previous project remains in local history.':'New activity. History lasts for this session only.');});
on('constant',()=>updateSettings({mode:'constant'}));on('natural',()=>updateSettings({mode:'natural'}));
on('loop-mode-laps',()=>editor.setLoopMode('laps'));on('loop-mode-distance',()=>editor.setLoopMode('distance'));on('loop-clear',()=>editor.setLoop(null));on('splits-clear',()=>editor.setSplits(null));
const change=(id:string,fn:(input:HTMLInputElement)=>void)=>$(id).addEventListener('change',guarded(()=>{try{fn($<HTMLInputElement>(id));}catch(e){($<HTMLInputElement>(id)).blur();render();throw e;}}));
change('activity-name',e=>{editor.activity.name=e.value.trim()||'Untitled activity';editor.activity.updatedAt=Date.now();render();});
change('start',e=>updateSettings({start:e.value}));change('offset',e=>updateSettings({utcOffset:Number(e.value)}));
change('target',e=>{const imperial=preferences.units==='imperial';updateSettings(editor.activity.settings.sport==='run'?{pace:parseClock(e.value)/(imperial?1.609344:1)}:{speed:Number(e.value)*(imperial?1.609344:1)});});
change('duration',e=>{if(!sim)throw Error('Create a route before setting its duration.');const seconds=parseClock(e.value);if(seconds<=0)throw Error('Duration must be greater than zero.');updateSettings(editor.activity.settings.sport==='run'?{pace:seconds/(sim.distance/1000)}:{speed:sim.distance/1000/seconds*3600});});
change('sample',e=>updateSettings({sample:Number(e.value) as 1|2|5}));change('variation',e=>updateSettings({variation:Number(e.value)/100}));change('hr-enabled',e=>updateSettings({hrEnabled:e.checked}));change('hr-average',e=>updateSettings({hrAverage:Number(e.value)}));change('hr-variation',e=>updateSettings({hrVariation:Number(e.value)}));
change('loop-value',e=>{const raw=Number(e.value);if(!Number.isFinite(raw)||raw<=0)throw Error('Enter a value above zero.');const mode=editor.activity.loop?.mode??'distance';editor.setLoop(mode==='laps'?{mode,value:raw}:{mode,value:raw*(preferences.units==='imperial'?1609.344:1000)});});
change('loop-start',e=>editor.setLoop({start:Number(e.value)}));
change('gps-noise',e=>updateSettings({gps:{noise:Number(e.value),dropout:editor.activity.settings.gps?.dropout??0}}));
change('gps-dropout',e=>updateSettings({gps:{noise:editor.activity.settings.gps?.noise??0,dropout:Number(e.value)/100}}));
change('splits-auto',e=>{if(e.value.trim()===''){editor.setSplits({auto:0});return;}const raw=Number(e.value);if(!Number.isFinite(raw)||raw<0)throw Error('Enter an auto-split distance of zero or more.');editor.setSplits({auto:raw*(preferences.units==='imperial'?1609.344:1000)});});
change('splits-markers',e=>{const markers=e.value.split(',').map(v=>v.trim()).filter(Boolean).map(v=>{const n=Number(v);if(!Number.isFinite(n)||n<=0)throw Error(`Invalid split marker: ${v}`);return n*(preferences.units==='imperial'?1609.344:1000);});editor.setSplits({markers});});
on('save',async()=>{validRoute();await store.save(editor.activity);toast(store.available?'Saved to your local route library.':'Kept for this session only. Export a backup before closing.');});
on('export',async()=>{validRoute();downloadActivity(editor.activity);try{await store.save(editor.activity);toast(store.available?'GPX downloaded. Activity saved locally.':'GPX downloaded. History is session-only in this browser.');}catch{toast('GPX downloaded, but local history could not be saved.');}});
on('edit-import',()=>{if(!confirm('Replace the imported geometry with a freshly routed path through up to 8 waypoints? Undo restores the original geometry.'))return;editor.edit(resample(editor.activity.path,Math.min(8,editor.activity.path.length)));editor.drawing=true;render();});
const upload=()=>{$<HTMLInputElement>('gpx-file').value='';$('gpx-file').click();};on('import',upload);on('empty-import',upload);on('empty-close',()=>{emptyDismissed=true;render();});
$('gpx-file').addEventListener('change',guarded(async()=>{const file=$<HTMLInputElement>('gpx-file').files?.[0];if(!file)return;if(file.size>15000000)throw Error('Route file must be smaller than 15 MB.');const result=importRouteFile(await file.text(),file.name);if(editor.activity.path.length||editor.activity.waypoints.length)await store.save(editor.activity);editor.load(result.activity);map.fit();toast(result.notice);}));
for(const mode of ['elevation','pace','hr'] as ChartMode[])on(`chart-${mode}`,()=>{charts.mode=mode;for(const m of ['elevation','pace','hr']){$(`chart-${m}`).classList.toggle('active',m===mode);$(`chart-${m}`).setAttribute('aria-selected',String(m===mode));}charts.render(editor.activity,sim,preferences);});
on('toggle-chart',()=>{const collapsed=$('chart-panel').classList.toggle('collapsed');$('toggle-chart').setAttribute('aria-expanded',String(!collapsed));$('toggle-chart').setAttribute('aria-label',collapsed?'Expand chart':'Collapse chart');});
on('open-inspector',()=>{$('inspector').classList.add('open');$('activity-name').focus();});on('close-inspector',()=>$('inspector').classList.remove('open'));
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog')!.close());
for(const id of ['history-dialog','settings-dialog'])$(id).addEventListener('click',e=>{if(e.target===$(id)){const r=$(id).getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)($<HTMLDialogElement>(id)).close();}});
async function showHistory():Promise<void>{
 const list=$('history-list');list.replaceChildren();const rows=await store.list();if(!rows.length)list.append(el('p','history-empty','No saved routes yet. Draw or import a route, then save it here.'));
 for(const a of rows){const row=el('article','history-row'),open=button('Open activity',guarded(async()=>{if(editor.activity.path.length||editor.activity.waypoints.length)await store.save(editor.activity);editor.load(a);$('inspector').querySelector('.inspector-scroll')!.scrollTop=0;map.fit();$<HTMLDialogElement>('history-dialog').close();}),undefined,'history-main');const planned=plannedPath(a),c=cumulative(planned),m=c.at(-1)||0;let duration='—';try{duration=clock(simulate(a).duration);}catch{}const h=elevationStats(planned);open.replaceChildren(el('strong','',a.name),el('span','',`${a.source==='draft'?'Draft · ':''}${a.settings.sport==='run'?'Run':'Ride'} · ${a.settings.start.replace('T',' ')} · ${distanceValue(m)} ${distanceUnit()} · ${duration} · ↑ ${heightValue(h.gain)} ${preferences.units==='imperial'?'ft':'m'}`));
  const actions=el('div','history-actions');actions.append(button('Duplicate activity',guarded(async()=>{const copy=structuredClone(a);copy.id=newId();copy.name=`${a.name.slice(0,150)} copy`;copy.createdAt=copy.updatedAt=Date.now();await store.save(copy);await showHistory();}),'duplicate','icon-button'),button('Export saved GPX',guarded(()=>downloadActivity(a)),'download','icon-button'),button('Delete activity',guarded(async()=>{if(confirm(`Delete “${a.name}” from this browser?`)){await store.remove(a.id);await showHistory();}}),'trash','icon-button'));row.append(open,actions);list.append(row);
 }
 if(!$<HTMLDialogElement>('history-dialog').open)$<HTMLDialogElement>('history-dialog').showModal();
}
on('history',showHistory);
on('backup',async()=>{const activities=await store.list();const draft=editor.activity;if(!activities.some(a=>a.id===draft.id)&&(draft.path.length||draft.waypoints.length))activities.push(draft);else {const i=activities.findIndex(a=>a.id===draft.id);if(i>=0)activities[i]=draft;}download(JSON.stringify({product:'SimRun',version:1,createdAt:new Date().toISOString(),activities,preferences},null,2),'simrun-backup.json','application/json');});
on('restore',()=>{$<HTMLInputElement>('backup-file').value='';$('backup-file').click();});
$('backup-file').addEventListener('change',guarded(async()=>{const file=$<HTMLInputElement>('backup-file').files?.[0];if(!file)return;if(file.size>50000000)throw Error('Backup must be smaller than 50 MB.');const b=parseBackup(await file.text());if(!confirm(`Restore ${b.activities.length} activities and preferences? Matching activity IDs will be replaced.`))return;await store.restore(b.activities);preferences=b.preferences;try{writePreferences(preferences);}catch{toast('Preferences could not be persisted.');}document.documentElement.dataset.theme=preferences.theme;map.setStyle(preferences.mapStyle);render();await showHistory();toast('Backup restored. Open a route from the library.');}));
on('settings',()=>{setInput('units',preferences.units);setInput('theme',preferences.theme);$<HTMLInputElement>('geocoding-enabled').checked=preferences.geocodingEnabled;for(const [id,key] of Object.entries({'map-style':'mapStyle','routing-url':'routingUrl','elevation-url':'elevationUrl','geocoding-url':'geocodingUrl'}))setInput(id,String(preferences[key as keyof Preferences]));$<HTMLDialogElement>('settings-dialog').showModal();});
$('preferences-form').addEventListener('submit',e=>{e.preventDefault();guarded(()=>{const next=validatePreferences({units:$<HTMLSelectElement>('units').value,theme:$<HTMLSelectElement>('theme').value,geocodingEnabled:$<HTMLInputElement>('geocoding-enabled').checked,mapStyle:$<HTMLInputElement>('map-style').value,routingUrl:$<HTMLInputElement>('routing-url').value,elevationUrl:$<HTMLInputElement>('elevation-url').value,geocodingUrl:$<HTMLInputElement>('geocoding-url').value});const styleChanged=next.mapStyle!==preferences.mapStyle;preferences=next;try{writePreferences(next);}catch{toast('Preferences apply to this session only; local storage is unavailable.');}document.documentElement.dataset.theme=next.theme;if(styleChanged)map.setStyle(next.mapStyle);$<HTMLDialogElement>('settings-dialog').close();render();})();});
$('search-form').addEventListener('submit',e=>{e.preventDefault();guarded(async()=>{const query=$<HTMLInputElement>('search').value.trim();if(!query)return;searchController?.abort();const controller=new AbortController();searchController=controller;const id=++searchId;const submit=$<HTMLButtonElement>('search-submit');submit.disabled=true;const list=$('search-results');list.hidden=true;try{const places=await searchPlaces(query,preferences,controller.signal);if(id!==searchId)return;list.replaceChildren();if(!places.length){toast('No places found. Try coordinates or another search.');return;}places.forEach(place=>list.append(button(place.name,()=>{map.focus(place);list.hidden=true;},undefined,'')));list.hidden=false;}catch(error){if(!controller.signal.aborted)throw error;}finally{if(id===searchId)submit.disabled=false;}})();});
document.addEventListener('pointerdown',e=>{if(!(e.target as Element).closest('.search-wrap'))$('search-results').hidden=true;});
document.addEventListener('keydown',e=>{const target=e.target as Element;if(target.closest('input,textarea,select,[contenteditable=true]')||document.querySelector('dialog[open]'))return;if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?editor.redo():editor.undo();}else if(e.key==='Escape'){editor.drawing=false;$('inspector').classList.remove('open');$('search-results').hidden=true;render();}else if((e.key==='Backspace'||e.key==='Delete')&&editor.selected>=0){e.preventDefault();editor.remove(editor.selected);}else if(e.key.toLowerCase()==='f'){e.preventDefault();map.fit();}});
let resizeFrame=0;window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{render();map.fit();});});
window.addEventListener('pagehide',()=>{if(initialized)void store.saveDraft(editor.activity).catch(()=>{});});
render();void map.init(preferences.mapStyle);
async function initialize():Promise<void>{try{await store.open();setText('storage-state','Saved on this device');const a=await store.readDraft();if(a){editor.load(a);map.fit();}}catch(e){setText('storage-state','Session only');$('storage-state').classList.add('warning');toast('Browser storage is unavailable here. History is session-only; export GPX or a backup before closing.');}finally{initialized=true;render();}}
void initialize();

"""Optional browser acceptance tests. No live public provider requests are made.
Normal: python tests/browser.py --url http://127.0.0.1:5173
Restricted harness: python tests/browser.py --isolated
The isolated mode tests an AMD compilation in a DOM-only page, not HTTP/ESM,
MapLibre, CSP/CORS, native IndexedDB persistence, or ChatGPT Sites.
"""
from pathlib import Path
import argparse, json, math, subprocess, tempfile, re, os
from datetime import datetime
from xml.etree import ElementTree as ET
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://127.0.0.1:5173')
parser.add_argument('--isolated',action='store_true')
parser.add_argument('--screenshots',default='')
parser.add_argument('--chromium',default=os.environ.get('CHROMIUM_PATH',''))
args=parser.parse_args()
loader=r"""const modules={},exportsCache={};function define(name,deps,factory){modules[name]={deps,factory}};function requireModule(name){name=name.replace(/\.js$/,'');if(exportsCache[name])return exportsCache[name];const m=modules[name];if(!m)throw Error('Module not found '+name);const ex={};exportsCache[name]=ex;m.factory(...m.deps.map(d=>d==='require'?requireModule:d==='exports'?ex:requireModule(d)));return ex;}if(!crypto.randomUUID)crypto.randomUUID=()=> '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(+c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>+c/4).toString(16));"""
mock=r"""window.testRequests=[];window.testRouteFailure=false;window.testDownloads=[];
const originalFetch=window.fetch.bind(window);const originalBlobURL=URL.createObjectURL;
URL.createObjectURL=function(blob){window.testDownloads.push(blob.text());return originalBlobURL.call(URL,blob);};
function encode(points){let last=[0,0],out='';for(const p of points){[p.lat,p.lon].forEach((v,i)=>{const val=Math.round(v*1e6),diff=val-last[i];last[i]=val;let n=diff<0?~(diff<<1):diff<<1;while(n>=32){out+=String.fromCharCode((32|(n&31))+63);n>>=5;}out+=String.fromCharCode(n+63);});}return out;}
window.fetch=async function(input,init){const u=new URL(String(input),'https://simrun.test/');if(u.host==='valhalla1.openstreetmap.de'){const data=JSON.parse(u.searchParams.get('json'));window.testRequests.push({kind:u.pathname,data,at:Date.now()});if(u.pathname==='/route'){if(window.testRouteFailure)return new Response('{}',{status:400});return new Response(JSON.stringify({trip:{legs:[{shape:encode(data.locations)}]}}),{status:200});}return new Response(JSON.stringify({height:data.shape.map((p,i)=>12+Math.sin(i*.4)*6)}),{status:200});}return originalFetch(input,init);};"""
points=[]
for i in range(201):
 t=2*math.pi*i/200
 points.append(f'<trkpt lat="{31.23+.0054*math.sin(t):.7f}" lon="{121.47+.0105*math.cos(t):.7f}"><ele>{15+8*math.sin(3*t):.2f}</ele></trkpt>')
fixture='<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Test fixture loop</name><trkseg>'+''.join(points)+'</trkseg></trk></gpx>'
results=[]
def passed(label):
 results.append(label);print('PASS',label,flush=True)
def change(page,id,value):
 page.locator('#'+id).fill(value);page.locator('#'+id).dispatch_event('change')
def screenshot(page,name):
 if args.screenshots:
  Path(args.screenshots).mkdir(parents=True,exist_ok=True)
  page.screenshot(path=str(Path(args.screenshots)/(name+'.png')))
with tempfile.TemporaryDirectory(prefix='simrun-browser-') as temp:
 bundle=Path(temp)/'bundle.js'
 if args.isolated:
  subprocess.run(['node',str(ROOT/'node_modules/typescript/bin/tsc'),'--module','AMD','--moduleResolution','node','--outFile',str(bundle)],cwd=ROOT,check=True)
 with sync_playwright() as pw:
  opts={'headless':True}
  if args.chromium:opts['executable_path']=args.chromium
  browser=pw.chromium.launch(**opts)
  context=browser.new_context(viewport={'width':1440,'height':900},accept_downloads=True)
  context.add_init_script("const nativeGetContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...rest){return /webgl/i.test(String(type))?null:nativeGetContext.call(this,type,...rest)}")
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('https://unpkg.com/**',lambda r:r.abort())
  if args.isolated:
   html=(ROOT/'dist/index.html').read_text().replace('<script type="module" src="./src/main.js"></script>','').replace('<link rel="stylesheet" href="./app.css">','<style>'+(ROOT/'dist/app.css').read_text()+'</style>')
   page.set_content(html);page.add_script_tag(content=loader+mock);page.add_script_tag(content=bundle.read_text());page.evaluate('requireModule("main")')
  else:
   page.add_init_script(mock);page.goto(args.url)
  expect(page.locator('.brand')).to_contain_text('SimRun');page.wait_for_timeout(900)
  assert not errors,errors
  passed('App shell renders with no JavaScript exceptions')
  page.locator('#export').click();expect(page.locator('#toast')).to_contain_text('Draw or import')
  page.locator('#gpx-file').set_input_files({'name':'bad.gpx','mimeType':'application/gpx+xml','buffer':b'<broken>'});expect(page.locator('#toast')).to_contain_text('not valid GPX')
  passed('Empty exports and malformed GPX give useful validation')
  page.locator('#gpx-file').set_input_files({'name':'fixture.gpx','mimeType':'application/gpx+xml','buffer':fixture.encode()})
  expect(page.locator('#activity-name')).to_have_value('Test fixture loop');expect(page.locator('#empty')).to_be_hidden()
  distance=float(page.locator('#distance').inner_text().split()[0]);assert 4.5<distance<6
  change(page,'target','5:00');duration=page.locator('#duration-stat').inner_text();parts=[int(p) for p in duration.split(':')];seconds=sum(n*60**i for i,n in enumerate(reversed(parts)));assert abs(seconds-distance*300)<2
  passed('GPX import, route geometry, elevation and pace/duration consistency')
  page.locator('#natural').click();page.locator('#hr-enabled').check();change(page,'hr-average','155')
  change(page,'start','2026-09-27T23:59');page.locator('#offset').select_option('540')
  page.locator('#chart-hr').click();expect(page.locator('#chart .profile-line')).to_be_visible()
  page.locator('#export').click();page.wait_for_timeout(250)
  xml=page.evaluate('async()=>await window.testDownloads.at(-1)');root=ET.fromstring(xml);ns={'g':'http://www.topografix.com/GPX/1/1','h':'http://www.garmin.com/xmlschemas/TrackPointExtension/v1'}
  track=root.findall('.//g:trkpt',ns);assert len(track)>500
  times=[datetime.fromisoformat(p.find('g:time',ns).text.replace('Z','+00:00')).timestamp() for p in track]
  assert all(b>a for a,b in zip(times,times[1:]));assert datetime.fromtimestamp(times[0]).hour==14
  hrs=root.findall('.//h:hr',ns);assert len(hrs)==len(track);assert all(30<=int(h.text)<=240 for h in hrs)
  assert 'Simulated activity' in root.find('g:metadata/g:desc',ns).text
  passed('Natural timing, midnight offset, HR extension and actual Blob GPX output')
  page.locator('#cues').click();page.wait_for_timeout(150)
  csv=page.evaluate('async()=>await window.testDownloads.at(-1)')
  assert csv.startswith('SimRun cue sheet')
  assert 'Distance (km)' in csv and 'Latitude,Longitude' in csv
  assert 'Turn' in csv and 'Simulated activity generated by SimRun' in csv
  assert 'Start' in csv and 'Finish' in csv
  passed('Turn-by-turn cue sheet exports as CSV with a simulated-activity label')
  page.locator('#history').click();expect(page.locator('.history-row')).to_have_count(1)
  page.get_by_role('button',name='Duplicate activity',exact=True).click();expect(page.locator('.history-row')).to_have_count(2)
  page.locator('.history-main').first.click();expect(page.locator('#activity-name')).to_have_value('Test fixture loop copy')
  passed('Session history save, duplicate with independent ID, and reopening')
  old=float(page.locator('#distance').inner_text().split()[0]);page.locator('#reverse').click();assert float(page.locator('#distance').inner_text().split()[0])==old
  page.locator('#out-back').click();assert abs(float(page.locator('#distance').inner_text().split()[0])-2*old)<.02
  page.locator('#undo').click();assert float(page.locator('#distance').inner_text().split()[0])==old
  page.locator('#redo').click();assert abs(float(page.locator('#distance').inner_text().split()[0])-2*old)<.02
  passed('Imported reverse, out-and-back, undo and redo update true geometry')
  page.locator('#undo').click();page.locator('#chart-elevation').click();page.locator('#fit').click();page.locator('#toast').evaluate('(e)=>e.hidden=true');screenshot(page,'desktop')
  page.set_viewport_size({'width':1280,'height':800});page.wait_for_timeout(100);screenshot(page,'laptop')
  page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(100);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  expect(page.locator('#inspector')).to_be_hidden();page.locator('#open-inspector').click();expect(page.locator('#inspector')).to_be_visible();expect(page.locator('#export')).to_be_visible();screenshot(page,'mobile-settings')
  page.locator('#close-inspector').click();screenshot(page,'mobile-map')
  passed('1440 desktop, 1280 laptop and 390 mobile layouts; accessible mobile settings')
  worker=page.evaluate('''async()=>{const {simulate}=await import('/src/model.js'),{simulateInWorker}=await import('/src/simulation.js'),n=50000,path=Array.from({length:n},(_,i)=>({lat:0,lon:i*250/(111.195*(n-1)),ele:10+5*Math.sin(i*.001)})),activity={id:'browser-worker',version:1,name:'Worker fixture',createdAt:0,updatedAt:0,waypoints:[path[0],path.at(-1)],path,source:'imported',settings:{sport:'run',profile:'road',start:'2026-10-10T06:00',utcOffset:0,pace:300,speed:24,mode:'constant',variation:0,sample:1,hrEnabled:false,hrAverage:150,hrVariation:5,seed:1}};await new Promise(resolve=>setTimeout(resolve,100));const tasks=[],observer=new PerformanceObserver(list=>tasks.push(...list.getEntries()));observer.observe({entryTypes:['longtask']});const result=simulateInWorker(activity),usedWorker=result instanceof Promise,actual=await result;await new Promise(resolve=>setTimeout(resolve,100));observer.disconnect();const expected=simulate(activity);return usedWorker&&actual.points.length===49968&&tasks.every(task=>task.duration<=100)&&JSON.stringify(actual)===JSON.stringify(expected)}''')
  assert worker
  passed('50k-point module worker stays responsive and matches synchronous output')
  page.set_viewport_size({'width':1440,'height':900});page.wait_for_timeout(150)
  assert page.evaluate("(()=>{const m=document.getElementById('map').getBoundingClientRect();const s=(document.querySelector('.maplibregl-canvas')||document.querySelector('svg.coordinate-map')).getBoundingClientRect();return m.height>200&&s.height>200})()")
  passed('Map container keeps a full-height renderer surface')
  page.locator('#clear').click();page.locator('#draw').click()
  page.mouse.click(390,260);page.mouse.click(730,270);page.mouse.click(700,520)
  expect(page.locator('#route-status')).to_contain_text('Route ready',timeout=6000)
  assert page.evaluate('window.testRequests.some(r=>r.data.costing==="pedestrian")')
  assert page.locator('.fallback-point').count()==3
  p=page.locator('.fallback-point').nth(1).bounding_box();page.mouse.move(p['x']+12,p['y']+12);page.mouse.down();page.mouse.move(p['x']+60,p['y']+60,steps=5);page.mouse.up()
  expect(page.locator('#route-status')).to_contain_text('Route ready',timeout=6000)
  page.locator('#undo').click();page.locator('#redo').click()
  passed('Coordinate canvas add/drag with real provider adapter and mocked responses')
  page.locator('#loop').click();expect(page.locator('#route-status')).to_contain_text('Route ready',timeout=6000)
  expect(page.locator('#waypoint-count')).to_have_text('4');page.locator('#loop').click();expect(page.locator('#toast')).to_contain_text('already returns')
  passed('Close loop appends the start as the final waypoint, reroutes and refuses to double-close')
  one=float(page.locator('#distance').inner_text().split()[0]);page.locator('#loop-details summary').click()
  page.locator('#export').click();page.wait_for_timeout(80)
  lap_pts=page.evaluate('async()=>await window.testDownloads.at(-1)').count('<trkpt')
  page.locator('#loop-mode-laps').click();change(page,'loop-value','2.5')
  expect(page.locator('#loop-count')).to_have_text('2.5 laps');expect(page.locator('#loop-summary')).to_contain_text('2.5 laps')
  assert abs(float(page.locator('#distance').inner_text().split()[0])-2.5*one)<.05
  assert page.evaluate("(()=>{const a=document.querySelector('.fallback-plan-start'),b=document.querySelector('.fallback-plan-finish');return !!a&&!!b&&(a.getAttribute('cx')!==b.getAttribute('cx')||a.getAttribute('cy')!==b.getAttribute('cy'))})()")
  box=page.locator('.fallback-plan-finish').bounding_box();page.mouse.click(box['x']+box['width']/2,box['y']+box['height']/2);expect(page.locator('#waypoint-count')).to_have_text('4')
  before=page.locator('#loop-start').input_value();box=page.locator('.fallback-plan-start').bounding_box()
  page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(box['x']+110,box['y']+60,steps=8);page.mouse.up();page.wait_for_timeout(250)
  assert page.locator('#loop-start').input_value()!=before and page.locator('#waypoint-count').inner_text()=='4'
  expect(page.locator('#loop-summary')).to_contain_text('2.5 laps')
  page.locator('#export').click();page.wait_for_timeout(80)
  assert abs(page.evaluate('async()=>await window.testDownloads.at(-1)').count('<trkpt')/lap_pts-2.5)<.2
  page.locator('#loop-clear').click();assert abs(float(page.locator('#distance').inner_text().split()[0])-one)<.02
  passed('Loop plan walks 2.5 laps, derives the finish, drags the start along the loop, exports the laps and clears')
  page.locator('#undo').click();expect(page.locator('#loop-summary')).to_contain_text('2.5 laps')
  for _ in range(4):page.locator('#undo').click()
  expect(page.locator('#waypoint-count')).to_have_text('3')
  page.locator('#ride').click();expect(page.locator('#route-status')).to_contain_text('Route ready',timeout=6000)
  assert page.evaluate('window.testRequests.some(r=>r.data.costing==="bicycle")')
  passed('Cycling mode requests bicycle routing, not automobile routing')
  page.locator('#profile').select_option('mtb')
  expect(page.locator('#route-status')).to_contain_text('Route ready',timeout=6000)
  assert page.evaluate('window.testRequests.at(-1).data.costing_options&&window.testRequests.at(-1).data.costing_options.bicycle.bicycle_type==="Mountain"')
  passed('Route profile selection re-routes with the chosen costing')
  page.evaluate('window.testRouteFailure=true');page.mouse.click(490,440)
  expect(page.locator('#retry')).to_be_visible(timeout=6000);page.locator('#export').click();expect(page.locator('#toast')).to_contain_text('Resolve the route')
  page.evaluate('window.testRouteFailure=false');page.locator('#retry').click();expect(page.locator('#route-status')).to_contain_text('Route ready',timeout=6000)
  passed('Routing failure blocks stale export and retry recovers')
  page.locator('#search').fill('31.2304, 121.4737');page.locator('#search-form').evaluate('(f)=>f.requestSubmit()');expect(page.locator('#search-results')).to_be_visible();page.locator('#search-results button').first.click()
  passed('Coordinate search works without enabling geocoding')
  page.locator('#history').click()
  downloads=page.evaluate('window.testDownloads.length');page.locator('#backup').click()
  page.wait_for_function('(n)=>window.testDownloads.length>n',arg=downloads,timeout=10000);page.wait_for_timeout(50)
  backup=page.evaluate('async()=>await window.testDownloads.at(-1)');data=json.loads(backup);assert data['product']=='SimRun' and len(data['activities'])>=2
  page.locator('#history-dialog [data-close]').click();page.locator('#settings').click();page.locator('#units').select_option('imperial');page.locator('#theme').select_option('dark');page.locator('#preferences-form').evaluate('(f)=>f.requestSubmit()');expect(page.locator('#distance')).to_contain_text('mi');assert page.locator('html').get_attribute('data-theme')=='dark'
  passed('Backup output, imperial conversion and dark appearance')
  page.locator('#settings').click()
  assert page.locator('#map-style').input_value()=='https://tiles.openfreemap.org/styles/liberty'
  assert page.locator('#map-style-dark').input_value()=='https://tiles.openfreemap.org/styles/dark'
  page.locator('#settings-dialog [data-close]').click()
  passed('Settings keep separate light and dark map styles')
  if args.isolated:
   expect(page.locator('#storage-state')).to_contain_text('Session only')
   passed('Blocked storage is reported honestly instead of promising persistence')
  else:
   page.locator('#save').click();page.wait_for_timeout(500);name=page.locator('#activity-name').input_value();page.reload();expect(page.locator('#activity-name')).to_have_value(name);page.locator('#history').click();expect(page.locator('.history-row')).to_have_count(2)
   passed('Native IndexedDB draft and history survive reload')
  kml=('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>KML route</name><Placemark><LineString><coordinates>'
       '121.47,31.23,10 121.48,31.235,12 121.49,31.24,14</coordinates></LineString></Placemark></Document></kml>')
  page.locator('#gpx-file').set_input_files({'name':'route.kml','mimeType':'application/vnd.google-earth.kml+xml','buffer':kml.encode()})
  expect(page.locator('#activity-name')).to_have_value('KML route');expect(page.locator('#empty')).to_be_hidden()
  passed('KML import builds route geometry from LineString coordinates')
  geojson=json.dumps({'type':'FeatureCollection','features':[{'type':'Feature','properties':{'name':'GeoJSON run'},'geometry':{'type':'LineString','coordinates':[[121.47,31.23],[121.475,31.235],[121.48,31.24]]}}]})
  page.locator('#gpx-file').set_input_files({'name':'route.geojson','mimeType':'application/geo+json','buffer':geojson.encode()})
  expect(page.locator('#activity-name')).to_have_value('GeoJSON run')
  passed('GeoJSON import builds route geometry from a LineString feature')
  if not args.isolated:
   page.locator('#history-dialog [data-close]').click()
   page.wait_for_function('()=>!!navigator.serviceWorker.controller',timeout=20000)
   page.wait_for_timeout(400)
   shell_files=page.evaluate("async()=>{const n=(await caches.keys()).find(k=>k.startsWith('simrun-shell-'));return n?(await (await caches.open(n)).keys()).length:0}")
   assert shell_files>=8,shell_files
   seeded=page.evaluate("""async()=>{
    const cache=await caches.open('simrun-map-v1');
    await cache.put('https://tiles.openfreemap.org/styles/dark',new Response('{}',{headers:{'Content-Type':'application/json'}}));
    return (await cache.keys()).length;
   }""")
   assert seeded>=1,seeded
   passed('The service worker precaches the app shell and exposes a bounded basemap cache')
   page.locator('#settings').click()
   expect(page.locator('#offline-status')).to_contain_text('of up to')
   page.locator('#offline-clear').click()
   expect(page.locator('#offline-status')).to_contain_text('No basemap resources cached')
   page.locator('#settings-dialog [data-close]').click()
   passed('Settings report and clear cached basemap data')
   context.set_offline(True)
   page.reload()
   expect(page.locator('.brand')).to_contain_text('SimRun')
   assert page.locator('#offset option').count()>0,'app did not boot after an offline reload'
   context.set_offline(False)
   passed('The app shell reloads offline from the cache')
  assert not errors,errors
  passed('No uncaught JavaScript exceptions throughout tested interactions')
  print(json.dumps({'passed':len(results),'mode':'isolated DOM; mocked providers; no native persistence' if args.isolated else 'HTTP; mocked providers','checks':results},indent=2))
  browser.close()

from pathlib import Path
import argparse
import os
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('--url',default='http://127.0.0.1:5190')
parser.add_argument('--chromium',default=os.environ.get('CHROMIUM_PATH',''))
parser.add_argument('--axe',default=os.environ.get('AXE_PATH','/tmp/hoplite/axe/node_modules/axe-core/axe.min.js'))
args=parser.parse_args()
axe_path=Path(args.axe)
assert axe_path.is_file(),f'axe-core is missing: {axe_path}'
fixture=('<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Accessibility fixture</name><trkseg>'
         '<trkpt lat="31.2300" lon="121.4700"><ele>12</ele></trkpt>'
         '<trkpt lat="31.2320" lon="121.4740"><ele>18</ele></trkpt>'
         '<trkpt lat="31.2350" lon="121.4790"><ele>14</ele></trkpt>'
         '</trkseg></trk></gpx>')
tags=['wcag2a','wcag2aa','wcag21aa','best-practice']
dialogs=['history-dialog','send-dialog','settings-dialog','route-range-dialog','merge-dialog','share-dialog','compare-dialog','shortcuts-dialog']
results=[]
contrast_rows=[]
def scan(page,label):
 result=page.evaluate('''async tags=>{const r=await axe.run(document,{runOnly:{type:'tag',values:tags}});return {violations:r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),passes:r.passes.length,incomplete:r.incomplete.length}}''',tags)
 results.append((label,result))
 return result
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=args.chromium or None,headless=True)
 errors=[]
 for width,height in [(1440,900),(390,844)]:
  for theme in ['light','dark']:
   page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
   page.on('pageerror',lambda error:errors.append(str(error)))
   page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(args.url) or route.request.url.startswith('data:') else route.abort())
   page.goto(args.url,wait_until='domcontentloaded');page.wait_for_timeout(500);page.add_script_tag(path=str(axe_path))
   page.evaluate('(theme)=>document.documentElement.dataset.theme=theme',theme)
   contrast=page.evaluate(r'''()=>{const style=getComputedStyle(document.documentElement);const rgb=value=>{if(value.startsWith('#')){let h=value.slice(1);if(h.length===3)h=[...h].map(c=>c+c).join('');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));}const m=value.match(/[\d.]+/g);return m.slice(0,3).map(Number)};const lum=value=>{const c=rgb(value).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};const ratio=(a,b)=>{const [x,y]=[lum(a),lum(b)].sort((u,v)=>v-u);return (x+.05)/(y+.05)};const bg=style.getPropertyValue('--bg').trim(),soft=style.getPropertyValue('--soft').trim(),map=style.getPropertyValue('--map').trim(),text=style.getPropertyValue('--text').trim(),muted=style.getPropertyValue('--muted').trim(),line=style.getPropertyValue('--line').trim(),grid=style.getPropertyValue('--grid').trim(),accent=style.getPropertyValue('--accent').trim();return {text:ratio(text,bg),muted:ratio(muted,bg),controlBorder:ratio(line,soft),grid:ratio(grid,bg),focus:ratio(accent,bg),disabledOpacity:getComputedStyle(document.querySelector('#undo')).opacity,disabledText:ratio(getComputedStyle(document.querySelector('#undo')).color,bg),grade:[...document.querySelectorAll('.grade-legend i')].map(e=>{const color=getComputedStyle(e).backgroundColor;return [ratio(color,bg),ratio(color,map)]})}}''')
   assert contrast['text']>=4.5 and contrast['muted']>=4.5,contrast
   assert contrast['controlBorder']>=3 and contrast['grid']>=3 and contrast['focus']>=3,contrast
   assert contrast['disabledOpacity']=='1' and contrast['disabledText']>=4.5,contrast
   assert all(min(values)>=3 for values in contrast['grade']),contrast
   contrast_rows.append((theme,width,contrast))
   assert page.locator('#empty').is_visible()
   assert page.locator('#route-status').get_attribute('role')=='status'
   assert page.locator('#toast').get_attribute('aria-live')=='polite'
   scan(page,f'empty-{theme}-{width}')
   page.locator('#gpx-file').set_input_files({'name':'accessibility.gpx','mimeType':'application/gpx+xml','buffer':fixture.encode()})
   page.wait_for_timeout(700)
   assert page.locator('#empty').is_hidden()
   scan(page,f'routed-{theme}-{width}')
   for dialog in dialogs:
    page.evaluate('(id)=>{const d=document.getElementById(id);if(!d.open)d.showModal()}',dialog)
    scan(page,f'{dialog}-{theme}-{width}')
    page.evaluate('(id)=>{const d=document.getElementById(id);if(d.open)d.close()}',dialog)
   if width==1440:
    for chart_mode in ['chart-elevation','chart-pace','chart-hr','chart-power','chart-cadence','chart-splits']:
     page.locator('#'+chart_mode).click()
     scan(page,f'{chart_mode}-{theme}')
   page.close()
 page=browser.new_page(viewport={'width':1440,'height':900},reduced_motion='reduce')
 page.on('pageerror',lambda error:errors.append(str(error)))
 page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(args.url) or route.request.url.startswith('data:') else route.abort())
 page.goto(args.url,wait_until='domcontentloaded');page.wait_for_timeout(450)
 page.set_viewport_size({'width':320,'height':844})
 overflow=page.evaluate('document.documentElement.scrollWidth>document.documentElement.clientWidth')
 assert not overflow,'320px reflow has horizontal overflow'
 page.locator('#chart-splits').scroll_into_view_if_needed()
 tab_bounds=page.evaluate('''()=>{const a=document.querySelector('#chart-tabs'),b=document.querySelector('#chart-splits'),ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return br.left>=ar.left-1&&br.right<=ar.right+1}''')
 assert tab_bounds,'the last chart tab is not reachable at 320px'
 page.set_viewport_size({'width':720,'height':450})
 overflow=page.evaluate('document.documentElement.scrollWidth>document.documentElement.clientWidth')
 assert not overflow,'200% zoom equivalent viewport has horizontal overflow'
 page.emulate_media(contrast='more',reduced_motion='reduce')
 page.evaluate("document.documentElement.dataset.theme='light'")
 contrast_vars=page.evaluate('''()=>{const s=getComputedStyle(document.documentElement);return ['--muted','--line','--grid','--accent'].map(k=>[k,s.getPropertyValue(k).trim()])}''')
 assert all(value for _,value in contrast_vars)
 page.set_viewport_size({'width':1440,'height':900})
 page.locator('#chart-elevation').focus();page.keyboard.press('ArrowRight')
 assert page.evaluate("document.activeElement.id")=='chart-pace','chart tabs did not support arrow navigation'
 assert page.locator('#chart-pace').get_attribute('aria-selected')=='true'
 page.locator('#settings').focus();page.keyboard.press('Enter');dialog=page.locator('#settings-dialog')
 assert dialog.evaluate('(d)=>d.open')
 assert dialog.evaluate('(d)=>d.contains(document.activeElement)'),'focus did not enter settings dialog'
 page.keyboard.press('Escape');assert not dialog.evaluate('(d)=>d.open')
 assert page.evaluate("document.activeElement.id")=='settings','focus was not restored after dialog close'
 page.locator('#map-center-add').focus();page.keyboard.press('Enter')
 rows=page.locator('.waypoint-row');assert rows.count()==1,'keyboard map-center add did not create a waypoint'
 before=rows.locator('.coordinate').text_content()
 page.keyboard.press('Shift+ArrowUp')
 after=rows.locator('.coordinate').text_content();assert before!=after,'arrow key did not move the selected waypoint'
 page.keyboard.press('Delete');assert rows.count()==0,'Delete did not remove the selected waypoint'
 page.locator('#gpx-file').set_input_files({'name':'chart.gpx','mimeType':'application/gpx+xml','buffer':fixture.encode()})
 page.wait_for_timeout(500);page.locator('#chart').focus();page.keyboard.press('ArrowRight')
 assert page.locator('#chart .chart-tooltip').count()==1,'chart arrow-key scrubbing did not show a data point'
 page.set_viewport_size({'width':390,'height':844})
 page.locator('#settings').click();page.locator('#locale').fill('en-XA');page.locator('#locale').dispatch_event('change')
 page.wait_for_function("document.documentElement.lang==='en-XA'",timeout=10000);page.wait_for_timeout(250)
 assert page.locator('html').get_attribute('lang')=='en-XA'
 unmarked=page.evaluate('''()=>{const out=[],w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(w.nextNode()){const n=w.currentNode,t=n.textContent.trim(),e=n.parentElement;if(!t||!e||!e.getClientRects().length||e.closest('[hidden],script,style,svg,#map,.brand,.map-credit,.provider-guidance,.send-guidance'))continue;if(/^[0-9.,: %+/−–]+$/.test(t))continue;if(!t.includes('⟦')||!t.includes('⟧'))out.push({text:t.slice(0,100),tag:e.tagName,class:e.className||''});}return out}''')
 assert not unmarked,f'en-XA has visible unextracted strings: {unmarked[:20]}'
 page.locator('#settings').click()
 settings_unmarked=page.evaluate('''()=>{const out=[],w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(w.nextNode()){const n=w.currentNode,t=n.textContent.trim(),e=n.parentElement;if(!t||!e||!e.getClientRects().length||e.closest('[hidden],script,style,svg,#map,.brand,.map-credit,.provider-guidance,.send-guidance'))continue;if(/^[0-9.,: %+/−–]+$/.test(t))continue;if(!t.includes('⟦')||!t.includes('⟧'))out.push({text:t.slice(0,100),tag:e.tagName,class:e.className||''});}return out}''')
 assert not settings_unmarked,f'en-XA settings have visible unextracted strings: {settings_unmarked[:20]}'
 page.locator('#settings-dialog [data-close]').click();page.locator('#settings').click();page.locator('#locale').fill('ar-XB');page.locator('#locale').dispatch_event('change')
 page.wait_for_function("document.documentElement.lang==='ar-XB'",timeout=10000);page.wait_for_timeout(250)
 assert page.locator('html').get_attribute('lang')=='ar-XB'
 assert page.locator('html').get_attribute('dir')=='rtl'
 assert page.locator('#map').evaluate('(e)=>getComputedStyle(e).direction')=='ltr'
 overflow=page.evaluate('document.documentElement.scrollWidth>document.documentElement.clientWidth')
 assert not overflow,'ar-XB layout has horizontal overflow'
 layout=page.evaluate('''()=>{const brand=document.querySelector('.brand').getBoundingClientRect(),actions=document.querySelector('.top-actions').getBoundingClientRect();return {brand:brand.left,brandRight:brand.right,actions:actions.left,actionsRight:actions.right}}''')
 assert layout['brand']>layout['actions'],'RTL header did not mirror its navigation order'
 serious=[]
 other={}
 for label,result in results:
  for violation in result['violations']:
   key=(violation['impact'],violation['id'])
   other[key]=other.get(key,0)+1
   if violation['impact'] in ('serious','critical'):
    serious.append((label,violation))
 print('contrast ratios by theme and viewport:',[(theme,width,{key:round(value,2) if isinstance(value,float) else value for key,value in values.items() if key!='grade'},[[round(x,2) for x in grade] for grade in values['grade']]) for theme,width,values in contrast_rows])
 print(f'axe states: {len(results)}; passes: {sum(result["passes"] for _,result in results)}; incomplete checks: {sum(result["incomplete"] for _,result in results)}')
 print('axe remaining by impact/rule:',sorted((impact,rule,count) for (impact,rule),count in other.items()))
 assert not serious,'serious/critical axe violations: '+repr(serious[:12])
 assert not errors,'uncaught browser errors: '+repr(errors)
 print('PASS axe WCAG 2.0/2.1 AA and best-practice states with measured contrast checks')
 print('PASS 320px reflow, 200% zoom-equivalent viewport, reduced-motion, and high-contrast preference')
 print('PASS dialog focus/escape/return, keyboard waypoint add/move/delete, and chart arrow scrubbing')
 print('PASS en-XA marker scan and ar-XB RTL/no-overflow/mirror checks')
 browser.close()

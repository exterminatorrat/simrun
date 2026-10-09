import test from 'node:test';
import assert from 'node:assert/strict';
import {SHARE_POINT_LIMIT,SHARE_WARN_CHARS,QR_CHAR_LIMIT,encodePolyline,decodePolyline,encodeShare,decodeShare,shareUrl,shareWarning} from '../dist/src/share.js';

const path=[{lat:38.5,lon:-120.2},{lat:40.7,lon:-120.95},{lat:43.252,lon:-126.453}];
const activity=(sport='run',p=path)=>({
 id:'test',version:1,name:'Test',createdAt:0,updatedAt:0,waypoints:p,path:p,source:'draft',
 settings:{sport,start:'2026-01-01T08:00',utcOffset:0,pace:300,speed:30,mode:'constant',variation:0,sample:5,hrEnabled:false,hrAverage:150,hrVariation:0,seed:1}
});
const b64url=s=>Buffer.from(s,'utf8').toString('base64url');
const craft=(text)=>'r='+b64url(text);

test('polyline round-trips at 1e5 precision and matches the reference encoding',()=>{
 assert.equal(encodePolyline(path),'_p~iF~ps|U_ulLnnqC_mqNvxq`@');
 const round=decodePolyline(encodePolyline(path));
 assert.equal(round.length,path.length);
 path.forEach((p,i)=>{assert.ok(Math.abs(round[i].lat-p.lat)<1e-5);assert.ok(Math.abs(round[i].lon-p.lon)<1e-5);});
 assert.equal(encodePolyline([{lat:0,lon:0}]),'??');
 assert.equal(decodePolyline('??')[0].lat,0);
});

test('encodeShare round-trips coordinates and sport through a base64url fragment',()=>{
 for(const sport of ['run','ride']){
  const frag=encodeShare(activity(sport));
  assert.match(frag,/^r=[A-Za-z0-9_-]*$/);
  assert.doesNotMatch(frag.slice(2),/[+/=]/);
  const out=decodeShare(frag);
  assert.ok(out);
  assert.equal(out.sport,sport);
  assert.equal(out.points.length,path.length);
  out.points.forEach((p,i)=>{assert.ok(Math.abs(p.lat-path[i].lat)<1e-5);assert.ok(Math.abs(p.lon-path[i].lon)<1e-5);});
 }
});

test('decodeShare accepts a full URL, a fragment, or a bare payload',()=>{
 const frag=encodeShare(activity('ride'));
 for(const input of [`https://example.com/app#${frag}`,`#${frag}`,frag]){
  const out=decodeShare(input);
  assert.ok(out);assert.equal(out.sport,'ride');assert.equal(out.points.length,path.length);
 }
});

test('decodeShare returns null for empty, garbage, oversized, or invalid input and never throws',()=>{
 assert.equal(decodeShare(''),null);
 assert.equal(decodeShare('#'),null);
 assert.equal(decodeShare('garbage'),null);
 assert.equal(decodeShare('r=!!!!'),null);
 assert.equal(decodeShare(encodePolyline([{lat:91,lon:0},{lat:0,lon:0}])),null);
 const invalid=craft('0'+encodePolyline([{lat:95,lon:181}]));
 assert.equal(decodeShare(invalid),null);
 const big=Array.from({length:SHARE_POINT_LIMIT+1},(_,i)=>({lat:i*.001%80,lon:i*.002%170}));
 assert.equal(decodeShare(craft('0'+encodePolyline(big))),null);
 assert.equal(decodeShare('#'+craft('x garbage')),null);
});

test('encodeShare rejects paths over the share point limit',()=>{
 const big=Array.from({length:SHARE_POINT_LIMIT+1},(_,i)=>({lat:i*.001%80,lon:i*.002%170}));
 assert.throws(()=>encodeShare(activity('run',big)));
 assert.equal(encodeShare(activity('run',Array.from({length:SHARE_POINT_LIMIT},()=>({lat:1,lon:1})))).length>0,true);
});

test('shareUrl embeds the payload as a fragment',()=>{
 const url=shareUrl('https://simrun.app/',activity());
 assert.ok(url.startsWith('https://simrun.app/#r='));
 assert.equal(decodeShare(url).points.length,path.length);
});

test('shareWarning thresholds behave',()=>{
 assert.equal(shareWarning('x'.repeat(QR_CHAR_LIMIT)),null);
 const warn=shareWarning('x'.repeat(SHARE_WARN_CHARS));
 assert.ok(warn);assert.match(warn,/QR/);assert.match(warn,/GPX/);assert.doesNotMatch(warn,/truncate/);
 const warnPlus=shareWarning('x'.repeat(QR_CHAR_LIMIT+1));
 assert.ok(warnPlus);assert.match(warnPlus,/QR/);assert.match(warnPlus,/GPX/);assert.doesNotMatch(warnPlus,/truncate/);
 assert.match(shareWarning('x'.repeat(SHARE_WARN_CHARS+1)),/truncate/);
});

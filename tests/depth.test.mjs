import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults, simulate, validateActivity, WEATHER_PRESETS, weatherFactor, weatherHeat} from '../dist/src/model.js';
import {exportGPX} from '../dist/src/gpx.js';

const flat=[{lon:0,lat:0,ele:0},{lon:0.045,lat:0,ele:0}];
const uphillSecond=[{lon:0,lat:0,ele:0},{lon:0.0225,lat:0,ele:0},{lon:0.045,lat:0,ele:100}];
const downhillSecond=[{lon:0,lat:0,ele:100},{lon:0.0225,lat:0,ele:100},{lon:0.045,lat:0,ele:0}];
const base=()=>{const a=defaults();a.path=flat;a.source='routed';return a;};
const halfTimes=a=>{const s=simulate(a),mid=s.points.find(p=>p.distance>=s.distance/2),end=s.points.at(-1);return {first:mid.time-s.points[0].time,second:end.time-mid.time};};

test('weather presets exist and neutral conditions are exactly neutral',()=>{
 assert.ok(Object.keys(WEATHER_PRESETS).length>=7);
 assert.equal(weatherFactor(undefined),1);
 assert.equal(weatherFactor({preset:'ideal',tempC:15,humidity:50,headwindKph:0}),1);
 assert.equal(weatherHeat(undefined),1);
 assert.equal(weatherHeat({preset:'ideal',tempC:15,humidity:50,headwindKph:0}),1);
});

test('weather scales duration but never geometry, and stays deterministic',()=>{
 const a=base();
 const ideal=simulate({...a,settings:{...a.settings,weather:{preset:'ideal',tempC:15,humidity:50,headwindKph:0}}});
 const hot=simulate({...a,settings:{...a.settings,weather:{preset:'hot',tempC:34,humidity:30,headwindKph:4}}});
 const windy=simulate({...a,settings:{...a.settings,weather:{preset:'windy',tempC:16,humidity:55,headwindKph:22}}});
 assert.ok(hot.duration>ideal.duration*1.1);
 assert.ok(windy.duration>ideal.duration*1.05);
 assert.equal(hot.distance,ideal.distance);
 assert.equal(hot.points[0].lat,ideal.points[0].lat);assert.equal(hot.points.at(-1).lon,ideal.points.at(-1).lon);
 assert.ok(hot.points.every((p,i)=>i===0||p.distance>hot.points[i-1].distance));
 assert.deepEqual(hot,simulate({...a,settings:{...a.settings,weather:{preset:'hot',tempC:34,humidity:30,headwindKph:4}}}));
});

test('heat deepens cardiac drift while the HR average contract holds',()=>{
 const a=base();a.settings.hrEnabled=true;a.settings.mode='natural';a.settings.sample=1;
 a.settings.seed=5;
 a.path=[{lon:0,lat:0,ele:0},{lon:12/111.32,lat:0,ele:0}];
 const cool=simulate({...a,settings:{...a.settings,weather:{preset:'cool',tempC:6,humidity:60,headwindKph:3}}});
 const hot=simulate({...a,settings:{...a.settings,weather:{preset:'hot',tempC:34,humidity:80,headwindKph:4}}});
 const mean=s=>{let sum=0;for(let i=1;i<s.points.length;i++)sum+=(s.points[i].hr+s.points[i-1].hr)/2*(s.points[i].time-s.points[i-1].time);return sum/(s.duration*1000);};
 assert.ok(Math.abs(mean(cool)-a.settings.hrAverage)<.6);
 assert.ok(Math.abs(mean(hot)-a.settings.hrAverage)<.6);
 const rise=s=>{const t0=s.points[0].time,band=(lo,hi)=>{const v=s.points.filter(p=>{const m=(p.time-t0)/60000;return m>=lo&&m<=hi;}).map(p=>p.hr);return v.reduce((x,y)=>x+y,0)/v.length;};return band(50,60)-band(12,20);};
 assert.ok(rise(hot)>rise(cool));
});

test('smoothed grade slows uphill more than it speeds downhill',()=>{
 const up=base();up.path=uphillSecond;up.settings.mode='natural';up.settings.variation=0;
 const down=base();down.path=downhillSecond;down.settings.mode='natural';down.settings.variation=0;
 const flatTimes=halfTimes((()=>{const f=base();f.settings.mode='natural';f.settings.variation=0;return f;})());
 const upTimes=halfTimes(up),downTimes=halfTimes(down);
 assert.ok(Math.abs(flatTimes.first-flatTimes.second)<10000);
 assert.ok(upTimes.second>upTimes.first);
 assert.ok(downTimes.second<downTimes.first);
 assert.ok(upTimes.second>downTimes.second);
 assert.equal(simulate(up).duration,simulate(down).duration);
});

test('power and cadence are optional, bounded and deterministic',()=>{
 const a=base();a.settings.power={enabled:true,weightKg:70};a.settings.cadence={enabled:true};
 const s=simulate(a);
 assert.ok(s.points.every(p=>Number.isInteger(p.power)&&p.power>=0&&p.power<=2000));
 assert.ok(s.points.every(p=>Number.isInteger(p.cad)&&p.cad>=50&&p.cad<=190));
 assert.deepEqual(s,simulate(a));
 const off=simulate({...a,settings:{...a.settings,power:{enabled:false,weightKg:70},cadence:{enabled:false}}});
 assert.ok(off.points.every(p=>p.power===undefined&&p.cad===undefined));
});

test('fatigue reshapes timing without changing the target duration',()=>{
 const a=base();a.settings.mode='natural';a.settings.variation=0;
 const fresh=simulate(a);
 const tired=simulate({...a,settings:{...a.settings,fatigue:{percent:25}}});
 assert.equal(tired.duration,fresh.duration);
 const t=halfTimes({...a,settings:{...a.settings,fatigue:{percent:25}}});
 assert.ok(t.second>t.first);
});

test('new settings and metadata round-trip through validation and reject bad values',()=>{
 const a=base();
 a.settings.weather={preset:'warm',tempC:26,humidity:50,headwindKph:5};
 a.settings.power={enabled:true,weightKg:75};a.settings.cadence={enabled:true};a.settings.fatigue={percent:10};
 a.tags=['A','A','b'];a.pauses={rests:[{distance:1000,seconds:60}]};a.workout={steps:[{kind:'work',distance:5000}]};
 const clean=validateActivity(a);
 assert.deepEqual(clean.settings.weather,{preset:'warm',tempC:26,humidity:50,headwindKph:5});
 assert.deepEqual(clean.settings.power,{enabled:true,weightKg:75});
 assert.deepEqual(clean.settings.fatigue,{percent:10});
 assert.deepEqual(clean.tags,['A','b']);
 assert.deepEqual(clean.pauses,{rests:[{distance:1000,seconds:60}]});
 assert.deepEqual(clean.workout,{steps:[{kind:'work',distance:5000}]});
 for(const weather of [{preset:'storm',tempC:15,humidity:50,headwindKph:0},{preset:'hot',tempC:200,humidity:50,headwindKph:0}])assert.throws(()=>validateActivity({...a,settings:{...a.settings,weather}}));
 for(const power of [{enabled:true,weightKg:5},{enabled:'yes',weightKg:70}])assert.throws(()=>validateActivity({...a,settings:{...a.settings,power}}));
 assert.throws(()=>validateActivity({...a,settings:{...a.settings,fatigue:{percent:80}}}));
 assert.throws(()=>validateActivity({...a,pauses:{rests:[{distance:0,seconds:0}]}}));
});

test('GPX carries opt-in power, cadence and temperature extensions',()=>{
 const a=base();a.settings.weather={preset:'hot',tempC:34,humidity:30,headwindKph:4};
 a.settings.power={enabled:true,weightKg:70};a.settings.cadence={enabled:true};a.settings.hrEnabled=true;
 const x=exportGPX(a,simulate(a));
 assert.match(x,/<gpxpx:Watts>/);assert.match(x,/<gpxtpx:cad>/);assert.match(x,/<gpxtpx:atemp>/);assert.match(x,/<gpxtpx:hr>/);
 assert.match(x,/PowerExtension\/v1/);assert.match(x,/simulated weather/);assert.match(x,/not a recorded workout/);
});

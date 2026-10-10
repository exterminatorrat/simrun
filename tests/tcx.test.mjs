import test from 'node:test';
import assert from 'node:assert/strict';
import {exportTCX, exportTCXCourse, importTCX} from '../dist/src/tcx.js';
import {defaults, simulate, PRODUCT} from '../dist/src/model.js';

// importTCX parses with DOMParser (browser-only), but its input guards run before that.
test('importTCX rejects oversized input and document types before parsing',()=>{
 assert.throws(()=>importTCX('x'.repeat(15000001)),/15 MB/);
 assert.throws(()=>importTCX('<!DOCTYPE foo><TrainingCenterDatabase/>'),/document types/);
 assert.throws(()=>importTCX('<!ENTITY x "y"><TrainingCenterDatabase/>'),/document types/);
});

const activity=(settings={})=>{const a=defaults();a.path=[{lat:0,lon:0,ele:10},{lat:0,lon:0.01,ele:20},{lat:0,lon:0.02,ele:15}];a.source='routed';Object.assign(a.settings,settings);return a;};

test('activity document carries the TrainingCenterDatabase Activity/Lap/Track structure',()=>{
 const xml=exportTCX(activity(),simulate(activity()));
 assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
 assert.ok(xml.includes('<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"'));
 assert.ok(xml.includes('<Activities>'));
 assert.ok(xml.includes('<Activity Sport="Running">'));
 assert.ok(/<Id>\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/Id>/.test(xml));
 assert.ok(/<Lap StartTime="\d{4}-\d{2}-\d{2}T[\d:.]+Z">/.test(xml));
 assert.ok(xml.includes('<TotalTimeSeconds>'));
 assert.ok(xml.includes('<DistanceMeters>'));
 assert.ok(xml.includes('<MaximumSpeed>'));
 assert.ok(xml.includes('<Track>'));
 assert.ok(xml.includes('<Trackpoint>'));
 assert.ok(xml.trimEnd().endsWith('</TrainingCenterDatabase>'));
});

test('sport maps run to Running and ride to Biking',()=>{
 const a=activity(),ride=activity({sport:'ride'});
 assert.ok(exportTCX(a,simulate(a)).includes('Sport="Running"'));
 assert.ok(exportTCX(ride,simulate(ride)).includes('Sport="Biking"'));
});

test('trackpoint count matches the simulated samples',()=>{
 const a=activity(),s=simulate(a);
 const xml=exportTCX(a,s);
 assert.equal(xml.split('<Trackpoint>').length-1,s.points.length);
 assert.equal(xml.split('</Trackpoint>').length-1,s.points.length);
});

test('trackpoints carry Time, Position, AltitudeMeters and honest extensions only when enabled',()=>{
 const plain=activity(),s=simulate(plain),xml=exportTCX(plain,s);
 const first=xml.slice(xml.indexOf('<Trackpoint>'),xml.indexOf('</Trackpoint>'));
 assert.ok(first.includes(`<Time>${new Date(s.points[0].time).toISOString()}</Time>`));
 assert.ok(first.includes('<Position><LatitudeDegrees>'));
 assert.ok(first.includes('<LongitudeDegrees>'));
 assert.ok(first.includes('<AltitudeMeters>'));
 assert.ok(!xml.includes('<HeartRateBpm>'));
 assert.ok(!xml.includes('<AverageHeartRateBpm>'));
 assert.ok(!xml.includes('<Watts>'));
 assert.ok(!xml.includes('<RunCadence>'));
 assert.ok(!xml.includes('TPX'));
 const hr=activity({hrEnabled:true,hrAverage:150,hrVariation:5}),hrXml=exportTCX(hr,simulate(hr));
 assert.ok(hrXml.includes('<HeartRateBpm><Value>'));
 assert.ok(hrXml.includes('<AverageHeartRateBpm><Value>'));
 const powered=activity({power:{enabled:true,weightKg:75},cadence:{enabled:true}});
 const poweredXml=exportTCX(powered,simulate(powered));
 assert.ok(poweredXml.includes(`<TPX xmlns="http://www.garmin.com/xmlschemas/ActivityExtension/v2">`));
 assert.ok(poweredXml.includes('<Watts>'));
 assert.ok(poweredXml.includes('<RunCadence>'));
});

test('the document states the activity is simulated, not recorded',()=>{
 const a=activity(),xml=exportTCX(a,simulate(a));
 assert.ok(xml.includes('<Notes>'));
 assert.ok(xml.includes('simulated'));
 assert.ok(xml.includes(PRODUCT));
 assert.ok(xml.includes('not a recorded workout or device measurement'));
});

test('malformed or empty simulations are rejected',()=>{
 const a=activity();
 assert.throws(()=>exportTCX(a,{points:[],duration:1,distance:1,interval:2}));
 assert.throws(()=>exportTCX(a,{points:[{lat:0,lon:0,time:0,distance:0,speed:3}],duration:1,distance:1,interval:2}));
 assert.throws(()=>exportTCX(a,{points:[{lat:0,lon:0,time:0,distance:0,speed:3},{lat:0,lon:0.01,time:0,distance:10,speed:3}],duration:1,distance:1,interval:2}));
 assert.throws(()=>exportTCX(a,{points:[{lat:0,lon:0,time:0,distance:0,speed:3},{lat:200,lon:0,time:1,distance:10,speed:3}],duration:1,distance:1,interval:2}));
 assert.throws(()=>exportTCX(a,{points:[{lat:0,lon:0,time:0,distance:0,speed:3},{lat:0,lon:0.01,time:'x',distance:10,speed:3}],duration:1,distance:1,interval:2}));
});

test('XML special characters in the name are escaped',()=>{
 const a=activity();a.name='Run <&> "test" \'now\'';
 const xml=exportTCX(a,simulate(a));
 assert.ok(xml.includes('Run &lt;&amp;&gt; &quot;test&quot; &apos;now&apos; is a simulated activity'));
 assert.ok(!xml.includes('<&>'));
});

test('course document derives course points from the route geometry without street names',()=>{
 const corner=activity();corner.path=[{lat:0,lon:0,ele:10},{lat:0,lon:0.01,ele:20},{lat:0.01,lon:0.01,ele:20}];
 const s=simulate(corner),xml=exportTCXCourse(corner,s);
 assert.ok(xml.includes('<Courses xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"'));
 assert.ok(xml.includes('<Course>'));
 assert.ok(xml.includes('<Track>'));
 assert.equal(xml.split('<Trackpoint>').length-1,s.points.length);
 assert.ok(xml.includes('<Name>Start</Name>'));
 assert.ok(xml.includes('<Name>Finish</Name>'));
 assert.ok(xml.includes('<Name>Turn left</Name>'));
 assert.ok(xml.includes('<Type>Left</Type>'));
 assert.ok(xml.includes('<CoursePoint>'));
 assert.ok(xml.includes('<Time>'));
 const names=[...xml.matchAll(/<Name>([^<]*)<\/Name>/g)].map(m=>m[1]);
 assert.ok(names.every(n=>['Start','Finish','Turn left','Turn right','Sharp left','Sharp right','Slight left','Slight right','U-turn'].includes(n)));
});

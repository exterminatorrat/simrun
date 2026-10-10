import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults} from '../dist/src/model.js';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createActivityFiles,platformGuidance,selectPlatformFile,zipActivities} from '../dist/src/send.js';
import {parseBackup} from '../dist/src/storage.js';
import {defaultPreferences} from '../dist/src/model.js';

test('activity exports include labeled GPX, TCX and FIT with recommended platform format selection',()=>{
 const activity=defaults();activity.name='Simulated loop';activity.source='routed';activity.path=[{lat:45,lon:-73},{lat:45.01,lon:-73.01}];
 const files=createActivityFiles(activity);
 assert.deepEqual(files.map(file=>file.name.split('.').at(-1)),['gpx','tcx','fit']);
 assert.match(files[0].data,/simulated/i);assert.match(files[1].data,/simulated/i);
 for(const platform of platformGuidance){const file=selectPlatformFile(files,platform.id);assert.ok(file);assert.ok(file.name.endsWith(`.${platform.format}`));}
});
test('ZIP activity export includes formats and a full-library backup with preferences',()=>{
 const activity=defaults();activity.name='Weekend ride';activity.source='routed';activity.path=[{lat:45,lon:-73},{lat:45.01,lon:-73.01}];activity.collection='Weekend';
 const bytes=zipActivities([activity],defaultPreferences);
 const folder=mkdtempSync(join(tmpdir(),'simrun-library-'));
 try{
  const path=join(folder,'library.zip');writeFileSync(path,bytes);
  const text=execFileSync('python3',['-c','import sys,zipfile; print(zipfile.ZipFile(sys.argv[1]).read("simrun-backup.json").decode())',path],{encoding:'utf8'});
  const backup=parseBackup(text);
  assert.equal(backup.activities[0].collection,'Weekend');
  assert.deepEqual(backup.preferences,defaultPreferences);
 }finally{rmSync(folder,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createZip,crc32,ZIP_LIMITS} from '../dist/src/zip.js';

test('CRC-32 matches the standard check value',()=>{
 assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);
});
test('ZIP output passes the independent Python zipfile reader with UTF-8 names and DOS timestamps',()=>{
 const folder=mkdtempSync(join(tmpdir(),'simrun-zip-'));
 try{
  const file=join(folder,'test.zip'),date=new Date(2024,0,2,3,4,7);
  writeFileSync(file,createZip([{name:'活動/run.gpx',data:'simulated track',modifiedAt:date},{name:'notes.txt',data:'synthetic'}]));
  execFileSync('python3',['-m','zipfile','-t',file],{stdio:'pipe'});
  const details=execFileSync('python3',['-c','import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert z.namelist()==["活動/run.gpx","notes.txt"]; assert z.read("活動/run.gpx")==b"simulated track"; assert z.getinfo("活動/run.gpx").date_time==(2024,1,2,3,4,6)',file],{encoding:'utf8'});
  assert.equal(details,'');
 }finally{rmSync(folder,{recursive:true,force:true});}
});
test('ZIP rejects too many files, oversized entries, invalid paths and duplicate names',()=>{
 assert.throws(()=>createZip(Array.from({length:ZIP_LIMITS.files+1},(_,i)=>({name:`${i}.txt`,data:''}))),/at most/);
 assert.throws(()=>createZip([{name:'large.bin',data:new Uint8Array(ZIP_LIMITS.fileBytes+1)}]),/smaller than/);
 const shared=new Uint8Array(ZIP_LIMITS.fileBytes);
 assert.throws(()=>createZip(Array.from({length:11},(_,i)=>({name:`large-${i}.bin`,data:shared}))),/smaller than/);
 assert.throws(()=>createZip([{name:'../escape.txt',data:''}]),/file name is invalid/);
 assert.throws(()=>createZip([{name:'same.txt',data:''},{name:'same.txt',data:''}]),/unique/);
});

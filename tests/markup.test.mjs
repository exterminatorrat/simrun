import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../src/main.ts',import.meta.url),'utf8');

test('every element id in the shell is unique',()=>{
 const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 const duplicates=[...new Set(ids.filter((v,i)=>ids.indexOf(v)!==i))];
 assert.deepEqual(duplicates,[],`duplicate ids: ${duplicates.join(', ')}`);
});

test('no input tag swallows a following tag',()=>{
 // An unclosed input lets the next `<tag` be parsed as attributes, corrupting the form.
 const broken=[...html.matchAll(/<input\b[^>]*</g)].map(m=>m[0].slice(0,60));
 assert.deepEqual(broken,[],`unclosed input: ${broken.join(' | ')}`);
});

test('simulation-depth controls are present and wired to the editor',()=>{
 const controls=['activity-description','sport-type','pace-strategy','pace-segments','gap-stat','trimp-stat','trimp-resting-hr','trimp-max-hr','batch-count','batch-save'];
 for(const id of controls){assert.ok(html.includes(`id=\"${id}\"`),`missing HTML control ${id}`);assert.ok(main.includes(`'${id}'`),`missing app wiring for ${id}`);}
});

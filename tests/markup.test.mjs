import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

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

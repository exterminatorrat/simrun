import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('the built service worker carries a content build id',async()=>{
 const sw=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');
 assert.doesNotMatch(sw,/__SIMRUN_BUILD__/,'the placeholder must be replaced during the build');
 assert.match(sw,/const BUILD='[0-9a-f]{16}'/,'the build id is a content hash');
 assert.match(sw,/simrun-shell-\$\{BUILD\}-/,'the shell cache name must include the build id');
});

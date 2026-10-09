import {cp, mkdir, readdir, writeFile} from 'node:fs/promises';
import {relative, resolve, sep} from 'node:path';
await mkdir('dist', {recursive:true});
await cp('public', 'dist', {recursive:true});
// The service worker precaches the built layout: the copied static assets plus the
// modules TypeScript compiled into dist/src. Deriving that list from public/ and
// src/ keeps it exact even when dist/ still holds output from an earlier build.
const files=[];
const walk=async(directory,base=directory)=>{
  for (const entry of (await readdir(directory, {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    const path=resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path, base);
    else files.push(relative(base, path).split(sep).join('/'));
  }
};
await walk('public');
for (const name of (await readdir('src')).sort()) if (name.endsWith('.ts')) files.push(`src/${name.replace(/\.ts$/,'.js')}`);
const precache=files.filter(name => name !== 'sw.js');
await writeFile('dist/sw-manifest.json', JSON.stringify({files:precache}, null, 2) + '\n');
console.log(`Static application built in dist/ with ${precache.length} precached files.`);

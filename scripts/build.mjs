import {cp, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
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
const walkSources=async(directory='src',base='src')=>{
  for (const entry of (await readdir(directory, {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    const path=resolve(directory, entry.name);
    if (entry.isDirectory()) await walkSources(path,base);
    else if (entry.name.endsWith('.ts')&&!entry.name.endsWith('.d.ts')) files.push(`src/${relative(base,path).replace(/\.ts$/,'.js').split(sep).join('/')}`);
  }
};
await walkSources();
const precache=files.filter(name => name !== 'sw.js');
await writeFile('dist/sw-manifest.json', JSON.stringify({files:precache}, null, 2) + '\n');
// The service worker is served byte-for-byte from public/, so a release that only
// changes file contents would never trip the browser's update check. Stamping a hash
// of the precached files into the worker changes its bytes whenever the shell
// changes, which installs a fresh cache and prunes the previous one.
const build=createHash('sha256');
for (const name of [...precache].sort()) {
  build.update(name).update('\0');
  build.update(await readFile(resolve('dist', name)).catch(() => Buffer.alloc(0)));
}
const buildId=build.digest('hex').slice(0, 16);
const workerPath=resolve('dist', 'sw.js');
await writeFile(workerPath, (await readFile(workerPath, 'utf8')).replaceAll('__SIMRUN_BUILD__', buildId));
console.log(`Static application built in dist/ with ${precache.length} precached files.`);
console.log(`Service worker build id ${buildId}.`);

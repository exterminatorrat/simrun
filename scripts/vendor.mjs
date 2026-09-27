import {mkdir,writeFile} from 'node:fs/promises';
const version='5.6.1',base=`https://unpkg.com/maplibre-gl@${version}/`;
await mkdir('public/vendor',{recursive:true});
for(const [remote,local] of [['dist/maplibre-gl.js','maplibre-gl.js'],['dist/maplibre-gl.css','maplibre-gl.css'],['LICENSE.txt','maplibre-LICENSE.txt']]){
 const response=await fetch(base+remote,{signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error(`MapLibre download failed (${response.status}): ${remote}`);
 const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length<100)throw Error('Unexpectedly small vendor response.');
 await writeFile('public/vendor/'+local,bytes);
}
// Switch only after all assets AND their license have been downloaded successfully.
await writeFile('public/vendor-status.json',JSON.stringify({bundled:true,maplibreVersion:version},null,2)+'\n');
console.log('MapLibre JS/CSS/license vendored. Rebuild, test and commit before repackaging.');

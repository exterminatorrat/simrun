import {readdir,lstat,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,sep} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),args=process.argv.slice(2),arg=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
const packageInfo=JSON.parse(await readFile('package.json','utf8'));
let commit=arg('--commit')||null,branch='main';
try{const status=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']});if(status.trim())throw Error('DIRTY');commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();branch=execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim()||'detached';}catch(error){if(error.message==='DIRTY')throw Error('Commit the verified source before packaging. The checkout is dirty.');}
if(commit&&!/^[a-f0-9]{40}$/.test(commit))throw Error('Provide a complete verified 40-character Git SHA.');
const date=process.env.SOURCE_DATE_EPOCH?new Date(Number(process.env.SOURCE_DATE_EPOCH)*1000):new Date();if(!Number.isFinite(date.getTime()))throw Error('Invalid SOURCE_DATE_EPOCH.');
const roots=['README.md','site-manifest.json','BUILD_INFO.json','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','tsconfig.json','.gitignore','src','public','scripts','tests','docs','.github'];
const forbidden=new Set(['node_modules','.git','dist','prebuilt','.cache','__pycache__','.DS_Store','verification','test-results','playwright-report','.handoff']);
const files=new Map();
async function walk(path){const st=await lstat(path);if(st.isSymbolicLink())throw Error('Symlinks are not allowed in a portable source archive.');const name=relative(root,path).split(sep).join('/');if(name.split('/').some(p=>forbidden.has(p))||/\.(zip|log|pyc)$/.test(name)||/(^|\/)\.env(?:\.|$)/.test(name))return;if(st.isDirectory()){for(const n of(await readdir(path)).sort())await walk(resolve(path,n));}else{const body=await readFile(path);if(body.length>5000000)throw Error('Unexpectedly large source asset: '+name);const text=body.toString('utf8');if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bAKIA[A-Z0-9]{16}\b|\bsk-proj-[A-Za-z0-9_-]{30,}/.test(text))throw Error('Potential credential in '+name);files.set(name,body);}}
for(const p of roots){try{await walk(resolve(root,p));}catch(e){if(e.code==='ENOENT'&&p==='.github')continue;throw e;}}
for(const p of ['package.json','package-lock.json','README.md','site-manifest.json','src/main.ts','public/index.html','public/app.css','public/mark.jpg'])if(!files.has(p))throw Error('Missing essential file: '+p);
const lock=JSON.parse(files.get('package-lock.json'));if(lock.packages?.['node_modules/typescript']?.version!==packageInfo.devDependencies.typescript)throw Error('Compiler and lockfile disagree.');
const info={productName:'SimRun',archiveCreatedAt:date.toISOString(),gitCommitSha:commit,gitBranch:branch,packageVersion:packageInfo.version,handoffFormatVersion:1,metadataNote:'Git SHA identifies synchronized source; this file is generated archive metadata.',verification:{sitesPreview:false,liveProviders:false,see:'docs/VERIFICATION.md'}};
files.set('BUILD_INFO.json',Buffer.from(JSON.stringify(info,null,2)+'\n'));
const hashes=Object.fromEntries([...files].sort(([a],[b])=>a.localeCompare(b)).map(([n,b])=>[n,createHash('sha256').update(b).digest('hex')]));files.set('SOURCE_HASHES.json',Buffer.from(JSON.stringify({algorithm:'sha256',files:hashes},null,2)+'\n'));
// Small standards-compliant ZIP writer: no executable packaging dependency.
const table=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=b=>{let c=0xffffffff;for(const v of b)c=table[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
let offset=0;const records=[],central=[];
for(const [path,body] of [...files].sort(([a],[b])=>a.localeCompare(b))){const name=Buffer.from('simrun/'+path),compressed=deflateRawSync(body,{level:9}),crc=crc32(body);const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);records.push(local,name,compressed);const cd=Buffer.alloc(46);cd.writeUInt32LE(0x02014b50,0);cd.writeUInt16LE(20,4);cd.writeUInt16LE(20,6);cd.writeUInt16LE(0x800,8);cd.writeUInt16LE(8,10);cd.writeUInt16LE(33,14);cd.writeUInt32LE(crc,16);cd.writeUInt32LE(compressed.length,20);cd.writeUInt32LE(body.length,24);cd.writeUInt16LE(name.length,28);cd.writeUInt32LE(offset,42);central.push(cd,name);offset+=local.length+name.length+compressed.length;}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);const zip=Buffer.concat([...records,directory,end]);const output=resolve(arg('--output')||'simrun-sites-handoff.zip');await writeFile(output,zip);console.log(`${output}\n${files.size} files; ${zip.length} bytes; source commit ${commit||'unavailable'}\nSHA-256 ${createHash('sha256').update(zip).digest('hex')}`);

import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {spawnSync} from 'node:child_process';
if (spawnSync('npm', ['run','build'], {stdio:'inherit', shell:process.platform === 'win32'}).status) process.exit(1);
const root=resolve('dist');
const args=process.argv.slice(2);
const value=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
const port=Number(value('--port',process.env.PORT || 5173));
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.json':'application/json','.png':'image/png','.jpg':'image/jpeg'};
http.createServer(async (req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
    let file=resolve(root,'.'+pathname);
    if(file!==root && !file.startsWith(root+sep)) {res.writeHead(403).end();return;}
    if((await stat(file)).isDirectory()) file=resolve(file,'index.html');
    const body=await readFile(file);
    res.writeHead(200, {'Content-Type':types[extname(file)]||'application/octet-stream','Referrer-Policy':'strict-origin-when-cross-origin','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'}).end(body);
  } catch {res.writeHead(404,{'Content-Type':'text/plain'}).end('Not found');}
}).listen(port,value('--host','0.0.0.0'),()=>console.log(`SimRun: http://localhost:${port}`));

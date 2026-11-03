import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeUrl,parseCookies,cookie,clearCookie,upload,pollUpload,redirectUri,cookies,deauthorize} from '../api/_strava.js';
import configHandler from '../api/strava/config.js';
import loginHandler from '../api/strava/login.js';
import logoutHandler from '../api/strava/logout.js';
import uploadHandler from '../api/strava/upload.js';

const withEnv=async(fn)=>{const before={id:process.env.STRAVA_CLIENT_ID,secret:process.env.STRAVA_CLIENT_SECRET};process.env.STRAVA_CLIENT_ID='42';process.env.STRAVA_CLIENT_SECRET='shh';try{return await fn();}finally{process.env.STRAVA_CLIENT_ID=before.id;process.env.STRAVA_CLIENT_SECRET=before.secret;if(before.id===undefined)delete process.env.STRAVA_CLIENT_ID;if(before.secret===undefined)delete process.env.STRAVA_CLIENT_SECRET;}};
const withoutEnv=async(fn)=>{const before={id:process.env.STRAVA_CLIENT_ID,secret:process.env.STRAVA_CLIENT_SECRET};delete process.env.STRAVA_CLIENT_ID;delete process.env.STRAVA_CLIENT_SECRET;try{return await fn();}finally{if(before.id!==undefined)process.env.STRAVA_CLIENT_ID=before.id;if(before.secret!==undefined)process.env.STRAVA_CLIENT_SECRET=before.secret;}};
function request({method='GET',url='/api/strava/upload',headers={},body}={}){
 const chunks=body?[body]:[];
 return {method,url,headers,async *[Symbol.asyncIterator](){for(const chunk of chunks)yield chunk;}};
}
function response(){
 const out={statusCode:0,headers:{},body:'',setHeader(key,value){out.headers[key.toLowerCase()]=value;},getHeader(key){return out.headers[key.toLowerCase()];},end(value=''){out.body=value;}};
 return out;
}
const payload=res=>JSON.parse(res.body||'{}');

test('the authorize URL requests write scope with state and redirect',()=>{
 const url=new URL(authorizeUrl({id:'42'},'abc','https://simrun.test/api/strava/callback'));
 assert.equal(url.origin+url.pathname,'https://www.strava.com/oauth/authorize');
 assert.equal(url.searchParams.get('client_id'),'42');
 assert.equal(url.searchParams.get('scope'),'activity:write');
 assert.equal(url.searchParams.get('state'),'abc');
 assert.equal(url.searchParams.get('redirect_uri'),'https://simrun.test/api/strava/callback');
});

test('session cookies are HttpOnly, Secure and same-site',()=>{
 const value=cookie('simrun_strava_access','token',60);
 assert.match(value,/HttpOnly=true/);
 assert.match(value,/Secure/);
 assert.match(value,/SameSite=Lax/);
 assert.match(value,/Path=\/api\/strava/);
 assert.match(clearCookie('simrun_strava_access'),/Max-Age=0/);
});

test('cookie parsing ignores malformed pairs',()=>{
 assert.deepEqual(parseCookies('a=1; broken; b=two%20words'),{a:'1',b:'two words'});
 assert.deepEqual(parseCookies(''),{});
});

test('the redirect URI prefers https and an explicit override',()=>{
 assert.equal(redirectUri({headers:{host:'simrun.test'}}),'https://simrun.test/api/strava/callback');
 assert.equal(redirectUri({headers:{'x-forwarded-host':'public.example'}}),'https://public.example/api/strava/callback');
});

test('configuration is reported without a secret when the deployment lacks credentials',async()=>{
 await withoutEnv(async()=>{
  const res=response();
  configHandler(request(),res);
  assert.deepEqual(payload(res),{configured:false,connected:false});
 });
 await withEnv(async()=>{
  const res=response();
  configHandler(request({headers:{cookie:`${cookies().refresh}=refresh-token`}}),res);
  assert.deepEqual(payload(res),{configured:true,connected:true});
 });
});

test('sign-in redirects to Strava and refuses when unconfigured',async()=>{
 await withoutEnv(async()=>{
  const res=response();
  loginHandler(request(),res);
  assert.equal(res.statusCode,503);
 });
 await withEnv(async()=>{
  const res=response();
  loginHandler(request({headers:{host:'simrun.test'}}),res);
  assert.equal(res.statusCode,302);
  assert.match(res.headers.location,/strava\.com\/oauth\/authorize/);
  assert.match(String(res.headers['set-cookie']),/simrun_strava_state=/);
 });
});

test('sign-out revokes the Strava grant and clears both token cookies',async()=>{
 const seen=[];
 const original=globalThis.fetch;
 globalThis.fetch=async (input,init)=>{seen.push({url:String(input),init});return new Response('{}',{status:200});};
 try{
  const res=response();
  await logoutHandler(request({headers:{cookie:`${cookies().access}=token`}}),res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(payload(res),{connected:false,revoked:true});
  assert.equal(res.headers['set-cookie'].length,2);
  assert.equal(seen[0].url,'https://www.strava.com/oauth/deauthorize');
  assert.equal(seen[0].init.headers.Authorization,'Bearer token');
 }finally{globalThis.fetch=original;}
});

test('sign-out still clears cookies when revocation fails',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('network down');};
 try{
  const res=response();
  await logoutHandler(request({headers:{cookie:`${cookies().access}=token`}}),res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(payload(res),{connected:false,revoked:false});
  assert.equal(res.headers['set-cookie'].length,2);
  assert.equal(await deauthorize('t',globalThis.fetch),false);
 }finally{globalThis.fetch=original;}
});

test('sign-out without a token does not call Strava',async()=>{
 const original=globalThis.fetch;
 let called=false;
 globalThis.fetch=async()=>{called=true;return new Response('{}',{status:200});};
 try{
  const res=response();
  await logoutHandler(request(),res);
  assert.equal(res.statusCode,200);
  assert.deepEqual(payload(res),{connected:false,revoked:false});
  assert.equal(called,false);
 }finally{globalThis.fetch=original;}
});

test('upload rejects missing configuration, bad types and missing authorization',async()=>{
 await withoutEnv(async()=>{
  const res=response();
  await uploadHandler(request({method:'POST',headers:{'x-data-type':'fit'}}),res);
  assert.equal(res.statusCode,503);
 });
 await withEnv(async()=>{
  const res=response();
  await uploadHandler(request({method:'POST',headers:{'x-data-type':'zip'}}),res);
  assert.equal(res.statusCode,400);
  const unauthorised=response();
  await uploadHandler(request({method:'POST',headers:{'x-data-type':'fit'}}),unauthorised);
  assert.equal(unauthorised.statusCode,401);
 });
});

test('upload posts the file to Strava and returns the activity id',async()=>{
 await withEnv(async()=>{
  const seen=[];
  const original=globalThis.fetch;
  globalThis.fetch=async (input,init)=>{
   seen.push({url:String(input),init});
   if(String(input).endsWith('/uploads'))return new Response(JSON.stringify({id:7,status:'Your activity is still being processed.'}),{status:201});
   return new Response(JSON.stringify({id:7,activity_id:12345}),{status:200});
  };
  try{
   const res=response();
   await uploadHandler(request({method:'POST',headers:{cookie:`${cookies().access}=token`,'x-data-type':'fit','x-file-name':'run.fit'},body:Buffer.from('binary')}),res);
   assert.equal(res.statusCode,200);
   assert.deepEqual(payload(res),{activityId:12345});
   assert.equal(seen[0].url,'https://www.strava.com/api/v3/uploads');
   assert.equal(seen[0].init.headers.Authorization,'Bearer token');
   assert.ok(seen[0].init.body instanceof FormData);
  }finally{globalThis.fetch=original;}
 });
});

test('a rejected upload surfaces the Strava message',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({errors:[{message:'Duplicate of activity 9'}]}),{status:400});
 try{
  await assert.rejects(()=>upload({token:'t',body:Buffer.from('x'),filename:'a.fit',dataType:'fit'}),/Duplicate of activity 9/);
 }finally{globalThis.fetch=original;}
});

test('polling returns a pending result when Strava keeps processing',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({id:7,status:'processing'}),{status:200});
 try{
  assert.deepEqual(await pollUpload('t',7,globalThis.fetch,2,0),{pending:true});
 }finally{globalThis.fetch=original;}
});

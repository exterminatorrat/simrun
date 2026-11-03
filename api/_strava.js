const AUTHORIZE='https://www.strava.com/oauth/authorize';
const TOKEN='https://www.strava.com/oauth/token';
const UPLOADS='https://www.strava.com/api/v3/uploads';
const ACCESS_COOKIE='simrun_strava_access';
const REFRESH_COOKIE='simrun_strava_refresh';
const STATE_COOKIE='simrun_strava_state';
const COOKIE_PATH='/api/strava';
export const DATA_TYPES=new Set(['fit','tcx','gpx']);
export const credentials=()=>{
  const id=process.env.STRAVA_CLIENT_ID,secret=process.env.STRAVA_CLIENT_SECRET;
  return id&&secret?{id,secret}:null;
};
export function parseCookies(header=''){
  const out={};
  for(const part of String(header).split(';')){
    const index=part.indexOf('=');
    if(index<0)continue;
    out[part.slice(0,index).trim()]=decodeURIComponent(part.slice(index+1).trim());
  }
  return out;
}
export function cookie(name,value,maxAge,{path=COOKIE_PATH,httpOnly=true}={}){
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly=${httpOnly}; Secure; SameSite=Lax`;
}
export function clearCookie(name){
  return `${name}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly=true; Secure; SameSite=Lax`;
}
export const accessCookie=token=>cookie(ACCESS_COOKIE,token,6*60*60);
export const refreshCookie=token=>cookie(REFRESH_COOKIE,token,90*24*60*60);
export const stateCookie=state=>cookie(STATE_COOKIE,state,10*60);
export const clearAuthCookies=()=>[clearCookie(ACCESS_COOKIE),clearCookie(REFRESH_COOKIE)];
export const cookies=()=>({access:ACCESS_COOKIE,refresh:REFRESH_COOKIE,state:STATE_COOKIE});
export function redirectUri(request){
  if(process.env.STRAVA_REDIRECT_URI)return process.env.STRAVA_REDIRECT_URI;
  const host=request.headers['x-forwarded-host']||request.headers.host;
  return `https://${host}/api/strava/callback`;
}
export function authorizeUrl({id},state,redirect){
  const params=new URLSearchParams({client_id:id,response_type:'code',redirect_uri:redirect,approval_prompt:'auto',scope:'activity:write',state});
  return `${AUTHORIZE}?${params}`;
}
export async function exchangeToken({id,secret},body){
  const response=await fetch(TOKEN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:id,client_secret:secret,...body})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.access_token)throw Error(data.message||'Strava rejected the token request.');
  return data;
}
export async function accessToken(req,res){
  const jar=parseCookies(req.headers.cookie);
  if(jar[ACCESS_COOKIE])return jar[ACCESS_COOKIE];
  if(!jar[REFRESH_COOKIE])return null;
  const config=credentials();
  if(!config)return null;
  const data=await exchangeToken(config,{grant_type:'refresh_token',refresh_token:jar[REFRESH_COOKIE]});
  res.setHeader('Set-Cookie',[accessCookie(data.access_token),refreshCookie(data.refresh_token),...(res.getHeader('Set-Cookie')||[])]);
  return data.access_token;
}
export async function upload({token,body,filename,dataType,name,description},fetchImpl=fetch){
  const form=new FormData();
  form.append('file',new Blob([body]),filename);
  form.append('data_type',dataType);
  if(name)form.append('name',name);
  if(description)form.append('description',description);
  const response=await fetchImpl(UPLOADS,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.errors?.[0]?.message||data.message||'Strava refused the upload.');
  return data;
}
export async function pollUpload(token,id,fetchImpl=fetch,attempts=4,delayMs=1200){
  for(let attempt=0;attempt<attempts;attempt++){
    await new Promise(resolve=>setTimeout(resolve,delayMs));
    const response=await fetchImpl(`${UPLOADS}/${id}`,{headers:{Authorization:`Bearer ${token}`}});
    const data=await response.json().catch(()=>({}));
    if(data.activity_id)return {activityId:data.activity_id};
    if(data.error)throw Error(data.error);
  }
  return {pending:true};
}
export function json(res,status,payload){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(payload));
}

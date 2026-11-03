import {accessCookie,clearCookie,credentials,exchangeToken,json,parseCookies,refreshCookie,redirectUri,cookies} from '../_strava.js';
export default async function handler(req,res){
  const config=credentials();
  const url=new URL(req.url,`https://${req.headers['x-forwarded-host']||req.headers.host||'localhost'}`);
  const jar=parseCookies(req.headers.cookie);
  const state=url.searchParams.get('state');
  if(!config)return json(res,503,{error:'Strava upload is not configured on this deployment.'});
  if(url.searchParams.get('error'))return redirect(res,'/?strava=denied');
  if(!state||state!==jar[cookies().state])return json(res,400,{error:'The Strava sign-in attempt expired. Start it again from the Send dialog.'});
  try{
    const data=await exchangeToken(config,{grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:redirectUri(req)});
    res.setHeader('Set-Cookie',[accessCookie(data.access_token),refreshCookie(data.refresh_token),clearCookie(cookies().state)]);
    return redirect(res,'/?strava=connected');
  }catch(error){
    return redirect(res,`/?strava=error&message=${encodeURIComponent(error.message)}`);
  }
}
function redirect(res,location){
  res.statusCode=302;
  res.setHeader('Location',location);
  res.end();
}

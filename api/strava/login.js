import {randomBytes} from 'node:crypto';
import {authorizeUrl,credentials,json,redirectUri,stateCookie} from '../_strava.js';
export default function handler(req,res){
  const config=credentials();
  if(!config)return json(res,503,{error:'Strava upload is not configured on this deployment.'});
  const state=randomBytes(16).toString('hex');
  res.statusCode=302;
  res.setHeader('Set-Cookie',stateCookie(state));
  res.setHeader('Location',authorizeUrl(config,state,redirectUri(req)));
  res.end();
}

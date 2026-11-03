import {credentials,parseCookies,cookies} from '../_strava.js';
export default function handler(req,res){
  const jar=parseCookies(req.headers.cookie);
  res.statusCode=200;
  res.setHeader('Content-Type','application/json');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify({configured:Boolean(credentials()),connected:Boolean(jar[cookies().refresh])}));
}

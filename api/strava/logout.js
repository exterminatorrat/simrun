import {clearAuthCookies,cookies,deauthorize,json,parseCookies} from '../_strava.js';
export default async function handler(req,res){
  const token=parseCookies(req.headers.cookie)[cookies().access];
  const revoked=token?await deauthorize(token):false;
  res.setHeader('Set-Cookie',clearAuthCookies());
  json(res,200,{connected:false,revoked});
}

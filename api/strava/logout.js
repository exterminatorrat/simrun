import {clearAuthCookies,json} from '../_strava.js';
export default function handler(req,res){
  res.setHeader('Set-Cookie',clearAuthCookies());
  json(res,200,{connected:false});
}

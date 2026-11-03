import {accessToken,credentials,DATA_TYPES,json,pollUpload,upload} from '../_strava.js';
export const config={api:{bodyParser:false}};
export default async function handler(req,res){
  if(req.method!=='POST')return json(res,405,{error:'Use POST to upload an activity file.'});
  if(!credentials())return json(res,503,{error:'Strava upload is not configured on this deployment.'});
  const params=new URL(req.url,`https://${req.headers.host||'localhost'}`).searchParams;
  const dataType=String(params.get('type')||'').toLowerCase();
  const filename=params.get('file')||`simulated.${dataType}`;
  if(!DATA_TYPES.has(dataType))return json(res,400,{error:'Send a FIT, TCX or GPX file.'});
  const token=await accessToken(req,res).catch(()=>null);
  if(!token)return json(res,401,{error:'Connect Strava before uploading.'});
  const body=await readBody(req);
  if(!body.length)return json(res,400,{error:'The activity file was empty.'});
  try{
    const started=await upload({token,body,filename,dataType,name:params.get('name')||undefined,description:params.get('description')||undefined});
    if(started.activity_id)return json(res,200,{activityId:started.activity_id});
    if(started.error)return json(res,502,{error:started.error});
    const result=await pollUpload(token,started.id);
    return json(res,200,result);
  }catch(error){
    return json(res,502,{error:error.message||'Strava refused the upload.'});
  }
}
async function readBody(req){
  if(Buffer.isBuffer(req.body))return req.body;
  const chunks=[];
  for await (const chunk of req)chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

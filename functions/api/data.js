import { getSession, json } from './_session.js';
const API='https://api.github.com';
const headers=env=>({Authorization:'Bearer '+env.GITHUB_DATA_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Spendwise'});
const repo=env=>env.GITHUB_DATA_REPO||'vishwashyadav/spendwise-data';
const path='data/spendwise.json';
export async function onRequestGet({request,env}) {
  const user=await getSession(request,env); if(!user)return json({error:'Unauthorized'},401);
  const r=await fetch(API+'/repos/'+repo(env)+'/contents/'+path,{headers:headers(env)});
  if(!r.ok)return json({error:'Could not read private data repository.',details:await r.text()},r.status);
  const file=await r.json(); const bytes=Uint8Array.from(atob(file.content.replace(/\n/g,'')),c=>c.charCodeAt(0));
  const data=JSON.parse(new TextDecoder().decode(bytes));
  return json({user:{login:user.login},data,sha:file.sha});
}
export async function onRequestPut({request,env}) {
  const user=await getSession(request,env); if(!user)return json({error:'Unauthorized'},401);
  let data; try{data=await request.json();}catch{return json({error:'Invalid JSON body'},400);}
  if(!data||!Array.isArray(data.transactions)||typeof data.rules!=='object')return json({error:'Invalid Spendwise data format'},400);
  if(data.transactions.length>20000)return json({error:'Transaction limit exceeded'},413);
  const url=API+'/repos/'+repo(env)+'/contents/'+path;
  const current=await fetch(url,{headers:headers(env)});
  if(!current.ok)return json({error:'Could not read current data version.'},current.status);
  const existing=await current.json();
  const bytes=new TextEncoder().encode(JSON.stringify({...data,schemaVersion:1},null,2));
  let binary=''; for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  const content=btoa(binary);
  const saved=await fetch(url,{method:'PUT',headers:{...headers(env),'Content-Type':'application/json'},body:JSON.stringify({message:'Update Spendwise personal expenditure data',content,sha:existing.sha})});
  if(!saved.ok)return json({error:'GitHub could not save your data.',details:await saved.text()},saved.status);
  const result=await saved.json();
  return json({ok:true,sha:result.content?.sha});
}
import { getSession, json } from './_session.js';
export async function onRequestGet({request,env}) {
  const user=await getSession(request,env);
  return user?json({user:{login:user.login,name:user.name,avatar:user.avatar}}):json({error:'Unauthorized'},401);
}
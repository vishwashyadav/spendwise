async function seal(value, secret) {
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, new TextEncoder().encode(JSON.stringify(value)));
  const bytes = new Uint8Array(iv.length + encrypted.byteLength); bytes.set(iv); bytes.set(new Uint8Array(encrypted),iv.length);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export async function onRequest({ request, env }) {
  const origin = new URL(request.url).origin;
  const url = new URL(request.url), code = url.searchParams.get('code'), state = url.searchParams.get('state');
  const savedState = (request.headers.get('Cookie') || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('sw_oauth_state='))?.slice('sw_oauth_state='.length);
  const clearState = 'sw_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
  if (!code || !state || !savedState || state !== savedState) return new Response('Invalid OAuth state. Please try signing in again.',{status:400,headers:{'Set-Cookie':clearState}});
  const tokenRes = await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code})});
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return new Response('GitHub sign-in failed.',{status:401,headers:{'Set-Cookie':clearState}});
  const userRes = await fetch('https://api.github.com/user',{headers:{Authorization:'Bearer '+tokenData.access_token,Accept:'application/vnd.github+json','User-Agent':'Spendwise'}});
  const user = await userRes.json();
  if (!user.login || user.login.toLowerCase() !== (env.GITHUB_ALLOWED_USER || 'vishwashyadav').toLowerCase()) return new Response('This GitHub account is not authorized to use this Spendwise instance.',{status:403,headers:{'Set-Cookie':clearState}});
  const session = await seal({login:user.login,name:user.name||user.login,avatar:user.avatar_url,expires:Date.now()+7*24*60*60*1000},env.SESSION_SECRET);
  const headers = new Headers({Location:origin+'/'});
  headers.append('Set-Cookie',clearState);
  headers.append('Set-Cookie','spendwise_session='+session+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800');
  return new Response(null,{status:302,headers});
}
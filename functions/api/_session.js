export async function getSession(request, env) {
  const raw=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('spendwise_session='))?.slice('spendwise_session='.length);
  if(!raw)return null;
  try {
    const base=raw.replace(/-/g,'+').replace(/_/g,'/'); const bytes=Uint8Array.from(atob(base+'='.repeat((4-base.length%4)%4)),c=>c.charCodeAt(0));
    const iv=bytes.slice(0,12), payload=bytes.slice(12);
    const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.SESSION_SECRET)),'AES-GCM',false,['decrypt']);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,payload);
    const session=JSON.parse(new TextDecoder().decode(plain));
    return session.expires>Date.now()?session:null;
  } catch { return null; }
}
export const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function onRequestPost() {
  return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Set-Cookie':'spendwise_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});
}
export async function onRequest({ request, env }) {
  const origin = new URL(request.url).origin;
  const state = crypto.randomUUID();
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', origin + '/api/auth/callback');
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { Location: url.toString(), 'Set-Cookie': 'sw_oauth_state=' + state + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600' } });
}
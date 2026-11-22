// POST { email, code } -> { ok: true, resetToken } | { error }
//
// If the code matches, deletes it (one-time use) and issues a short-lived
// reset token the client must present to actually set a new password.
const RESET_TOKEN_TTL_SECONDS = 600; // 10 minutes

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid request' }, 400);
  }

  const email = String(body.email || '').trim().toLowerCase();
  const code = String(body.code || '').trim();
  if (!email || !code) return json({ error: 'Email and code required' }, 400);

  const raw = await env.LEADCLEAN_KV.get('otp:' + email);
  if (!raw) return json({ error: 'Code expired or not found. Request a new one.' }, 400);

  const stored = JSON.parse(raw);
  if (stored.code !== code) return json({ error: 'Incorrect code.' }, 400);

  await env.LEADCLEAN_KV.delete('otp:' + email);

  const token = crypto.randomUUID();
  await env.LEADCLEAN_KV.put('reset_token:' + token, email, { expirationTtl: RESET_TOKEN_TTL_SECONDS });

  return json({ ok: true, resetToken: token });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

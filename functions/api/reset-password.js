// POST { resetToken, newPassword } -> { ok: true, message } | { error }
//
// Sets the new admin password (salted SHA-256, stored as "salt:hash" in
// LEADCLEAN_KV under "admin_password"), only if resetToken is a valid,
// unexpired token issued by verify-otp.js.
export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid request' }, 400);
  }

  const resetToken = String(body.resetToken || '').trim();
  const newPassword = String(body.newPassword || '');
  if (!resetToken || !newPassword) return json({ error: 'Missing fields' }, 400);
  if (newPassword.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);

  const email = await env.LEADCLEAN_KV.get('reset_token:' + resetToken);
  if (!email) return json({ error: 'This reset link has expired. Start again.' }, 400);

  const salt = crypto.randomUUID().replace(/-/g, '');
  const hash = await sha256Hex(salt + newPassword);
  await env.LEADCLEAN_KV.put('admin_password', salt + ':' + hash);
  await env.LEADCLEAN_KV.delete('reset_token:' + resetToken);

  return json({ ok: true, message: 'Password updated. You can sign in now.' });
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

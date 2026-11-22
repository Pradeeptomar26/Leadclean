// POST { mobile, password } -> { ok: boolean }
//
// Verifies against credentials stored in the LEADCLEAN_KV namespace,
// falling back to the original hardcoded defaults the very first time
// (before any password reset has ever run), so login keeps working right
// after this is deployed without any manual KV setup.
const DEFAULT_MOBILE = '8920046480';
const DEFAULT_PASSWORD = 'Yash@0531066';

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Invalid request' }, 400);
  }

  const mobile = String(body.mobile || '').replace(/\D/g, '');
  const password = String(body.password || '');

  const storedMobile = (await env.LEADCLEAN_KV.get('admin_mobile')) || DEFAULT_MOBILE;
  if (mobile !== storedMobile) {
    return json({ ok: false });
  }

  const storedPasswordEntry = await env.LEADCLEAN_KV.get('admin_password');
  let valid;
  if (storedPasswordEntry) {
    const [salt, hash] = storedPasswordEntry.split(':');
    const check = await sha256Hex(salt + password);
    valid = check === hash;
  } else {
    valid = password === DEFAULT_PASSWORD;
  }

  return json({ ok: valid });
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

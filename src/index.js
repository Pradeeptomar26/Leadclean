const DEFAULT_MOBILE = '8920046480';
const DEFAULT_PASSWORD = 'Yash@0531066';
const DEFAULT_ADMIN_EMAIL = 'pradeeptomar0826@gmail.com';
const OTP_TTL_SECONDS = 600; // 10 minutes
const RESET_TOKEN_TTL_SECONDS = 600; // 10 minutes

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/login') {
      return handleLogin(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/forgot-password') {
      return handleForgotPassword(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/verify-otp') {
      return handleVerifyOtp(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/reset-password') {
      return handleResetPassword(request, env);
    }

    // Anything else: serve the static site from public/.
    return env.ASSETS.fetch(request);
  },
};

// ---- POST /api/login -> { ok: boolean } ----
async function handleLogin(request, env) {
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

// ---- POST /api/forgot-password { email } -> { ok: true, message } ----
async function handleForgotPassword(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid request' }, 400);
  }

  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return json({ error: 'Email required' }, 400);

  const adminEmail = ((await env.LEADCLEAN_KV.get('admin_email')) || DEFAULT_ADMIN_EMAIL).toLowerCase();

  if (email === adminEmail) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await env.LEADCLEAN_KV.put(
      'otp:' + email,
      JSON.stringify({ code, createdAt: Date.now() }),
      { expirationTtl: OTP_TTL_SECONDS }
    );

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'LeadClean <onboarding@resend.dev>',
        to: [adminEmail],
        subject: 'Your LeadClean password reset code',
        html:
          '<p>Your one-time code is:</p>' +
          '<h2 style="letter-spacing:4px;font-family:monospace">' + code + '</h2>' +
          '<p>This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>',
      }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      return json({ error: 'Could not send the email right now.', detail }, 502);
    }
  }

  return json({ ok: true, message: 'If this email is registered, a code has been sent.' });
}

// ---- POST /api/verify-otp { email, code } -> { ok: true, resetToken } ----
async function handleVerifyOtp(request, env) {
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

// ---- POST /api/reset-password { resetToken, newPassword } -> { ok: true, message } ----
async function handleResetPassword(request, env) {
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

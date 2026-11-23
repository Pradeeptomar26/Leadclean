// Single Worker entry point for the LeadClean site.
//
// Called by: Cloudflare's `wrangler` runtime itself, via the "main" field
// in wrangler.jsonc (to be created next in this same task) — Cloudflare
// invokes this module's default-exported `fetch` handler for every
// incoming request to the deployed Worker. No other file in this repo
// calls it; it is the Worker's entry point, not a library module.
//
// Why a new file instead of reusing functions/api/*.js: this Cloudflare
// project is deployed as a plain Worker with static assets (via
// `wrangler deploy`), confirmed by today's build log, which shows
// Wrangler auto-generating a wrangler.jsonc with only an "assets"
// block and deploying just the 2 static files — the functions/api/*.js
// files (Cloudflare Pages Functions, a different product's file-based
// routing convention) were never invoked. Consolidating their logic
// into one Worker script with manual routing is the fix this specific
// deployment type requires; functions/api/*.js will be deleted once
// this is confirmed working, per the user's explicit request to get
// the forgot-password backend ("bna do ye mera mail hai
// pradeeptomar0826@gmail.com") actually live on their deployed site.
//
// Data read/written (unchanged from the functions/api/*.js versions, plus
// the team-login additions below):
//   KV (env.LEADCLEAN_KV): "admin_mobile" (string), "admin_password"
//   ("salt:sha256hash" string), "admin_email" (string), "otp:<email>"
//   (JSON {code, createdAt}, 10-min TTL), "reset_token:<uuid>" (string
//   = email, 10-min TTL).
//   "team_user:<mobile>" (JSON {passwordSalt, passwordHash, addedAt}) --
//   one entry per teammate added via the in-app "Manage team" panel; same
//   access as the original admin login, just a separate mobile+password.
//   "session:<token>" (string = mobile, 7-day TTL) -- issued on successful
//   /api/login, required (as "Authorization: Bearer <token>") to call the
//   team-management endpoints below, so only someone who is actually
//   logged in can add/remove teammates.
//   Secret (env.RESEND_API_KEY): used only server-side to call the
//   Resend email API.
//
// Routes:
//   POST /api/login            -> handleLogin
//   POST /api/forgot-password  -> handleForgotPassword
//   POST /api/verify-otp       -> handleVerifyOtp
//   POST /api/reset-password   -> handleResetPassword
//   POST /api/team/list        -> handleTeamList   (auth required)
//   POST /api/team/add         -> handleTeamAdd     (auth required)
//   POST /api/team/remove      -> handleTeamRemove  (auth required)
//   everything else            -> served from the "public/" static assets

const DEFAULT_MOBILE = '8920046480';
const DEFAULT_PASSWORD = 'Yash@0531066';
const DEFAULT_ADMIN_EMAIL = 'pradeeptomar0826@gmail.com';
const OTP_TTL_SECONDS = 600; // 10 minutes
const RESET_TOKEN_TTL_SECONDS = 600; // 10 minutes
const SESSION_TTL_SECONDS = 604800; // 7 days

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
    if (request.method === 'POST' && url.pathname === '/api/team/list') {
      return handleTeamList(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/team/add') {
      return handleTeamAdd(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/team/remove') {
      return handleTeamRemove(request, env);
    }

    // Anything else: serve the static site from public/.
    return env.ASSETS.fetch(request);
  },
};

// ---- POST /api/login -> { ok: boolean, token? } ----
async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Invalid request' }, 400);
  }

  const mobile = String(body.mobile || '').replace(/\D/g, '');
  const password = String(body.password || '');

  // 1) Check against the original single-admin record (unchanged logic).
  const storedMobile = (await env.LEADCLEAN_KV.get('admin_mobile')) || DEFAULT_MOBILE;
  let valid = false;
  if (mobile === storedMobile) {
    const storedPasswordEntry = await env.LEADCLEAN_KV.get('admin_password');
    if (storedPasswordEntry) {
      const [salt, hash] = storedPasswordEntry.split(':');
      valid = (await sha256Hex(salt + password)) === hash;
    } else {
      valid = password === DEFAULT_PASSWORD;
    }
  }

  // 2) If not the admin, check the team_user:<mobile> records.
  if (!valid) {
    const raw = await env.LEADCLEAN_KV.get('team_user:' + mobile);
    if (raw) {
      const rec = JSON.parse(raw);
      valid = (await sha256Hex(rec.passwordSalt + password)) === rec.passwordHash;
    }
  }

  if (!valid) return json({ ok: false });

  const token = crypto.randomUUID();
  await env.LEADCLEAN_KV.put('session:' + token, mobile, { expirationTtl: SESSION_TTL_SECONDS });

  return json({ ok: true, token });
}

// ---- Shared auth check for the team-management endpoints below ----
async function requireSession(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const mobile = await env.LEADCLEAN_KV.get('session:' + token);
  return mobile || null;
}

// ---- POST /api/team/list -> { ok: true, users: [{mobile, addedAt, isAdmin}] } ----
async function handleTeamList(request, env) {
  const mobile = await requireSession(request, env);
  if (!mobile) return json({ error: 'Please log in again.' }, 401);

  const adminMobile = (await env.LEADCLEAN_KV.get('admin_mobile')) || DEFAULT_MOBILE;
  const users = [{ mobile: adminMobile, isAdmin: true }];

  const list = await env.LEADCLEAN_KV.list({ prefix: 'team_user:' });
  for (const key of list.keys) {
    const raw = await env.LEADCLEAN_KV.get(key.name);
    if (!raw) continue;
    const rec = JSON.parse(raw);
    users.push({ mobile: key.name.slice('team_user:'.length), addedAt: rec.addedAt, isAdmin: false });
  }

  return json({ ok: true, users });
}

// ---- POST /api/team/add { mobile, password } -> { ok: true } ----
async function handleTeamAdd(request, env) {
  const requester = await requireSession(request, env);
  if (!requester) return json({ error: 'Please log in again.' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid request' }, 400);
  }

  const mobile = String(body.mobile || '').replace(/\D/g, '');
  const password = String(body.password || '');
  if (mobile.length !== 10) return json({ error: 'Enter a valid 10-digit mobile number.' }, 400);
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);

  const adminMobile = (await env.LEADCLEAN_KV.get('admin_mobile')) || DEFAULT_MOBILE;
  if (mobile === adminMobile) return json({ error: 'This number is already the admin login.' }, 400);

  const salt = crypto.randomUUID().replace(/-/g, '');
  const hash = await sha256Hex(salt + password);
  await env.LEADCLEAN_KV.put(
    'team_user:' + mobile,
    JSON.stringify({ passwordSalt: salt, passwordHash: hash, addedAt: Date.now() })
  );

  return json({ ok: true });
}

// ---- POST /api/team/remove { mobile } -> { ok: true } ----
async function handleTeamRemove(request, env) {
  const requester = await requireSession(request, env);
  if (!requester) return json({ error: 'Please log in again.' }, 401);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid request' }, 400);
  }

  const mobile = String(body.mobile || '').replace(/\D/g, '');
  if (!mobile) return json({ error: 'Missing mobile number.' }, 400);

  await env.LEADCLEAN_KV.delete('team_user:' + mobile);
  return json({ ok: true });
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

// POST { email } -> { ok: true, message }
//
// Sends a 6-digit OTP to the email address, ONLY if it matches the
// registered admin email (default: pradeeptomar0826@gmail.com, or whatever
// is stored under the KV key "admin_email"). The response is identical
// whether or not the email matched, so a stranger probing this endpoint
// can't use it to discover the real address.
const DEFAULT_ADMIN_EMAIL = 'pradeeptomar0826@gmail.com';
const OTP_TTL_SECONDS = 600; // 10 minutes

export async function onRequestPost(context) {
  const { request, env } = context;
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

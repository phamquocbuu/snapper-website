/**
 * Snapper contact form handler — Cloudflare Pages Function.
 *
 * Same-origin POST /contact from contact.html. Verifies the Cloudflare
 * Turnstile token, then forwards the message to Telegram.
 *
 * Required secrets (Pages project -> Settings -> Variables and Secrets,
 * or `wrangler pages secret put <NAME>`):
 *   TURNSTILE_SECRET     Turnstile widget secret key
 *   TELEGRAM_BOT_TOKEN   Bot token from @BotFather
 *   TELEGRAM_CHAT_ID     Chat/channel id to deliver messages to
 */

const MAX = { name: 100, email: 200, message: 5000 };

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function verifyTurnstile(token, secret, ip) {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);

  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form },
  );
  const data = await res.json();
  return data.success === true;
}

async function sendTelegram(env, { name, email, message }, meta) {
  const text =
    `<b>New Snapper contact message</b>\n\n` +
    `<b>Name:</b> ${escapeHtml(name)}\n` +
    `<b>Email:</b> ${escapeHtml(email)}\n` +
    `<b>IP:</b> ${escapeHtml(meta.ip || "unknown")}` +
    (meta.country ? ` (${escapeHtml(meta.country)})` : "") +
    `\n\n<b>Message:</b>\n${escapeHtml(message)}`;

  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
  );
  return res.ok;
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim();
  const message = String(payload.message || "").trim();
  const token = String(payload.turnstileToken || "").trim();

  if (!name || !email || !message) {
    return json({ error: "All fields are required." }, 400);
  }
  if (
    name.length > MAX.name ||
    email.length > MAX.email ||
    message.length > MAX.message
  ) {
    return json({ error: "One or more fields are too long." }, 400);
  }
  if (!isEmail(email)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }
  if (!token) {
    return json({ error: "Captcha verification is missing." }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ok = await verifyTurnstile(token, env.TURNSTILE_SECRET, ip);
  if (!ok) {
    return json({ error: "Captcha verification failed." }, 403);
  }

  const delivered = await sendTelegram(
    env,
    { name, email, message },
    { ip, country: request.cf && request.cf.country },
  );
  if (!delivered) {
    return json(
      { error: "Could not deliver your message. Please email us directly." },
      502,
    );
  }

  return json({ ok: true }, 200);
}

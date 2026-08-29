/**
 * Snapper contact form handler.
 *
 * Receives a JSON POST from the site's contact form, verifies the
 * Cloudflare Turnstile token, then forwards the message to Telegram.
 *
 * Required secrets (set with `wrangler secret put <NAME>`):
 *   TURNSTILE_SECRET     Turnstile widget secret key
 *   TELEGRAM_BOT_TOKEN   Bot token from @BotFather
 *   TELEGRAM_CHAT_ID     Chat/channel id to deliver messages to
 *
 * Optional vars (wrangler.toml [vars]):
 *   ALLOWED_ORIGIN       Exact origin allowed to call this Worker
 *                        (default: https://snapper.nexis.io.vn)
 */

const DEFAULT_ORIGIN = "https://snapper.nexis.io.vn";

const MAX = { name: 100, email: 200, message: 5000 };

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
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

export default {
  async fetch(request, env) {
    const cors = env.ALLOWED_ORIGIN || DEFAULT_ORIGIN;
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(cors) });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, cors);
    }

    if (origin && origin !== cors) {
      return json({ error: "Forbidden" }, 403, cors);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, cors);
    }

    const name = String(payload.name || "").trim();
    const email = String(payload.email || "").trim();
    const message = String(payload.message || "").trim();
    const token = String(payload.turnstileToken || "").trim();

    if (!name || !email || !message) {
      return json({ error: "All fields are required." }, 400, cors);
    }
    if (
      name.length > MAX.name ||
      email.length > MAX.email ||
      message.length > MAX.message
    ) {
      return json({ error: "One or more fields are too long." }, 400, cors);
    }
    if (!isEmail(email)) {
      return json({ error: "Please enter a valid email address." }, 400, cors);
    }
    if (!token) {
      return json({ error: "Captcha verification is missing." }, 400, cors);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const ok = await verifyTurnstile(token, env.TURNSTILE_SECRET, ip);
    if (!ok) {
      return json({ error: "Captcha verification failed." }, 403, cors);
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
        cors,
      );
    }

    return json({ ok: true }, 200, cors);
  },
};

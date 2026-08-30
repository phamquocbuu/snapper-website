/**
 * Paddle webhook -> license provisioning. Cloudflare Pages Function.
 *
 * POST /api/paddle-webhook  (set this as the notification destination URL
 * in Paddle > Developer tools > Notifications).
 *
 * On `transaction.completed` it maps each purchased price to an
 * entitlement and writes a row to the `licenses` D1 table so /activate can
 * later hand out receipts. Renewal prices widen an existing key instead of
 * issuing a new one.
 *
 * Key delivery (the email to the buyer) is handled by Paddle's built-in
 * license-key / receipt email - this function does not send email. If
 * Paddle supplies a key (via `custom_data.license_key` on the
 * transaction), it is recorded verbatim; otherwise a `SNAP-...` key is
 * generated so the row is never keyless.
 *
 * Retry semantics: Paddle treats only a 2xx as delivered and retries
 * anything else with the same `event_id`. So we return 500 on any failure
 * (including a bad signature - a rotated-but-not-redeployed secret then
 * recovers on the next retry) and dedupe on `event_id`.
 *
 * Bindings / vars (Pages project -> Settings):
 *   LICENSE_DB               D1 binding (see wrangler.toml / schema.sql)
 *   PADDLE_WEBHOOK_SECRET    secret, pdl_ntfset_...  (this destination's key)
 *   PADDLE_PRICE_PRO_FIRST / PADDLE_PRICE_PRO_RENEWAL / PADDLE_PRICE_LIFETIME
 */

import {
  json,
  nowSeconds,
  paddleApiBase,
  entitlementForPrice,
  widenBand,
} from "./_lib/license.js";

/** Constant-time-ish hex compare. */
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bytesToHex(bytes) {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

/**
 * Verify the `Paddle-Signature` header ("ts=<unix>;h1=<hex hmac>") against
 * the raw body. The signed material is `<ts>:<rawBody>`, HMAC-SHA256 with
 * the destination secret used as the raw key.
 */
async function verifyPaddleSignature(header, rawBody, secret) {
  if (!header || !secret) return false;

  const parts = Object.fromEntries(
    header.split(";").map((kv) => {
      const idx = kv.indexOf("=");
      return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
    }),
  );
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) return false;

  // Reject stale signatures (>5 min) to blunt replay.
  if (Math.abs(nowSeconds() - Number(ts)) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}:${rawBody}`)),
  );
  return timingSafeEqualHex(bytesToHex(mac), h1.toLowerCase());
}

function generateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no ambiguous chars
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `SNAP-${chars.slice(0, 3)}-${chars.slice(3, 6)}-${chars.slice(6, 9)}`;
}

/** true if this event_id was newly recorded, false if already seen. */
async function claimEvent(db, eventId) {
  const res = await db
    .prepare("INSERT OR IGNORE INTO processed_events (event_id, processed_at) VALUES (?, ?)")
    .bind(eventId, nowSeconds())
    .run();
  return res.meta.changes > 0;
}

async function provisionTransaction(db, txn, env) {
  const customerId = txn.customer_id ?? null;
  const transactionId = txn.id ?? null;
  const suppliedKey = txn.custom_data?.license_key ?? null;
  const items = Array.isArray(txn.items) ? txn.items : [];
  const issued = [];

  for (const item of items) {
    const priceId = item?.price?.id;
    const entitlement = entitlementForPrice(priceId, env);
    if (!entitlement) continue;

    if (entitlement.kind === "renewal") {
      const existing = await db
        .prepare(
          `SELECT key, entitled_versions FROM licenses
             WHERE paddle_customer_id = ? AND product = 'snapper-pro'
             ORDER BY created_at DESC LIMIT 1`,
        )
        .bind(customerId)
        .first();
      if (existing) {
        await db
          .prepare("UPDATE licenses SET entitled_versions = ? WHERE key = ?")
          .bind(widenBand(existing.entitled_versions), existing.key)
          .run();
      }
      // No matching key yet (renewal arrived before first purchase, or
      // customer mismatch): nothing to widen. A support path, not a crash.
      continue;
    }

    // Reuse an already-issued key for this transaction so a webhook retry
    // never mints a second key.
    const prior = await db
      .prepare("SELECT key FROM licenses WHERE paddle_transaction_id = ? LIMIT 1")
      .bind(transactionId)
      .first();
    const key = prior?.key || suppliedKey || generateKey();

    await db
      .prepare(
        `INSERT OR IGNORE INTO licenses
           (key, product, entitled_versions, seats, paddle_customer_id,
            paddle_transaction_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        key,
        entitlement.product,
        entitlement.entitledVersions,
        entitlement.seats,
        customerId,
        transactionId,
        nowSeconds(),
      )
      .run();

    issued.push(key);
  }

  return { customerId, issued };
}

/** Look up the buyer's email via the Paddle API. Returns null on any failure. */
async function fetchCustomerEmail(customerId, env) {
  if (!customerId || !env.PADDLE_API_KEY) return null;
  try {
    const res = await fetch(`${paddleApiBase(env)}/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}` },
    });
    if (!res.ok) return null;
    return (await res.json()).data?.email ?? null;
  } catch {
    return null;
  }
}

/** Send one license key via Resend. Returns true on a 2xx. */
async function sendKeyEmail(email, license, env) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) return false;

  const productName =
    license.product === "snapper-lifetime" ? "Snapper Lifetime" : "Snapper Pro";
  const subject = `Your ${productName} license key`;
  const text =
    `Thanks for buying ${productName}.\n\n` +
    `License key: ${license.key}\n` +
    `Updates through: ${license.entitled_versions}\n\n` +
    `Activate in Snapper: Settings > License > paste the key > Activate.\n` +
    `Need help? Reply to this email or contact snapper@nexis.io.vn.`;
  const html =
    `<p>Thanks for buying <strong>${productName}</strong>.</p>` +
    `<p style="font-size:1.1rem"><strong>License key:</strong> ` +
    `<code>${license.key}</code></p>` +
    `<p>Updates through: ${license.entitled_versions}</p>` +
    `<p>Activate in Snapper: <strong>Settings &rarr; License</strong>, paste the key, click Activate.</p>` +
    `<p>Need help? Reply to this email or contact ` +
    `<a href="mailto:snapper@nexis.io.vn">snapper@nexis.io.vn</a>.</p>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: env.RESEND_FROM, to: [email], subject, text, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Email each newly issued key whose row still has emailed_at IS NULL.
 * Best-effort: a failure here never fails the webhook (the buyer can still
 * retrieve the key on /thanks, and emailed_at stays NULL for follow-up).
 */
async function deliverKeys(db, env, { customerId, issued }) {
  if (issued.length === 0) return;

  const pending = [];
  for (const key of issued) {
    const row = await db
      .prepare(
        "SELECT key, product, entitled_versions FROM licenses WHERE key = ? AND emailed_at IS NULL",
      )
      .bind(key)
      .first();
    if (row) pending.push(row);
  }
  if (pending.length === 0) return;

  const email = await fetchCustomerEmail(customerId, env);
  if (!email) {
    console.error("license email skipped: no address for customer", customerId);
    return;
  }

  for (const row of pending) {
    if (await sendKeyEmail(email, row, env)) {
      await db
        .prepare("UPDATE licenses SET emailed_at = ? WHERE key = ?")
        .bind(nowSeconds(), row.key)
        .run();
    } else {
      console.error("license email failed for key", row.key);
    }
  }
}

export async function onRequestPost({ request, env }) {
  const rawBody = await request.text();

  try {
    const ok = await verifyPaddleSignature(
      request.headers.get("Paddle-Signature"),
      rawBody,
      env.PADDLE_WEBHOOK_SECRET,
    );
    if (!ok) return json({ error: "Bad signature" }, 500);

    const event = JSON.parse(rawBody);
    const eventId = event.event_id ?? event.notification_id;
    if (!eventId) return json({ error: "No event id" }, 500);

    if (!(await claimEvent(env.LICENSE_DB, eventId))) {
      return json({ ok: true, deduped: true });
    }

    try {
      if (event.event_type === "transaction.completed") {
        const result = await provisionTransaction(env.LICENSE_DB, event.data, env);
        await deliverKeys(env.LICENSE_DB, env, result);
      }
    } catch (err) {
      // Release the claim so the retry re-processes instead of being deduped.
      await env.LICENSE_DB.prepare("DELETE FROM processed_events WHERE event_id = ?")
        .bind(eventId)
        .run();
      throw err;
    }

    return json({ ok: true });
  } catch (err) {
    // Any throw -> 500 so Paddle retries the same event_id.
    return json({ error: "Webhook processing failed", detail: String(err) }, 500);
  }
}

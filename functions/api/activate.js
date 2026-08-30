/**
 * License activation. Cloudflare Pages Function.
 *
 * POST /api/activate   { "key": "<license key>", "machine": "<fingerprint>" }
 *   200  { "receipt": "<base64url(payload)>.<base64url(ed25519 sig)>" }
 *
 * Status codes match the app's `LicenseActivationError` mapping:
 *   404  unknown key            -> invalidKey
 *   409  seat limit reached     -> seatLimitReached
 *   400  malformed request
 *   500  server / signing error -> server(status:)
 *
 * A machine that is already activated gets a fresh receipt (idempotent
 * re-activation after a reinstall) without consuming another seat.
 *
 * Bindings / vars:
 *   LICENSE_DB            D1 binding
 *   LICENSE_SIGNING_KEY   secret, base64 PKCS#8 Ed25519 private key
 */

import { json, nowSeconds, mintReceipt } from "./_lib/license.js";

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const key = String(body.key || "").trim();
  const machine = String(body.machine || "").trim();
  if (!key || !machine) {
    return json({ error: "key and machine are required" }, 400);
  }
  if (!env.LICENSE_SIGNING_KEY) {
    return json({ error: "Signing key not configured" }, 500);
  }

  const license = await env.LICENSE_DB.prepare(
    "SELECT key, product, entitled_versions, seats FROM licenses WHERE key = ?",
  )
    .bind(key)
    .first();
  if (!license) {
    return json({ error: "Unknown license key" }, 404);
  }

  const already = await env.LICENSE_DB.prepare(
    "SELECT 1 FROM activations WHERE license_key = ? AND machine = ?",
  )
    .bind(key, machine)
    .first();

  if (!already) {
    const { count } = await env.LICENSE_DB.prepare(
      "SELECT COUNT(*) AS count FROM activations WHERE license_key = ?",
    )
      .bind(key)
      .first();
    if (count >= license.seats) {
      return json({ error: "Seat limit reached" }, 409);
    }
    await env.LICENSE_DB.prepare(
      "INSERT OR IGNORE INTO activations (license_key, machine, activated_at) VALUES (?, ?, ?)",
    )
      .bind(key, machine, nowSeconds())
      .run();
  }

  try {
    const receipt = await mintReceipt(
      {
        product: license.product,
        entitledVersions: license.entitled_versions,
        machine,
      },
      env.LICENSE_SIGNING_KEY,
    );
    return json({ receipt });
  } catch (err) {
    return json({ error: "Could not sign receipt", detail: String(err) }, 500);
  }
}

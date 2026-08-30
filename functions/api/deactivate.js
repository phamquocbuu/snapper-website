/**
 * License deactivation. Cloudflare Pages Function.
 *
 * POST /api/deactivate   { "key": "<license key>", "machine": "<fingerprint>" }
 *   200   (body ignored by the app)
 *
 * Idempotent: an unknown key or machine still returns 200 - the caller's
 * intent ("this Mac should not hold a seat") is satisfied either way.
 *
 * Bindings:  LICENSE_DB   D1 binding
 */

import { empty } from "./_lib/license.js";

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return empty(200);
  }

  const key = String(body.key || "").trim();
  const machine = String(body.machine || "").trim();
  if (key && machine) {
    await env.LICENSE_DB.prepare(
      "DELETE FROM activations WHERE license_key = ? AND machine = ?",
    )
      .bind(key, machine)
      .run();
  }

  return empty(200);
}

/**
 * License key lookup for the /thanks page. Cloudflare Pages Function.
 *
 * GET /api/license-lookup?txn=txn_...
 *   200  { key, product, entitled_versions }   key is ready
 *   202  { pending: true }                     paid, but the webhook has
 *                                              not written the row yet
 *   404  { error }                             unknown / unpaid transaction
 *
 * The transaction id comes from Paddle's `_ptxn` query param on the
 * checkout success URL. We confirm it with the Paddle API (so a caller
 * cannot read out a key by guessing) before returning anything.
 *
 * Vars:  LICENSE_DB, PADDLE_API_KEY, PADDLE_ENVIRONMENT
 */

import { json, paddleApiBase } from "./_lib/license.js";

const PAID_STATUSES = new Set(["completed", "paid", "billed"]);

export async function onRequestGet({ request, env }) {
  const txn = new URL(request.url).searchParams.get("txn") || "";
  if (!/^txn_[a-z0-9]+$/i.test(txn)) {
    return json({ error: "Missing or malformed txn" }, 400);
  }
  if (!env.PADDLE_API_KEY) {
    return json({ error: "Lookup not configured" }, 500);
  }

  let status;
  try {
    const res = await fetch(`${paddleApiBase(env)}/transactions/${txn}`, {
      headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}` },
    });
    if (res.status === 404) return json({ error: "Unknown transaction" }, 404);
    if (!res.ok) return json({ error: "Could not verify transaction" }, 502);
    status = (await res.json()).data?.status;
  } catch {
    return json({ error: "Could not verify transaction" }, 502);
  }

  if (!PAID_STATUSES.has(status)) {
    return json({ error: "Transaction is not complete" }, 404);
  }

  const row = await env.LICENSE_DB.prepare(
    "SELECT key, product, entitled_versions FROM licenses WHERE paddle_transaction_id = ? LIMIT 1",
  )
    .bind(txn)
    .first();

  if (!row) return json({ pending: true }, 202);
  return json(row);
}

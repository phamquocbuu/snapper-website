/**
 * Fire a synthetic, correctly-signed Paddle webhook at a locally running
 * `wrangler pages dev` so functions/api/paddle-webhook.js can be tested
 * without a tunnel or a real Paddle account.
 *
 *   PADDLE_WEBHOOK_SECRET=dev-secret \
 *   PADDLE_PRICE_PRO_FIRST=pri_... \
 *   node scripts/webhook-sim.mjs [pro-first|pro-renewal|lifetime] [event_id]
 *
 * The secret and price ids must match what `wrangler pages dev` loads from
 * .dev.vars. Pass the same event_id twice to check idempotency
 * (second run should report "deduped").
 */

import { createHmac } from "node:crypto";

const URL = process.env.WEBHOOK_URL || "http://localhost:8788/api/paddle-webhook";
const SECRET = process.env.PADDLE_WEBHOOK_SECRET || "dev-secret";

const priceByName = {
  "pro-first": process.env.PADDLE_PRICE_PRO_FIRST,
  "pro-renewal": process.env.PADDLE_PRICE_PRO_RENEWAL,
  lifetime: process.env.PADDLE_PRICE_LIFETIME,
};

const which = process.argv[2] || "pro-first";
const priceId = priceByName[which];
if (!priceId) {
  console.error(`Unknown/unset price "${which}". Set PADDLE_PRICE_* in the environment.`);
  process.exit(1);
}

const eventId = process.argv[3] || "evt_" + Date.now();
const body = JSON.stringify({
  event_id: eventId,
  event_type: "transaction.completed",
  data: {
    id: "txn_sim_" + eventId,
    customer_id: "ctm_sim_1",
    custom_data: { license_key: "SNAP-SIM-" + which.toUpperCase().slice(0, 4) },
    items: [{ price: { id: priceId } }],
  },
});

const ts = Math.floor(Date.now() / 1000);
const h1 = createHmac("sha256", SECRET).update(`${ts}:${body}`).digest("hex");

const res = await fetch(URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Paddle-Signature": `ts=${ts};h1=${h1}`,
  },
  body,
});

console.log(`${res.status} ${res.statusText}`);
console.log(await res.text());
console.log(`\nevent_id: ${eventId}`);
console.log("Inspect:  npx wrangler d1 execute snapper-licenses --local --command \\");
console.log('  "SELECT * FROM licenses; SELECT * FROM activations; SELECT * FROM processed_events;"');

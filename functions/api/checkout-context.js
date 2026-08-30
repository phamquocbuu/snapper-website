/**
 * Checkout context for the Snapper pricing page - Cloudflare Pages Function.
 *
 * Same-origin GET /api/checkout-context. Returns the public Paddle.js
 * client token, the resolved environment, the catalog price IDs, and (if a
 * visitor is signed in) their email for checkout pre-fill.
 *
 * Why a function instead of hardcoding the token in the HTML:
 *   - The environment is read from PADDLE_ENVIRONMENT and this endpoint
 *     fails loudly (HTTP 500) if it is unset or not exactly
 *     "sandbox" / "production" - so the site can never silently run
 *     against the wrong Paddle account.
 *   - It is the server-side seam where the secret PADDLE_API_KEY lives
 *     (used only to resolve a signed-in customer). The API key is never
 *     sent to the browser - only the public client token is.
 *
 * Variables (Pages project -> Settings -> Variables and Secrets, and
 * .dev.vars for local `wrangler pages dev`):
 *   PADDLE_ENVIRONMENT          "sandbox" | "production"   (required)
 *   PADDLE_CLIENT_TOKEN         public Paddle.js token, test_.../live_...  (required)
 *   PADDLE_PRICE_PRO_FIRST      pri_...  Snapper Pro - first purchase   (required)
 *   PADDLE_PRICE_PRO_RENEWAL    pri_...  Snapper Pro - update renewal   (required)
 *   PADDLE_PRICE_LIFETIME       pri_...  Snapper Lifetime               (required)
 *   PADDLE_API_KEY              secret, server-only; only needed once
 *                              customer pre-fill is wired to real auth
 */

const VALID_ENVIRONMENTS = ["sandbox", "production"];

const PADDLE_API_BASE = {
  sandbox: "https://sandbox-api.paddle.com",
  production: "https://api.paddle.com",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/** Throws with a clear message if any required variable is missing/invalid. */
function readConfig(env) {
  const environment = env.PADDLE_ENVIRONMENT;
  if (!VALID_ENVIRONMENTS.includes(environment)) {
    throw new Error(
      `PADDLE_ENVIRONMENT must be one of ${VALID_ENVIRONMENTS.join(" / ")}, ` +
        `got ${environment ? `"${environment}"` : "(unset)"}. Refusing to guess.`,
    );
  }

  const required = {
    clientToken: env.PADDLE_CLIENT_TOKEN,
    proFirst: env.PADDLE_PRICE_PRO_FIRST,
    proRenewal: env.PADDLE_PRICE_PRO_RENEWAL,
    lifetime: env.PADDLE_PRICE_LIFETIME,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Missing Paddle configuration: ${missing.join(", ")}.`);
  }

  return { environment, ...required };
}

/**
 * Resolve the signed-in visitor. Stubbed: there is no web auth yet, so this
 * always returns null and checkout opens with no pre-filled email.
 *
 * When real auth lands, return { email } here. `checkoutCustomer()` below
 * will turn that into a Paddle customer reference server-side.
 */
async function resolveSignedInVisitor(request, env) {
  return null;
}

/**
 * Turn a signed-in email into a checkout `customer` object. Looks the
 * customer up in Paddle (server-side, with the secret API key) so a
 * returning buyer reuses their existing record; falls back to just the
 * email if there is no match yet. Returns null when nothing is signed in.
 */
async function checkoutCustomer(visitor, config, env) {
  if (!visitor?.email) return null;
  const email = visitor.email;

  if (!env.PADDLE_API_KEY) {
    // No key configured - still pre-fill the address field with the email.
    return { email };
  }

  try {
    const url = new URL(`${PADDLE_API_BASE[config.environment]}/customers`);
    url.searchParams.set("email", email);
    url.searchParams.set("status", "active");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}` },
    });
    if (res.ok) {
      const found = (await res.json()).data?.[0];
      if (found?.id) return { id: found.id };
    }
  } catch {
    // Network / API failure is non-fatal: fall through to email pre-fill.
  }
  return { email };
}

export async function onRequestGet({ request, env }) {
  let config;
  try {
    config = readConfig(env);
  } catch (err) {
    return json({ error: err.message }, 500);
  }

  const visitor = await resolveSignedInVisitor(request, env);
  const customer = await checkoutCustomer(visitor, config, env);

  return json({
    environment: config.environment,
    clientToken: config.clientToken,
    prices: {
      proFirst: config.proFirst,
      proRenewal: config.proRenewal,
      lifetime: config.lifetime,
    },
    customer,
  });
}

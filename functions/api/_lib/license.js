/**
 * Shared helpers for the Snapper license Pages Functions
 * (paddle-webhook.js, activate.js, deactivate.js).
 *
 * Files under `_lib/` start with an underscore, so Pages does not route
 * them as endpoints - they are import-only.
 */

/** JSON response with no caching. */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Empty response (used by /deactivate, whose body the app ignores). */
export function empty(status = 200) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** Paddle REST base for the configured environment (defaults to sandbox). */
export function paddleApiBase(env) {
  return env.PADDLE_ENVIRONMENT === "production"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";
}

// --- base64 / base64url -----------------------------------------------------

export function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64) {
  const binary = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// --- Ed25519 receipt signing ---------------------------------------------

/**
 * Mint a license receipt the app can verify against its compiled-in
 * Ed25519 public key.
 *
 *   payload  = JSON({ product, entitled_versions, machine, iat })
 *   receipt  = base64url(payloadBytes) + "." + base64url(rawSignature)
 *
 * The signature is over the raw UTF-8 payload bytes (not the base64url
 * text), which is what `LicenseReceipt` verification expects.
 *
 * @param {string} signingKeyBase64 base64 of the PKCS#8 DER Ed25519 private key
 *        (LICENSE_SIGNING_KEY). Generate with scripts/gen-license-keypair.mjs.
 */
export async function mintReceipt({ product, entitledVersions, machine }, signingKeyBase64) {
  const payload = JSON.stringify({
    product,
    entitled_versions: entitledVersions,
    machine,
    iat: nowSeconds(),
  });
  const payloadBytes = new TextEncoder().encode(payload);

  const key = await crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(signingKeyBase64),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", key, payloadBytes));

  return `${bytesToBase64Url(payloadBytes)}.${bytesToBase64Url(sig)}`;
}

// --- entitlement mapping -------------------------------------------------

/**
 * Map a Paddle price id to what the license grants. `env` supplies the
 * price ids (the same PADDLE_PRICE_* vars the checkout function uses), so
 * switching sandbox -> production is a config change, not a code change.
 *
 * Bands are pinned to the major at purchase time (see the license backend
 * plan doc). Renewal has no band of its own - it widens an existing key.
 *
 * @returns {{ kind: "issue", product: string, entitledVersions: string, seats: number }
 *          | { kind: "renewal" }
 *          | null}  null = price we do not provision (ignore it).
 */
export function entitlementForPrice(priceId, env) {
  if (priceId && priceId === env.PADDLE_PRICE_PRO_FIRST) {
    return { kind: "issue", product: "snapper-pro", entitledVersions: "1.0 - 1.x", seats: 1 };
  }
  if (priceId && priceId === env.PADDLE_PRICE_LIFETIME) {
    return {
      kind: "issue",
      product: "snapper-lifetime",
      entitledVersions: "1.0 - 999.x",
      seats: 3,
    };
  }
  if (priceId && priceId === env.PADDLE_PRICE_PRO_RENEWAL) {
    return { kind: "renewal" };
  }
  return null;
}

/**
 * Widen an "A.b - N.x" band's upper major by one: "1.0 - 1.x" -> "1.0 - 2.x".
 * Falls back to appending " (renewed)" only if the band is unparseable, so a
 * renewal never silently no-ops.
 */
export function widenBand(entitledVersions) {
  const m = /^(.*-\s*)(\d+)(\s*\.\s*(?:x|\*|\d+))\s*$/i.exec(entitledVersions);
  if (!m) return entitledVersions;
  const nextMajor = parseInt(m[2], 10) + 1;
  return `${m[1]}${nextMajor}.x`;
}

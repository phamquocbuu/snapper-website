/**
 * Generate the Ed25519 keypair for Snapper license receipts. Run once.
 *
 *   node scripts/gen-license-keypair.mjs
 *
 * Outputs:
 *   1. LICENSE_SIGNING_KEY - base64 PKCS#8 DER private key. Store as a
 *      Pages secret:  npx wrangler pages secret put LICENSE_SIGNING_KEY
 *      and add it to .dev.vars for local `wrangler pages dev`.
 *   2. The raw 32-byte public key (base64) - compile this into the app,
 *      replacing the placeholder in LicenseConfiguration.Obfuscated
 *      (Packages/CoreKit/Sources/LicenseManager.swift). CryptoKit's
 *      Curve25519.Signing.PublicKey(rawRepresentation:) wants the raw
 *      32 bytes, not SPKI DER.
 *
 * The Worker signs with WebCrypto "Ed25519", which emits a bare 64-byte
 * signature - exactly what isValidSignature(_:for:) verifies.
 */

import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");

const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" });
const spki = publicKey.export({ type: "spki", format: "der" });
const rawPublic = spki.subarray(spki.length - 32); // strip the 12-byte SPKI header

console.log("LICENSE_SIGNING_KEY (base64 PKCS#8 private key) -> Pages secret + .dev.vars:");
console.log(pkcs8.toString("base64"));
console.log();
console.log("App public key (raw 32-byte, base64) -> compile into the app:");
console.log(rawPublic.toString("base64"));
console.log();
console.log("App public key (raw 32-byte, hex):");
console.log(rawPublic.toString("hex"));

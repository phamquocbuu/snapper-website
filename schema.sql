-- Snapper license store (Cloudflare D1).
--
-- Apply locally:  npx wrangler d1 execute snapper-licenses --local  --file=schema.sql
-- Apply remote:   npx wrangler d1 execute snapper-licenses --remote --file=schema.sql
--
-- All three tables are safe to re-run (IF NOT EXISTS).

-- One row per issued license key.
CREATE TABLE IF NOT EXISTS licenses (
  key                   TEXT PRIMARY KEY,
  product               TEXT NOT NULL,          -- "snapper-pro" | "snapper-lifetime"
  entitled_versions     TEXT NOT NULL,          -- e.g. "1.0 - 1.x", parsed by the app
  seats                 INTEGER NOT NULL,       -- max concurrent activations
  paddle_customer_id    TEXT,
  paddle_transaction_id TEXT,
  created_at            INTEGER NOT NULL        -- unix seconds
);

CREATE INDEX IF NOT EXISTS idx_licenses_customer
  ON licenses (paddle_customer_id);

-- One row per (license, machine) seat. Deleting the row frees the seat.
CREATE TABLE IF NOT EXISTS activations (
  license_key  TEXT NOT NULL REFERENCES licenses (key) ON DELETE CASCADE,
  machine      TEXT NOT NULL,                   -- opaque SHA256 fingerprint from the app
  activated_at INTEGER NOT NULL,                -- unix seconds
  PRIMARY KEY (license_key, machine)
);

-- Idempotency ledger for Paddle webhook deliveries (same event_id on retry).
CREATE TABLE IF NOT EXISTS processed_events (
  event_id     TEXT PRIMARY KEY,
  processed_at INTEGER NOT NULL                 -- unix seconds
);

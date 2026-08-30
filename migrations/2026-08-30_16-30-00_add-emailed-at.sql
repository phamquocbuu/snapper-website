-- Add license-key email tracking + a transaction lookup index to an
-- existing licenses table (fresh installs already get these from schema.sql).
--
--   npx wrangler d1 execute snapper-licenses     --remote --file=migrations/2026-08-30_16-30-00_add-emailed-at.sql
--   npx wrangler d1 execute dev_snapper_licenses --remote --file=migrations/2026-08-30_16-30-00_add-emailed-at.sql
--   npx wrangler d1 execute snapper-licenses     --local  --file=migrations/2026-08-30_16-30-00_add-emailed-at.sql

ALTER TABLE licenses ADD COLUMN emailed_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_licenses_transaction
  ON licenses (paddle_transaction_id);

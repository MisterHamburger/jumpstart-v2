-- Track the Whatnot SKU each kickstart_intake row was uploaded under.
-- Lets us reprint barcode stickers later that match the SKU Whatnot stored.
-- SKU = the group-representative intake.id at export time (see whatnotCsv.js).
-- All units in the same listing group share the same whatnot_sku.
--
-- Cleared whenever whatnot_listed_at is reset (so a re-export gets fresh values).
--
-- Date: 2026-05-12

ALTER TABLE kickstart_intake ADD COLUMN IF NOT EXISTS whatnot_sku TEXT;

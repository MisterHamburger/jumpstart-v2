-- Add photo_url and gender to jumpstart_manifest.
--   photo_url: populated at import time using the vendor's Scene7 image
--     facade (J.Crew + Madewell pattern lives in src/components/AdminInputs.jsx
--     and src/lib/jumpstartWhatnotCsv.js). Existing rows stay NULL — we'll
--     backfill separately if/when needed.
--   gender: from the manifest "Gender" column ("Mens" / "Womens"). Used by
--     the Whatnot CSV exporter to pick Men's Fashion vs Women's Fashion
--     category. NULL falls back to Women's at export time.
--
-- Date: 2026-05-13

ALTER TABLE jumpstart_manifest ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE jumpstart_manifest ADD COLUMN IF NOT EXISTS gender TEXT;

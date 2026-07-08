-- Add Title column to kickstart_intake to mirror Whatnot CSV upload schema.
-- Schema mapping (intentional naming asymmetry — see CSV export logic):
--   kickstart_intake.description → Whatnot Sub Category (e.g. "Tops", "Bottoms")
--   kickstart_intake.title       → Whatnot Title (product name)
--   kickstart_intake.notes       → Whatnot Description (free-text product description)
--
-- Date: 2026-05-09

ALTER TABLE kickstart_intake ADD COLUMN title TEXT;

UPDATE kickstart_intake
SET title = notes
WHERE notes IS NOT NULL AND notes != '';

UPDATE kickstart_intake
SET notes = 'Free People', title = 'Free People'
WHERE notes IS NULL OR notes = '';

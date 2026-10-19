-- Guaranteed payments to partners (2026).
--
-- Jumpstart Deals, LLC became a multi-member LLC (partnership) effective
-- January 1, 2026: Operating Agreement "dated as of January 1, 2026", signed
-- March 6, 2026 — Joshua Sizemore 640 units, Jeremiah Sizemore 200, Wesley
-- Teague 160. Josh confirmed (2026-10-19) that the regular payments to Josh and
-- Wesley are guaranteed payments from that date, not draws. Guaranteed payments
-- are a deductible partnership expense (Form 1065 line 10) and are reported to
-- each partner on the K-1 — so they belong in Labor, not equity.
--
-- The expense rows keep category OWNER_DRAW (the import already tags them; the
-- dashboard shows them on their own line); only the tax account changes:
-- OWNER_DRAW → 6070 Guaranteed Payments to Partners.
--
-- Run in Supabase Dashboard > SQL Editor.
-- Date: 2026-10-19

INSERT INTO gl_accounts (code, name, type, section, sort)
VALUES ('6070', 'Guaranteed Payments to Partners', 'expense', 'Labor', 6070)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, section = EXCLUDED.section;

UPDATE gl_rules
   SET gl_account = '6070',
       note = 'Guaranteed payments to partners (Josh, Wesley) — partnership from 2026-01-01 per operating agreement'
 WHERE category = 'OWNER_DRAW' AND pattern = '%';

NOTIFY pgrst, 'reload schema';

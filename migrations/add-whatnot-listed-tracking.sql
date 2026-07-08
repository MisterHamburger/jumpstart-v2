-- Track which kickstart_intake items have been included in a Whatnot CSV export.
-- Lets us avoid re-listing items already on Whatnot, while still allowing a
-- manual "reset to unlisted" when a Whatnot listing is deleted out-of-band.
--
-- Date: 2026-05-10

ALTER TABLE kickstart_intake ADD COLUMN whatnot_listed_at TIMESTAMPTZ;

-- Landed vs in-transit tracking for loads.
--
-- Background (Josh, 2026-07-01): a load counts as inventory the moment it's
-- entered, but purchased loads are often still in transit (not physically on
-- the shelf, not yet sellable). We need "cost of units in stock" to mean
-- physically-landed stock, kept separate from total owned inventory value
-- (which includes in-transit). Workflow: mark a load "in transit" on upload,
-- toggle it to "landed" when it arrives / selling begins.
--
-- New loads default to landed=false (in transit). All EXISTING loads are here
-- or already sold through, so they're backfilled to landed=true — except the
-- two currently in transit: Load 14 (1,200 UJC) and Load 12 (110 Buck Mason).
--
-- Run in Supabase Dashboard > SQL Editor.
-- Date: 2026-07-01

ALTER TABLE loads ADD COLUMN IF NOT EXISTS landed BOOLEAN NOT NULL DEFAULT false;

UPDATE loads SET landed = true;                                  -- existing loads: on hand / sold
UPDATE loads SET landed = false WHERE id IN ('Load 14', 'Load 12'); -- currently in transit

NOTIFY pgrst, 'reload schema';

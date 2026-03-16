-- Add target_quantity column to bundle boxes tables
-- target_quantity = N  → fixed size box, auto-completes at N items
-- target_quantity = NULL → unlimited mode, manual "Done Scanning" to complete

ALTER TABLE jumpstart_bundle_boxes ADD COLUMN target_quantity integer;
ALTER TABLE kickstart_bundle_boxes ADD COLUMN target_quantity integer;

-- Backfill all existing boxes to 40 (legacy standard box size)
UPDATE jumpstart_bundle_boxes SET target_quantity = 40;
UPDATE kickstart_bundle_boxes SET target_quantity = 40;

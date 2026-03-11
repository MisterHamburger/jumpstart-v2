-- Add shipping fields to bundle boxes tables
-- Run in Supabase Dashboard > SQL Editor
-- Date: 2026-03-10
--
-- shipping_charged = what the customer pays for shipping
-- shipping_cost = what it actually costs to ship

ALTER TABLE jumpstart_bundle_boxes
  ADD COLUMN IF NOT EXISTS shipping_charged NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC DEFAULT 0;

ALTER TABLE kickstart_bundle_boxes
  ADD COLUMN IF NOT EXISTS shipping_charged NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC DEFAULT 0;

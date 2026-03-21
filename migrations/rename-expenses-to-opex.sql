-- Rename expense category from EXPENSES to OPEX
-- One-time migration, already applied
-- Run in Supabase Dashboard > SQL Editor
-- Date: 2026-03-11

-- Rename existing EXPENSES rows to OPEX
UPDATE expenses SET category = 'OPEX' WHERE category = 'EXPENSES';

-- NOTE: The dashboard summary RPC is now maintained in create-dashboard-summary-rpc.sql
-- Do not duplicate it here.

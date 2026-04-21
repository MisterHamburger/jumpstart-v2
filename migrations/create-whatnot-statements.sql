-- Table for authoritative Whatnot financial statements (uploaded PDFs).
-- One row per statement period (weekly, monthly, or yearly Whatnot reports).
-- Dashboard and Profitability tabs stay as estimates; this table feeds the
-- new "Statements" tab for accounting-accurate numbers.
--
-- Run in Supabase Dashboard > SQL Editor
-- Date: 2026-04-21

CREATE TABLE IF NOT EXISTS whatnot_statements (
  id BIGSERIAL PRIMARY KEY,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_label TEXT,                   -- "March 2026", "Mar 1-7, 2026", "2026"
  statement_number TEXT,
  sales NUMERIC(12,2) DEFAULT 0,
  tips NUMERIC(12,2) DEFAULT 0,
  commission NUMERIC(12,2) DEFAULT 0,
  processing NUMERIC(12,2) DEFAULT 0,
  show_boost NUMERIC(12,2) DEFAULT 0,
  seller_shipping NUMERIC(12,2) DEFAULT 0,
  other_adjustments NUMERIC(12,2) DEFAULT 0,
  payouts NUMERIC(12,2) DEFAULT 0,
  uploaded_filename TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Prevent duplicate uploads of the same period
CREATE UNIQUE INDEX IF NOT EXISTS whatnot_statements_period_uniq
  ON whatnot_statements (period_start, period_end);

-- Index for date-range lookups when joining to profitability view
CREATE INDEX IF NOT EXISTS whatnot_statements_range_idx
  ON whatnot_statements (period_start, period_end);

COMMENT ON TABLE whatnot_statements IS
  'Authoritative Whatnot financial statements uploaded as PDFs. '
  'Paired with our estimated dashboard/profitability numbers (joined by date range) '
  'to produce reconcilable monthly P&L on the Statements tab.';

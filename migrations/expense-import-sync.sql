-- Expense import v2 (2026-10-22): keep Co-pilot's account + card, and back up
-- any row the importer removes when it syncs an open month to Co-pilot.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS account TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS account_mask TEXT;

CREATE TABLE IF NOT EXISTS expense_import_removed (
  id BIGINT,
  date DATE,
  description TEXT,
  amount NUMERIC,
  category TEXT,
  gl_account TEXT,
  account TEXT,
  account_mask TEXT,
  created_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ DEFAULT now(),
  reason TEXT
);
ALTER TABLE expense_import_removed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON expense_import_removed;
CREATE POLICY "Allow all" ON expense_import_removed FOR ALL USING (true) WITH CHECK (true);

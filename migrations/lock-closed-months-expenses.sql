-- Closed months are locked at the database level (2026-10-22).
-- Any INSERT into expenses dated on or before the end of the latest closed month
-- is silently dropped, so an old cached copy of the app (or any script) can never
-- re-add feed rows to reconciled months. Updates (e.g. account assignments) and
-- journal entries are unaffected. To post a late correction, use a journal entry
-- in the Financials tab, or reopen the month first.

CREATE OR REPLACE FUNCTION skip_expenses_in_closed_months()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE locked_through DATE;
BEGIN
  SELECT (MAX(month) + INTERVAL '1 month' - INTERVAL '1 day')::date
    INTO locked_through
  FROM month_closes WHERE status = 'closed';
  IF locked_through IS NOT NULL AND NEW.date <= locked_through THEN
    RETURN NULL;  -- drop the row quietly
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lock_closed_months ON expenses;
CREATE TRIGGER lock_closed_months
BEFORE INSERT ON expenses
FOR EACH ROW EXECUTE FUNCTION skip_expenses_in_closed_months();

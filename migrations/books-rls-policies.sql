-- Supabase auto-enabled row-level security on the new books tables, so the
-- app (anon key) could neither read the chart of accounts nor save a close.
-- Same convention as the rest of the schema (jumpstart-schema.sql §10):
-- RLS on + an "Allow all" policy (the admin area is password-gated in-app).
--
-- Run in Supabase Dashboard > SQL Editor.
-- Date: 2026-10-12

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gl_accounts','gl_rules','month_closes','journal_entries','account_balances'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'Allow all') THEN
      EXECUTE format('CREATE POLICY "Allow all" ON %I FOR ALL USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

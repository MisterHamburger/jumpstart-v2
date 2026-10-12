-- Books, Phase 2: monthly close tables + 12/31/2025 opening balances.
--
--   month_closes      one row per month: open/closed, month-end inventory
--                     snapshot (computed by the app, or an override with a
--                     note when the app's item data can't support it — e.g.
--                     Jan 2026, before scanning launched), close notes.
--   journal_entries   adjusting entries (opening balances, inventory change,
--                     payroll tax split, income not in the expense feed,
--                     reconciliation corrections). Debit/credit, tax accounts.
--   account_balances  month-end statement balances for bank / card / Venmo /
--                     Whatnot accounts — the balance sheet's cash & cards and
--                     the reconciliation target.
--   kickstart_intake_inventory_at(date)  unsold Kickstart intake at cost.
--
-- Opening balances = the 12/31/2025 balance sheet sent to the accountant
-- (2025 net loss $14,197.78 closed into Retained Earnings). If the accountant
-- adjusts 2025, change these entries (source = 'opening').
--
-- Run in Supabase Dashboard > SQL Editor.
-- Date: 2026-10-12

BEGIN;

CREATE TABLE IF NOT EXISTS month_closes (
  month DATE PRIMARY KEY CHECK (EXTRACT(DAY FROM month) = 1),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  inventory_value NUMERIC(12,2),          -- total month-end inventory booked
  inventory_detail JSONB,                 -- {pools, in_transit, manifested, kickstart_intake, computed_at}
  inventory_note TEXT,                    -- required when the value is an override/estimate
  notes TEXT,
  closed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id BIGSERIAL PRIMARY KEY,
  entry_date DATE NOT NULL,
  account TEXT NOT NULL REFERENCES gl_accounts(code),
  debit NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  memo TEXT,
  source TEXT NOT NULL DEFAULT 'manual',  -- opening / inventory / payroll / income / reconciliation / manual
  batch TEXT,                             -- groups the lines of one entry (must net to zero)
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS journal_entries_date_idx ON journal_entries (entry_date);

CREATE TABLE IF NOT EXISTS account_balances (
  period_end DATE NOT NULL,
  account TEXT NOT NULL REFERENCES gl_accounts(code),
  balance NUMERIC(12,2) NOT NULL,         -- assets: amount held; liabilities: amount owed
  source TEXT,                            -- e.g. 'Amex 6710 stmt 2026-01-31'
  note TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (period_end, account)
);

-- New 2026 accounts as they come up can be added here / from the app.
INSERT INTO gl_accounts (code, name, type, section, sort) VALUES
  ('1013','Whatnot Balance','asset',NULL,1013)
ON CONFLICT (code) DO NOTHING;

-- Opening balances at 12/31/2025 (only once).
INSERT INTO journal_entries (entry_date, account, debit, credit, memo, source, batch)
SELECT v.d::date, v.acct, v.dr, v.cr, v.memo, 'opening', 'opening-2025-12-31'
FROM (VALUES
  ('2025-12-31','1000',0.01,0,'12/31/2025 balance sheet (sent to accountant 10/2026)'),
  ('2025-12-31','1001',5611.04,0,'12/31/2025 balance sheet'),
  ('2025-12-31','1002',215.02,0,'12/31/2025 balance sheet ($1,215.02 bank less $1,000 payment in transit)'),
  ('2025-12-31','1003',16.08,0,'12/31/2025 balance sheet'),
  ('2025-12-31','1004',0.01,0,'12/31/2025 balance sheet'),
  ('2025-12-31','1011',2936.50,0,'12/31/2025 balance sheet ($1,300.19 KS payout in transit + $1,636.31 legacy)'),
  ('2025-12-31','1012',12.60,0,'12/31/2025 balance sheet'),
  ('2025-12-31','1015',47232.75,0,'12/31/2025 estimated inventory (no count)'),
  ('2025-12-31','1016',16898.23,0,'12/31/2025 estimated inventory (no count)'),
  ('2025-12-31','2001',0,51828.91,'12/31/2025 balance sheet'),
  ('2025-12-31','2002',0,3622.96,'12/31/2025 balance sheet'),
  ('2025-12-31','2003',0,13492.08,'12/31/2025 balance sheet'),
  ('2025-12-31','2500',0,30000.00,'12/31/2025 balance sheet'),
  ('2025-12-31','3000',0,53757.70,'12/31/2025 balance sheet'),
  ('2025-12-31','3002',79779.41,0,'Retained earnings: (65,581.63) + 2025 net loss (14,197.78)')
) AS v(d, acct, dr, cr, memo)
WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE batch = 'opening-2025-12-31');

DO $$ DECLARE dr numeric; cr numeric; BEGIN
  SELECT SUM(debit), SUM(credit) INTO dr, cr FROM journal_entries WHERE batch = 'opening-2025-12-31';
  IF dr <> cr THEN RAISE EXCEPTION 'Opening balances do not balance: debits % vs credits %', dr, cr; END IF;
END $$;

-- Unsold Kickstart intake items at cost (true_cost) as of p_date.
CREATE OR REPLACE FUNCTION kickstart_intake_inventory_at(p_date date)
RETURNS TABLE (units bigint, value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*), ROUND(COALESCE(SUM(COALESCE(ki.true_cost, ki.cost)), 0), 2)
  FROM kickstart_intake ki
  WHERE ki.created_at::date <= p_date
    AND NOT EXISTS (
      SELECT 1 FROM kickstart_sold_scans ks JOIN shows sh ON sh.id = ks.show_id
      WHERE ks.intake_id = ki.id AND sh.date <= p_date
    );
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';

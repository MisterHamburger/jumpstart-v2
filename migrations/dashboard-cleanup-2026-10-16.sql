-- ============================================================================
-- Dashboard cleanup after the YTD audit (2026-10-16)
-- ============================================================================
--
-- 1. Kickstart sourcing is retired. It used to be a LEFTOVER bucket (all of
--    SOURCING + INVENTORY minus known Jumpstart vendors), so every unknown
--    payment (Ghost/Nuzzie $103K, Cle Deals, Widover, Venmo...) leaked into
--    it and double-counted cashflow. It is now an IDENTIFIED set: only the
--    four real Kickstart sourcing vendors, and only through 2026-06-30 when
--    the FP wind-down ended sourcing. Nothing new can ever fall into it.
--    (Supersedes fix-ghost-vendor-exclusion.sql and retire-kickstart-sourcing.sql.)
--
-- 2. Whatnot fees = actual statement fees. The profitability view estimates
--    12.3% of hammer, which misses show boost/promote, seller-paid shipping and
--    adjustments (~$24K Feb–Sep). For every calendar month fully inside the
--    requested range that has an uploaded statement, the RPC uses the
--    statement's "Fees & costs", so "Revenue (net of Whatnot fees)" equals what
--    Whatnot actually paid out. Months without a statement yet (e.g. the
--    current month) use the estimate x 1.1883 (Feb–Sep actual/estimated ratio).
--
-- 3. Data fixes:
--    - Load 41 (Nuzzie): remove the $6,100 forklift estimate. Craneworks bills
--      the forklift directly and those bills are already in OPEX.
--    - Widover (freight broker) payments -> OPEX.
--    - Small non-inventory items that were filed as SOURCING/INVENTORY -> OPEX.
--    - January manual entry: fees $0 -> $17,304.55 (Jan statements, both accounts).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Monthly Whatnot statements (both accounts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatnot_monthly_statements (
  account      TEXT    NOT NULL,          -- 'jumpstartdeals' | 'kickstartdeals'
  month        DATE    NOT NULL,          -- first day of the month
  sales        NUMERIC NOT NULL DEFAULT 0,
  tips         NUMERIC NOT NULL DEFAULT 0,
  total_income NUMERIC NOT NULL DEFAULT 0,
  fees         NUMERIC NOT NULL DEFAULT 0, -- "Fees & costs" (commission, processing, boost, shipping, adjustments)
  payouts      NUMERIC NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (account, month)
);

ALTER TABLE whatnot_monthly_statements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON whatnot_monthly_statements;
CREATE POLICY "Allow all" ON whatnot_monthly_statements FOR ALL USING (true) WITH CHECK (true);

INSERT INTO whatnot_monthly_statements (account, month, sales, tips, total_income, fees, payouts) VALUES
  ('jumpstartdeals','2026-01-01',72299.60,56.00,72355.60,11168.45,61214.29),
  ('jumpstartdeals','2026-02-01',60415.65,83.00,60503.65,8643.40,51855.25),
  ('jumpstartdeals','2026-03-01',94603.80,68.00,94671.80,13230.92,81440.88),
  ('jumpstartdeals','2026-04-01',124497.50,33.00,124534.13,18688.26,105845.87),
  ('jumpstartdeals','2026-05-01',63947.80,36.00,63983.80,10041.38,53899.02),
  ('jumpstartdeals','2026-06-01',159777.00,26.00,159803.00,22883.96,136962.44),
  ('jumpstartdeals','2026-07-01',202664.40,228.00,202892.40,30226.97,172678.84),
  ('jumpstartdeals','2026-08-01',156273.60,76.00,156349.60,24404.68,131931.51),
  ('jumpstartdeals','2026-09-01',188651.40,60.00,188711.40,26327.60,162383.80),
  ('kickstartdeals','2026-01-01',46760.85,2.00,46762.85,6136.10,40594.13),
  ('kickstartdeals','2026-02-01',12049.95,5.00,12054.95,1671.96,10382.99),
  ('kickstartdeals','2026-03-01',14605.45,5.00,14610.45,2105.59,12504.86),
  ('kickstartdeals','2026-04-01',18304.00,2.00,18311.00,1936.91,16369.09),
  ('kickstartdeals','2026-05-01',25936.00,0.00,25936.00,3741.33,22194.67),
  ('kickstartdeals','2026-06-01',46422.00,16.00,46438.00,6384.88,40053.12),
  ('kickstartdeals','2026-07-01',19911.00,0.00,19911.00,2584.07,17326.93),
  ('kickstartdeals','2026-08-01',5628.00,0.00,5628.00,901.55,4726.45),
  ('kickstartdeals','2026-09-01',3713.00,0.00,3713.00,506.22,3206.78)
ON CONFLICT (account, month) DO UPDATE SET
  sales = EXCLUDED.sales, tips = EXCLUDED.tips, total_income = EXCLUDED.total_income,
  fees = EXCLUDED.fees, payouts = EXCLUDED.payouts;


-- ---------------------------------------------------------------------------
-- 2. Data fixes
-- ---------------------------------------------------------------------------
-- Load 41 (Nuzzie): drop the $6,100 forklift estimate ($2,500 CA + $3,600 ATL).
UPDATE loads
   SET total_cost = 102973.93,
       notes = 'CA (arrived; ATL manifest) $52,531.65 + freight $0 (shipper paid) = $52,531.65, 2,291u. '
            || 'ATL (CA manifest) $46,442.28 + freight $4,000 (actual) = $50,442.28, 2,847u. '
            || 'Forklift ($6,100 est.) removed 2026-10-16 — Craneworks bills it directly in OPEX.'
 WHERE id = 'Load 41' AND total_cost = 109073.93;

-- Widover is the freight broker -> OPEX.
UPDATE expenses SET category = 'OPEX'
 WHERE description ILIKE '%widover%' AND category IN ('INVENTORY', 'SOURCING');

-- Non-inventory odds and ends filed as SOURCING/INVENTORY -> OPEX
-- (Spectrum internet, Apple Cash, Abristow, a Craneworks bill, Target/FedEx refunds, membership fee adjustment).
UPDATE expenses SET category = 'OPEX'
 WHERE id IN (9641, 9653, 9655, 9658, 9722, 9733, 10905, 10909, 11254)
   AND category IN ('INVENTORY', 'SOURCING');

-- January manual entry: real fees from the January statements (both accounts).
UPDATE manual_revenue SET fees = 17304.55 WHERE id = 1 AND period_label = 'January 2026';


-- ---------------------------------------------------------------------------
-- 3. RPC: statement fees + retired Kickstart sourcing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_dashboard_summary(date_cutoff DATE DEFAULT NULL, date_end DATE DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql AS $$
DECLARE
  result JSON;
  js RECORD; ks RECORD;
  mr_js RECORD; mr_ks RECORD;
  total_expenses NUMERIC;
  total_payroll NUMERIC;
  total_payroll_sourcing NUMERIC;
  total_load_cost NUMERIC;
  total_sourcing NUMERIC;
  effective_start DATE;
  expense_start DATE;
  js_wn_fees NUMERIC; ks_wn_fees NUMERIC;
  js_items BIGINT; js_revenue NUMERIC; js_fees NUMERIC; js_cogs NUMERIC;
  ks_items BIGINT; ks_revenue NUMERIC; ks_fees NUMERIC; ks_cogs NUMERIC;
  fee_gap CONSTANT NUMERIC := 1.1883;   -- actual/estimated Whatnot fees, Feb–Sep 2026
BEGIN
  effective_start := GREATEST(COALESCE(date_cutoff, '2026-02-07'), '2026-02-07');
  expense_start   := COALESCE(date_cutoff, '2026-02-07');

  SELECT COUNT(*)::BIGINT AS items, COALESCE(SUM(buyer_paid),0) AS revenue,
         COALESCE(SUM(cost_freight),0) AS cogs
    INTO js FROM profitability WHERE channel = 'Jumpstart'
      AND (date_cutoff IS NULL OR show_date >= date_cutoff)
      AND (date_end   IS NULL OR show_date <= date_end);

  SELECT COUNT(*)::BIGINT AS items, COALESCE(SUM(buyer_paid),0) AS revenue,
         COALESCE(SUM(cost_freight),0) AS cogs
    INTO ks FROM profitability WHERE channel = 'Kickstart'
      AND (date_cutoff IS NULL OR show_date >= date_cutoff)
      AND (date_end   IS NULL OR show_date <= date_end);

  -- Whatnot fees per channel: statement fees for whole months that have a
  -- statement, otherwise the per-item estimate scaled by fee_gap.
  -- Bundles / off-platform sales carry no Whatnot fees.
  WITH est AS (
    SELECT channel, date_trunc('month', show_date)::date AS m, SUM(total_fees) AS f
      FROM profitability
     WHERE NOT COALESCE(is_bundle, false)
       AND (date_cutoff IS NULL OR show_date >= date_cutoff)
       AND (date_end   IS NULL OR show_date <= date_end)
     GROUP BY 1, 2
  )
  SELECT
    COALESCE(SUM(CASE WHEN e.channel = 'Jumpstart' THEN COALESCE(s.fees, e.f * fee_gap) END), 0),
    COALESCE(SUM(CASE WHEN e.channel = 'Kickstart' THEN COALESCE(s.fees, e.f * fee_gap) END), 0)
    INTO js_wn_fees, ks_wn_fees
    FROM est e
    LEFT JOIN whatnot_monthly_statements s
      ON s.account = CASE e.channel WHEN 'Jumpstart' THEN 'jumpstartdeals' ELSE 'kickstartdeals' END
     AND s.month = e.m
     AND (date_cutoff IS NULL OR e.m >= date_cutoff)                                         -- month fully
     AND (date_end   IS NULL OR (e.m + INTERVAL '1 month' - INTERVAL '1 day')::date <= date_end); -- inside range

  SELECT COALESCE(SUM(items),0)::BIGINT AS items, COALESCE(SUM(revenue),0) AS revenue,
         COALESCE(SUM(fees),0) AS fees, COALESCE(SUM(cogs),0) AS cogs
    INTO mr_js FROM manual_revenue WHERE channel = 'Jumpstart'
      AND (date_cutoff IS NULL OR period_start >= date_cutoff)
      AND (date_end    IS NULL OR period_end   <= date_end);

  SELECT COALESCE(SUM(items),0)::BIGINT AS items, COALESCE(SUM(revenue),0) AS revenue,
         COALESCE(SUM(fees),0) AS fees, COALESCE(SUM(cogs),0) AS cogs
    INTO mr_ks FROM manual_revenue WHERE channel = 'Kickstart'
      AND (date_cutoff IS NULL OR period_start >= date_cutoff)
      AND (date_end    IS NULL OR period_end   <= date_end);

  js_items   := js.items   + mr_js.items;
  js_revenue := js.revenue + mr_js.revenue;
  js_fees    := ROUND(js_wn_fees + mr_js.fees, 2);
  js_cogs    := js.cogs    + mr_js.cogs;

  ks_items   := ks.items   + mr_ks.items;
  ks_revenue := ks.revenue + mr_ks.revenue;
  ks_fees    := ROUND(ks_wn_fees + mr_ks.fees, 2);
  ks_cogs    := ks.cogs    + mr_ks.cogs;

  SELECT COALESCE(SUM(amount), 0) INTO total_expenses FROM expenses
    WHERE category = 'OPEX' AND date >= expense_start
    AND (date_end IS NULL OR date <= date_end);

  SELECT COALESCE(SUM(amount), 0) INTO total_payroll FROM expenses
    WHERE category = 'PAYROLL' AND date >= expense_start
    AND (date_end IS NULL OR date <= date_end);

  SELECT COALESCE(SUM(amount), 0) INTO total_payroll_sourcing FROM expenses
    WHERE category = 'PAYROLL_SOURCING' AND date >= expense_start
    AND (date_end IS NULL OR date <= date_end);

  -- All inventory cash = the loads table (opening carry-over loads excluded).
  SELECT COALESCE(SUM(total_cost), 0) INTO total_load_cost FROM loads
    WHERE date >= effective_start AND (date_end IS NULL OR date <= date_end)
      AND COALESCE(is_opening, false) = false;

  -- Kickstart sourcing (RETIRED): only the four real Kickstart sourcing
  -- vendors, only through the end of the FP wind-down. Identified set — an
  -- unrecognized payment can never land here again.
  SELECT COALESCE(SUM(amount), 0) INTO total_sourcing FROM expenses
    WHERE category IN ('SOURCING', 'INVENTORY')
      AND date <= '2026-06-30'
      AND (   description ILIKE '%reclectic%'
           OR description ILIKE '%businessrsor%'
           OR description ILIKE '%888 digital%'
           OR description ILIKE '%dick%sporting%'
           OR description ILIKE '%dickssporting%')
      AND date >= expense_start AND (date_end IS NULL OR date <= date_end);

  result := json_build_object(
    'jumpstart', json_build_object(
      'items', js_items, 'revenue', js_revenue, 'fees', js_fees,
      'net_revenue', ROUND(js_revenue - js_fees, 2),
      'cogs', js_cogs,
      'gross_profit', ROUND(js_revenue - js_fees - js_cogs, 2)
    ),
    'kickstart', json_build_object(
      'items', ks_items, 'revenue', ks_revenue, 'fees', ks_fees,
      'net_revenue', ROUND(ks_revenue - ks_fees, 2),
      'cogs', ks_cogs,
      'gross_profit', ROUND(ks_revenue - ks_fees - ks_cogs, 2)
    ),
    'expenses', total_expenses, 'payroll', total_payroll,
    'payroll_sourcing', total_payroll_sourcing,
    'load_cost', total_load_cost, 'load_freight', 0,
    'sourcing', total_sourcing, 'sourcing_direct', total_sourcing,
    'sourcing_venmo', 0, 'sourcing_ups', 0
  );
  RETURN result;
END; $$;

NOTIFY pgrst, 'reload schema';

-- Verify (expected YTD: Kickstart sourcing ~$160.7K, fees up ~$46K):
-- SELECT get_dashboard_summary('2026-01-01', '2026-12-31');

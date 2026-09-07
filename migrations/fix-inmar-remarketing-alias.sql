-- ============================================================================
-- Fix: Inmar-DHL's second bank alias leaks into "Kickstart sourcing"
-- Date: 2026-09-07
-- ============================================================================
--
-- PROBLEM
-- -------
-- `total_sourcing` in get_dashboard_summary is a LEFTOVER bucket, not an
-- identified set: it sums all of category IN ('SOURCING','INVENTORY') and then
-- subtracts known Jumpstart load vendors by description pattern. Anything the
-- filter does not recognize silently defaults to "Kickstart sourcing."
--
-- Inmar-DHL posts under TWO different descriptions:
--   1. "Wire Transfer ... Wells Fargo Bank, Na  - Inmar-dhl"  -> caught by %inmar%
--   2. "Dhl Remarketing Liquidation"                          -> caught by NOTHING
--
-- DHL Remarketing is Inmar's DBA on the ACH, so the string "inmar" never
-- appears in form 2. Those payments are therefore counted BOTH as Jumpstart
-- load cost (canonical, from the `loads` table) AND as Kickstart sourcing.
--
-- 2026 leakage: $23,755.00 (Jul 9) + $24,057.00 (Sep 1) = $47,812.00.
-- The Sep 1 payment ties exactly to a Sep 1 J.Crew/Madewell unmanifested load.
--
-- Also fixed here: the Jul 1 rent payment (3720 4th Ave, $4,000) imported as
-- INVENTORY while all nine other months of 2026 are OPEX. That single row was
-- both inflating the sourcing bucket and understating July OpEx.
--
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Data fix: rent is always OPEX, never INVENTORY.
-- ---------------------------------------------------------------------------
UPDATE expenses
   SET category = 'OPEX'
 WHERE category = 'INVENTORY'
   AND description ILIKE '%3720 4th Ave%';

-- ---------------------------------------------------------------------------
-- 2. RPC fix: add %remarketing% to the Jumpstart load-vendor exclusion list.
--    (Identical to migrations/blend-jcrew-madewell-pool.sql apart from that
--    one added line — repeated in full because CREATE OR REPLACE FUNCTION
--    requires the whole body.)
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
  total_load_freight NUMERIC;
  total_sourcing NUMERIC;
  ups_amount NUMERIC;
  effective_start DATE;
  expense_start DATE;
  js_items BIGINT; js_revenue NUMERIC; js_fees NUMERIC; js_cogs NUMERIC;
  ks_items BIGINT; ks_revenue NUMERIC; ks_fees NUMERIC; ks_cogs NUMERIC;
BEGIN
  effective_start := GREATEST(COALESCE(date_cutoff, '2026-02-07'), '2026-02-07');
  expense_start   := COALESCE(date_cutoff, '2026-02-07');

  SELECT COUNT(*)::BIGINT AS items, COALESCE(SUM(buyer_paid),0) AS revenue,
         COALESCE(SUM(total_fees),0) AS fees, COALESCE(SUM(cost_freight),0) AS cogs
    INTO js FROM profitability WHERE channel = 'Jumpstart'
      AND (date_cutoff IS NULL OR show_date >= date_cutoff)
      AND (date_end   IS NULL OR show_date <= date_end);

  SELECT COUNT(*)::BIGINT AS items, COALESCE(SUM(buyer_paid),0) AS revenue,
         COALESCE(SUM(total_fees),0) AS fees, COALESCE(SUM(cost_freight),0) AS cogs
    INTO ks FROM profitability WHERE channel = 'Kickstart'
      AND (date_cutoff IS NULL OR show_date >= date_cutoff)
      AND (date_end   IS NULL OR show_date <= date_end);

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
  js_fees    := js.fees    + mr_js.fees;
  js_cogs    := js.cogs    + mr_js.cogs;

  ks_items   := ks.items   + mr_ks.items;
  ks_revenue := ks.revenue + mr_ks.revenue;
  ks_fees    := ks.fees    + mr_ks.fees;
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

  -- Exclude opening-balance carry-over loads from cashflow (not real spend).
  SELECT COALESCE(SUM(total_cost), 0) INTO total_load_cost FROM loads
    WHERE date >= effective_start AND (date_end IS NULL OR date <= date_end)
      AND COALESCE(is_opening, false) = false;

  total_load_freight := 0;

  SELECT COALESCE(SUM(amount), 0) INTO total_sourcing FROM expenses
    WHERE category IN ('SOURCING', 'INVENTORY')
      AND description NOT ILIKE '%ups%'
      AND description NOT ILIKE '%pirate ship%'
      AND description NOT ILIKE '%smartlots%'
      AND description NOT ILIKE '%inmar%'
      AND description NOT ILIKE '%remarketing%'   -- Inmar-DHL's other bank alias
      AND description NOT ILIKE '%jumpstart%'
      AND description NOT ILIKE '%boutiquebythebox%'
      AND description NOT ILIKE '%nusource%'
      AND description NOT ILIKE '%quince%'
      AND date >= expense_start AND (date_end IS NULL OR date <= date_end);

  ups_amount := 0;

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
    'load_cost', total_load_cost, 'load_freight', total_load_freight,
    'sourcing', total_sourcing, 'sourcing_direct', total_sourcing,
    'sourcing_venmo', 0, 'sourcing_ups', ups_amount
  );
  RETURN result;
END; $$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verify: post-June "Kickstart sourcing" should now be Reclectic + Venmo only.
-- Expected after this migration — Jul: -$91, Aug: $0, Sep: $5,150 - $245.
-- ---------------------------------------------------------------------------
-- SELECT to_char(date,'YYYY-MM') AS month, description, SUM(amount)
--   FROM expenses
--  WHERE category IN ('SOURCING','INVENTORY')
--    AND description NOT ILIKE '%ups%' AND description NOT ILIKE '%pirate ship%'
--    AND description NOT ILIKE '%smartlots%' AND description NOT ILIKE '%inmar%'
--    AND description NOT ILIKE '%remarketing%' AND description NOT ILIKE '%jumpstart%'
--    AND description NOT ILIKE '%boutiquebythebox%' AND description NOT ILIKE '%nusource%'
--    AND description NOT ILIKE '%quince%'
--    AND date >= '2026-06-01'
--  GROUP BY 1, 2 ORDER BY 1, 3 DESC;

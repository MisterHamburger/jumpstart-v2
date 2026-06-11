-- Fix cashflow double-count of Jumpstart load payments + document TRANSFER reclass.
--
-- Background (found in 2026-06-10 dashboard/data review):
--   1. The expense CSV import now forces inventory-vendor rows (Sp Smartlots,
--      Inmar-DHL wires, Hemster "Jumpstart Deals", etc.) into the INVENTORY
--      category (commits f7805ad, 43cd88e). But get_dashboard_summary() sums
--      category IN ('SOURCING','INVENTORY') into its `sourcing` output, which
--      the Cashflow tab subtracts as "Kickstart" inventory purchases — IN
--      ADDITION to the `loads` table (load_cost + load_freight). Jumpstart
--      load payments were therefore double-counted (~$93k overstated outflow
--      in May 2026) and mislabeled as Kickstart sourcing.
--      Fix: the `loads` table stays canonical for Jumpstart inventory cash;
--      the sourcing aggregate now excludes known Jumpstart load vendors by
--      description, mirroring the existing ups/pirate-ship exclusions.
--      Per Josh 2026-06-10: Boutiquebythebox and Nusource are Jumpstart
--      vendors (excluded); 888 Digital is Kickstart (stays).
--      ⚠️ When a NEW Jumpstart load vendor appears in bank imports, add it to
--      the exclusion list below or its payments will double-count again.
--   3. load_freight (0.45 × quantity) is no longer reported: per Josh
--      2026-06-10, Inmar payments mostly include freight, and any separate
--      freight charge arrives as its own OPEX expense from the freight
--      company/broker — so adding 0.45/item double-counted freight.
--   2. Owner capital wires (incoming, "Jeremiah Sizemore Or Sarah S Wolf")
--      were imported as negative SOURCING expenses (-$70k Mar 2026, -$30k Feb
--      2026, -$30k Oct 2024), silently offsetting real sourcing spend. They
--      are reclassified to TRANSFER, a category no dashboard aggregate reads.
--      (Already applied via API on 2026-06-10; UPDATEs below are idempotent.)
--
-- Run in Supabase Dashboard > SQL Editor
-- Date: 2026-06-10

-- ── Data reclass (idempotent — already applied via REST on 2026-06-10) ──────

UPDATE expenses SET category = 'TRANSFER'
WHERE category = 'SOURCING'
  AND amount < 0
  AND (description ILIKE 'wire transfer%incoming%'
       OR description ILIKE '%wire transfer jeremiah%');

UPDATE expenses SET category = 'OPEX'
WHERE category = 'INVENTORY'
  AND description ILIKE '%claude%';

-- ── Dashboard summary RPC ────────────────────────────────────────────────────
-- Identical to restore-jumpstart-custom-cost.sql except the total_sourcing
-- query, which now excludes Jumpstart load vendors.

DROP FUNCTION IF EXISTS get_dashboard_summary(date, date);

CREATE FUNCTION get_dashboard_summary(date_cutoff DATE DEFAULT NULL, date_end DATE DEFAULT NULL)
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

  SELECT COALESCE(SUM(total_cost), 0) INTO total_load_cost FROM loads
    WHERE date >= effective_start AND (date_end IS NULL OR date <= date_end);

  -- Freight is already inside Inmar load payments (or arrives as separate
  -- OPEX from the freight broker) — adding 0.45/item here double-counted it.
  -- Key kept at 0 for frontend compatibility.
  total_load_freight := 0;

  -- Kickstart sourcing: SOURCING + INVENTORY expenses, minus shipping and
  -- minus Jumpstart load vendors (those are canonical in the `loads` table —
  -- counting them here double-counted cashflow). Keep this vendor list in
  -- sync with the expense-import INVENTORY rules.
  SELECT COALESCE(SUM(amount), 0) INTO total_sourcing FROM expenses
    WHERE category IN ('SOURCING', 'INVENTORY')
      AND description NOT ILIKE '%ups%'
      AND description NOT ILIKE '%pirate ship%'
      AND description NOT ILIKE '%smartlots%'
      AND description NOT ILIKE '%inmar%'
      AND description NOT ILIKE '%jumpstart%'
      AND description NOT ILIKE '%boutiquebythebox%'
      AND description NOT ILIKE '%nusource%'
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

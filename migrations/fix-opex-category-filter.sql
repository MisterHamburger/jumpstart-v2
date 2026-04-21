-- FIX: get_dashboard_summary was filtering expenses WHERE category = 'EXPENSES'
-- but that category doesn't exist. Real categories are: OPEX, PAYROLL,
-- INVENTORY, SOURCING. As a result the "OpEx" line on the dashboard has
-- always been $0, silently overstating net profit by the entire OpEx total.
--
-- This bug existed in the previous migrations (fix-kickstart-true-cost.sql,
-- fix-ks-bundle-profitability.sql, remove-box1-hardcode.sql,
-- add-custom-item-cost.sql, tune-whatnot-fees.sql) — every rebuild of the
-- function carried the wrong filter forward. This migration just fixes the
-- one-line filter. View definition is untouched.
--
-- Run in Supabase Dashboard > SQL Editor
-- Date: 2026-04-21

CREATE OR REPLACE FUNCTION get_dashboard_summary(
  date_cutoff DATE DEFAULT NULL,
  date_end DATE DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
  js RECORD;
  ks RECORD;
  total_expenses NUMERIC;
  total_payroll NUMERIC;
BEGIN
  SELECT
    COUNT(*)::BIGINT AS items,
    COALESCE(SUM(buyer_paid), 0) AS revenue,
    COALESCE(SUM(total_fees), 0) AS fees,
    ROUND(COALESCE(SUM(buyer_paid), 0) - COALESCE(SUM(total_fees), 0), 2) AS net_revenue,
    COALESCE(SUM(cost_freight), 0) AS cogs,
    ROUND(COALESCE(SUM(buyer_paid), 0) - COALESCE(SUM(total_fees), 0) - COALESCE(SUM(cost_freight), 0), 2) AS gross_profit
  INTO js
  FROM profitability
  WHERE channel = 'Jumpstart'
    AND (date_cutoff IS NULL OR show_date >= date_cutoff)
    AND (date_end IS NULL OR show_date <= date_end);

  SELECT
    COUNT(*)::BIGINT AS items,
    COALESCE(SUM(buyer_paid), 0) AS revenue,
    COALESCE(SUM(total_fees), 0) AS fees,
    ROUND(COALESCE(SUM(buyer_paid), 0) - COALESCE(SUM(total_fees), 0), 2) AS net_revenue,
    COALESCE(SUM(cost_freight), 0) AS cogs,
    ROUND(COALESCE(SUM(buyer_paid), 0) - COALESCE(SUM(total_fees), 0) - COALESCE(SUM(cost_freight), 0), 2) AS gross_profit
  INTO ks
  FROM profitability
  WHERE channel = 'Kickstart'
    AND (date_cutoff IS NULL OR show_date >= date_cutoff)
    AND (date_end IS NULL OR show_date <= date_end);

  -- FIXED: was WHERE category = 'EXPENSES' (category doesn't exist).
  -- OpEx is the 'OPEX' category. SOURCING/INVENTORY are already
  -- reflected in Kickstart COGS (via kickstart_intake.true_cost),
  -- so we don't double-count them here.
  SELECT COALESCE(SUM(amount), 0)
  INTO total_expenses
  FROM expenses
  WHERE category = 'OPEX'
    AND (date_cutoff IS NULL OR date >= date_cutoff)
    AND (date_end IS NULL OR date <= date_end);

  SELECT COALESCE(SUM(amount), 0)
  INTO total_payroll
  FROM expenses
  WHERE category = 'PAYROLL'
    AND (date_cutoff IS NULL OR date >= date_cutoff)
    AND (date_end IS NULL OR date <= date_end);

  result := json_build_object(
    'jumpstart', json_build_object(
      'items', js.items,
      'revenue', js.revenue,
      'fees', js.fees,
      'net_revenue', js.net_revenue,
      'cogs', js.cogs,
      'gross_profit', js.gross_profit
    ),
    'kickstart', json_build_object(
      'items', ks.items,
      'revenue', ks.revenue,
      'fees', ks.fees,
      'net_revenue', ks.net_revenue,
      'cogs', ks.cogs,
      'gross_profit', ks.gross_profit
    ),
    'expenses', total_expenses,
    'payroll', total_payroll
  );

  RETURN result;
END;
$$;

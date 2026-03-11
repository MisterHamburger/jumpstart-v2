-- Dashboard summary RPC
-- Cards: avg sale price, profit/unit, gross profit, net profit
-- P&L table: revenue, fees, net revenue, COGS, gross profit, expenses, payroll, net profit
-- Run in Supabase Dashboard > SQL Editor
-- Date: 2026-03-10
-- FIX: net_revenue and gross_profit are DERIVED (not independently summed) so P&L always reconciles.
--   net_revenue = revenue - fees
--   cogs = SUM(cost_freight) for ALL items (not just matched barcodes)
--   gross_profit = net_revenue - cogs

DROP FUNCTION IF EXISTS get_dashboard_summary(date, date);

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

  SELECT COALESCE(SUM(amount), 0)
  INTO total_expenses
  FROM expenses
  WHERE category = 'EXPENSES'
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

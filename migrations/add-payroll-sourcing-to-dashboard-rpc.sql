-- Add PAYROLL_SOURCING category to get_dashboard_summary()
-- Splits Venmo sourcing-team labor (now PAYROLL_SOURCING) from operations payroll (PAYROLL)
-- Date: 2026-05-06

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
  total_payroll_sourcing NUMERIC;
  total_load_cost NUMERIC;
  total_load_freight NUMERIC;
  total_sourcing NUMERIC;
  ups_amount NUMERIC;
  effective_start DATE;
  expense_start DATE;
BEGIN
  effective_start := GREATEST(COALESCE(date_cutoff, '2026-02-07'), '2026-02-07');
  expense_start := COALESCE(date_cutoff, '2026-02-07');

  -- Jumpstart channel summary
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

  -- Kickstart channel summary
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

  ups_amount := 0;

  -- OPEX
  SELECT COALESCE(SUM(amount), 0)
  INTO total_expenses
  FROM expenses
  WHERE category = 'OPEX'
    AND date >= expense_start
    AND (date_end IS NULL OR date <= date_end);

  -- Operations payroll (Intuit only — excludes sourcing labor)
  SELECT COALESCE(SUM(amount), 0)
  INTO total_payroll
  FROM expenses
  WHERE category = 'PAYROLL'
    AND date >= expense_start
    AND (date_end IS NULL OR date <= date_end);

  -- Sourcing-team labor (Venmo) — separated 2026-05-06 to distinguish from operations payroll
  SELECT COALESCE(SUM(amount), 0)
  INTO total_payroll_sourcing
  FROM expenses
  WHERE category = 'PAYROLL_SOURCING'
    AND date >= expense_start
    AND (date_end IS NULL OR date <= date_end);

  -- Jumpstart inventory purchases: load invoice cost
  SELECT COALESCE(SUM(total_cost), 0)
  INTO total_load_cost
  FROM loads
  WHERE date >= effective_start
    AND (date_end IS NULL OR date <= date_end);

  -- Jumpstart freight
  SELECT COALESCE(SUM(freight_per_item * quantity), 0)
  INTO total_load_freight
  FROM loads
  WHERE date >= effective_start
    AND (date_end IS NULL OR date <= date_end);

  -- Kickstart sourcing: direct vendor payments only (after 2026-05-06 re-tag,
  -- Venmo lives in PAYROLL_SOURCING and Pirate Ship lives in OPEX, so this
  -- aggregate captures only direct-vendor entries like reclectic/businessrsor/dick)
  SELECT COALESCE(SUM(amount), 0)
  INTO total_sourcing
  FROM expenses
  WHERE category IN ('SOURCING', 'INVENTORY')
    AND description NOT ILIKE '%ups%'
    AND description NOT ILIKE '%pirate ship%'
    AND date >= expense_start
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
    'payroll', total_payroll,
    'payroll_sourcing', total_payroll_sourcing,
    'load_cost', total_load_cost,
    'load_freight', total_load_freight,
    'sourcing', total_sourcing,
    'sourcing_direct', total_sourcing,
    'sourcing_venmo', 0,
    'sourcing_ups', ups_amount
  );

  RETURN result;
END;
$$;

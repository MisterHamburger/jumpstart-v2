-- Add cashflow fields to get_dashboard_summary() RPC
-- Adds: load_cost, load_freight (from loads table), sourcing (from expenses)
-- Sourcing includes: SOURCING category + Venmo (from PAYROLL) + UPS (from OPEX)
-- Venmo/UPS are subtracted from their original categories to avoid double-counting

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
  total_load_cost NUMERIC;
  total_load_freight NUMERIC;
  total_sourcing NUMERIC;
  venmo_amount NUMERIC;
  ups_amount NUMERIC;
  effective_start DATE;
  expense_start DATE;
BEGIN
  -- Profitability data starts 2/7 (first show), but expenses can be earlier
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

  -- Venmo amount (sits in PAYROLL, but treated as Kickstart sourcing)
  SELECT COALESCE(SUM(amount), 0)
  INTO venmo_amount
  FROM expenses
  WHERE description ILIKE '%venmo%'
    AND date >= expense_start
    AND (date_end IS NULL OR date <= date_end);

  -- UPS not included in sourcing (already estimated in COGS via shipping_fee)
  ups_amount := 0;

  -- Sum OPEX expenses
  SELECT COALESCE(SUM(amount), 0)
  INTO total_expenses
  FROM expenses
  WHERE category = 'OPEX'
    AND date >= expense_start
    AND (date_end IS NULL OR date <= date_end);

  -- Sum payroll expenses (full amount for P&L)
  SELECT COALESCE(SUM(amount), 0)
  INTO total_payroll
  FROM expenses
  WHERE category = 'PAYROLL'
    AND date >= expense_start
    AND (date_end IS NULL OR date <= date_end);

  -- Jumpstart inventory purchases: load invoice cost (date filtered)
  SELECT COALESCE(SUM(total_cost), 0)
  INTO total_load_cost
  FROM loads
  WHERE date >= effective_start
    AND (date_end IS NULL OR date <= date_end);

  -- Jumpstart freight: freight_per_item * quantity per load (date filtered)
  SELECT COALESCE(SUM(freight_per_item * quantity), 0)
  INTO total_load_freight
  FROM loads
  WHERE date >= effective_start
    AND (date_end IS NULL OR date <= date_end);

  -- Kickstart sourcing: SOURCING category + Venmo (excluding shipping: UPS, Pirate Ship)
  SELECT COALESCE(SUM(amount), 0)
  INTO total_sourcing
  FROM expenses
  WHERE category = 'SOURCING'
    AND description NOT ILIKE '%ups%'
    AND description NOT ILIKE '%pirate ship%'
    AND date >= expense_start
    AND (date_end IS NULL OR date <= date_end);

  total_sourcing := total_sourcing + venmo_amount;

  -- Return consolidated JSON
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
    'load_cost', total_load_cost,
    'load_freight', total_load_freight,
    'sourcing', total_sourcing,
    'sourcing_direct', total_sourcing - venmo_amount - ups_amount,
    'sourcing_venmo', venmo_amount,
    'sourcing_ups', ups_amount
  );

  RETURN result;
END;
$$;

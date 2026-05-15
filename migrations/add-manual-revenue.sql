-- manual_revenue: pre-launch (or otherwise out-of-system) monthly totals
-- that should fold into the dashboard alongside live `profitability` data.
-- One row per channel × period. Seeded with Jan 2026 Jumpstart numbers
-- the user tracked in a spreadsheet before the new system launched on 2/7.
--
-- A row counts toward the dashboard total when its [period_start, period_end]
-- is fully contained in the requested date range, so partial-overlap queries
-- (e.g. "This month") don't prorate. "All time" (no cutoffs) includes every
-- row. "Year to date" with cutoff 1/1 of the current year picks up Jan.
--
-- Date: 2026-05-15

CREATE TABLE IF NOT EXISTS manual_revenue (
  id BIGSERIAL PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('Jumpstart', 'Kickstart')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_label TEXT,
  revenue NUMERIC(12,2) DEFAULT 0,
  fees NUMERIC(12,2) DEFAULT 0,
  cogs NUMERIC(12,2) DEFAULT 0,
  items INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT manual_revenue_period_ordered CHECK (period_start <= period_end)
);

CREATE INDEX IF NOT EXISTS manual_revenue_range_idx
  ON manual_revenue (channel, period_start, period_end);

CREATE UNIQUE INDEX IF NOT EXISTS manual_revenue_period_uniq
  ON manual_revenue (channel, period_start, period_end);

-- Seed: January 2026 Jumpstart (pre-launch, from spreadsheet)
INSERT INTO manual_revenue (channel, period_start, period_end, period_label, revenue, fees, cogs, items, notes)
VALUES (
  'Jumpstart',
  '2026-01-01',
  '2026-01-31',
  'January 2026',
  105819.23,
  0,
  111482.28,
  0,
  'Pre-launch — spreadsheet totals. Revenue and COGS only; fees assumed 0.'
)
ON CONFLICT (channel, period_start, period_end) DO NOTHING;

-- Rebuild get_dashboard_summary to fold in manual_revenue values that fall
-- fully within the requested date range. Preserves the existing JSON shape
-- (jumpstart, kickstart, expenses, payroll) — manual values are summed
-- into the relevant channel's revenue / fees / cogs / items, and the
-- derived net_revenue + gross_profit recompute automatically.
DROP FUNCTION IF EXISTS get_dashboard_summary(date, date);

CREATE FUNCTION get_dashboard_summary(date_cutoff DATE DEFAULT NULL, date_end DATE DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql AS $$
DECLARE
  result JSON;
  js RECORD; ks RECORD;
  mr_js RECORD; mr_ks RECORD;
  total_expenses NUMERIC;
  total_payroll NUMERIC;
  js_items BIGINT; js_revenue NUMERIC; js_fees NUMERIC; js_cogs NUMERIC;
  ks_items BIGINT; ks_revenue NUMERIC; ks_fees NUMERIC; ks_cogs NUMERIC;
BEGIN
  -- Profitability view (live)
  SELECT COUNT(*)::BIGINT AS items, COALESCE(SUM(buyer_paid),0) AS revenue,
         COALESCE(SUM(total_fees),0) AS fees, COALESCE(SUM(cost_freight),0) AS cogs
    INTO js
    FROM profitability
    WHERE channel = 'Jumpstart'
      AND (date_cutoff IS NULL OR show_date >= date_cutoff)
      AND (date_end   IS NULL OR show_date <= date_end);

  SELECT COUNT(*)::BIGINT AS items, COALESCE(SUM(buyer_paid),0) AS revenue,
         COALESCE(SUM(total_fees),0) AS fees, COALESCE(SUM(cost_freight),0) AS cogs
    INTO ks
    FROM profitability
    WHERE channel = 'Kickstart'
      AND (date_cutoff IS NULL OR show_date >= date_cutoff)
      AND (date_end   IS NULL OR show_date <= date_end);

  -- Manual revenue: include rows whose entire period is within the query range
  SELECT COALESCE(SUM(items),0)::BIGINT AS items,
         COALESCE(SUM(revenue),0) AS revenue,
         COALESCE(SUM(fees),0)    AS fees,
         COALESCE(SUM(cogs),0)    AS cogs
    INTO mr_js
    FROM manual_revenue
    WHERE channel = 'Jumpstart'
      AND (date_cutoff IS NULL OR period_start >= date_cutoff)
      AND (date_end   IS NULL OR period_end   <= date_end);

  SELECT COALESCE(SUM(items),0)::BIGINT AS items,
         COALESCE(SUM(revenue),0) AS revenue,
         COALESCE(SUM(fees),0)    AS fees,
         COALESCE(SUM(cogs),0)    AS cogs
    INTO mr_ks
    FROM manual_revenue
    WHERE channel = 'Kickstart'
      AND (date_cutoff IS NULL OR period_start >= date_cutoff)
      AND (date_end   IS NULL OR period_end   <= date_end);

  js_items   := js.items   + mr_js.items;
  js_revenue := js.revenue + mr_js.revenue;
  js_fees    := js.fees    + mr_js.fees;
  js_cogs    := js.cogs    + mr_js.cogs;

  ks_items   := ks.items   + mr_ks.items;
  ks_revenue := ks.revenue + mr_ks.revenue;
  ks_fees    := ks.fees    + mr_ks.fees;
  ks_cogs    := ks.cogs    + mr_ks.cogs;

  SELECT COALESCE(SUM(amount),0)
    INTO total_expenses
    FROM expenses
    WHERE category = 'OPEX'
      AND (date_cutoff IS NULL OR date >= date_cutoff)
      AND (date_end   IS NULL OR date <= date_end);

  SELECT COALESCE(SUM(amount),0)
    INTO total_payroll
    FROM expenses
    WHERE category = 'PAYROLL'
      AND (date_cutoff IS NULL OR date >= date_cutoff)
      AND (date_end   IS NULL OR date <= date_end);

  result := json_build_object(
    'jumpstart', json_build_object(
      'items',       js_items,
      'revenue',     js_revenue,
      'fees',        js_fees,
      'net_revenue', ROUND(js_revenue - js_fees, 2),
      'cogs',        js_cogs,
      'gross_profit',ROUND(js_revenue - js_fees - js_cogs, 2)
    ),
    'kickstart', json_build_object(
      'items',       ks_items,
      'revenue',     ks_revenue,
      'fees',        ks_fees,
      'net_revenue', ROUND(ks_revenue - ks_fees, 2),
      'cogs',        ks_cogs,
      'gross_profit',ROUND(ks_revenue - ks_fees - ks_cogs, 2)
    ),
    'expenses', total_expenses,
    'payroll',  total_payroll
  );
  RETURN result;
END; $$;

NOTIFY pgrst, 'reload schema';

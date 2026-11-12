-- Whatnot sales-tier commission in the fee estimate (2026-11-12)
--
-- From 2026-09-21 Whatnot charges commission by 4-week sales tier (Fashion:
-- <$15K 8%, $15K 7%, $35K 6.5%, $50K 5.5%, $100K 5%, $250K+ 4.5%). Sales in one
-- 4-week window (Monday resets, anchored 2026-09-21) set the next window's rate.
-- Jumpstart runs $120K+ per window -> 5%, down from the old 7.2% Premier rate.
--
-- Change: for months WITHOUT a statement (Oct 2026 on), estimated commission now
-- uses the tier rate per show date instead of the 2026 statement rate (~7.2%).
-- Processing, boost, shipping and refunds use each account's MEDIAN 2026 statement
-- month (was the average; Oct 2026's free-shipping test would have skewed it).
-- Months with a statement still use actual fees. Financials tab uses this RPC for open months, so both pages change together (docs/financial-rules.md).
--
-- Only get_dashboard_summary changes; everything else is copied from
-- migrations/landed-cost-2026-10-30.sql unchanged.
-- Run in Supabase Dashboard > SQL Editor.

CREATE OR REPLACE FUNCTION get_dashboard_summary(date_cutoff DATE DEFAULT NULL, date_end DATE DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql AS $$
DECLARE
  d0 DATE := COALESCE(date_cutoff, DATE '2026-01-01');
  d1 DATE := COALESCE(date_end, CURRENT_DATE);
  effective_start DATE := GREATEST(COALESCE(date_cutoff, DATE '2026-02-07'), DATE '2026-02-07');
  expense_start   DATE := COALESCE(date_cutoff, DATE '2026-02-07');
  ch JSON;
  total_expenses NUMERIC; total_payroll NUMERIC; total_payroll_sourcing NUMERIC;
  total_load_cost NUMERIC; total_sourcing NUMERIC; owner_draws NUMERIC;
  opex_breakdown JSON;
BEGIN
  WITH chan(channel, account) AS (
    VALUES ('Jumpstart', 'jumpstartdeals'), ('Kickstart', 'kickstartdeals')
  ),
  st AS (
    SELECT c.channel, s.period_start AS m,
           s.sales + s.tips + COALESCE(s.referral_credits, 0)              AS gross,
           s.commission, s.processing, s.show_boost,
           s.seller_shipping + COALESCE(s.shipping_surcharges, 0)          AS shipping,
           COALESCE(s.order_refunds, 0) + COALESCE(s.other_adjustments, 0) AS adjustments
      FROM whatnot_statements s JOIN chan c ON c.account = s.account
     WHERE s.period_start >= DATE '2026-01-01'
       AND s.period_end = (s.period_start + INTERVAL '1 month' - INTERVAL '1 day')::date
       AND s.period_start >= d0 AND s.period_end <= d1
  ),
  -- Each account's typical 2026 fee rates (per $ of sales) for estimating open months:
  -- the MEDIAN month, so a one-off month (e.g. Oct 2026 free-shipping test, 11.7%
  -- seller shipping) does not skew every estimate.
  rates AS (
    SELECT c.channel,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.commission / NULLIF(s.sales, 0))::numeric                AS r_comm,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.processing / NULLIF(s.sales, 0))::numeric                AS r_proc,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.show_boost / NULLIF(s.sales, 0))::numeric                AS r_boost,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY (s.seller_shipping + COALESCE(s.shipping_surcharges, 0)) / NULLIF(s.sales, 0))::numeric AS r_ship,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY (COALESCE(s.order_refunds, 0) + COALESCE(s.other_adjustments, 0)) / NULLIF(s.sales, 0))::numeric AS r_adj
      FROM whatnot_statements s JOIN chan c ON c.account = s.account
     WHERE s.period_start >= DATE '2026-01-01' AND s.sales > 0
     GROUP BY 1
  ),
  -- Whatnot sales-tier commission (from 2026-09-21). Sales in each 4-week window
  -- (Mondays, anchored 2026-09-21) set the next window's rate. Fashion tiers.
  tier_daily AS (
    SELECT sh.channel, sh.date::date AS d, SUM(si.buyer_paid) AS amt,
           FLOOR((sh.date::date - DATE '2026-09-21') / 28.0)::int AS w
      FROM show_items si JOIN shows sh ON sh.id = si.show_id
     WHERE si.status = 'valid' AND COALESCE(sh.is_test, false) = false
       AND sh.date::date BETWEEN DATE '2026-08-24' AND d1
     GROUP BY 1, 2
  ),
  tier_win AS (
    SELECT c.channel, w.w, COALESCE(SUM(t.amt), 0) AS amt
      FROM chan c
      CROSS JOIN generate_series(-1, GREATEST(0, FLOOR((d1 - DATE '2026-09-21') / 28.0)::int)) AS w(w)
      LEFT JOIN tier_daily t ON t.channel = c.channel AND t.w = w.w
     GROUP BY 1, 2
  ),
  tier_rate AS (
    SELECT channel, w,
           CASE WHEN prev >= 250000 THEN 0.045 WHEN prev >= 100000 THEN 0.05
                WHEN prev >= 50000  THEN 0.055 WHEN prev >= 35000  THEN 0.065
                WHEN prev >= 15000  THEN 0.07  ELSE 0.08 END AS rate
      FROM (SELECT channel, w, LAG(amt) OVER (PARTITION BY channel ORDER BY w) AS prev FROM tier_win) x
     WHERE w >= 0
  ),
  -- Effective tier commission rate per channel-month (months from Oct 2026 on)
  tier_month AS (
    SELECT t.channel, date_trunc('month', t.d)::date AS m,
           SUM(t.amt * r.rate) / NULLIF(SUM(t.amt), 0) AS r_comm
      FROM tier_daily t JOIN tier_rate r USING (channel, w)
     WHERE t.d >= DATE '2026-10-01'
     GROUP BY 1, 2
  ),
  agg AS MATERIALIZED (
    SELECT channel, date_trunc('month', show_date)::date AS m,
           COUNT(*)                                                                                     AS items,
           SUM(CASE WHEN COALESCE(is_bundle, false) THEN 0 ELSE buyer_paid END)                         AS paid,
           SUM(CASE WHEN COALESCE(is_bundle, false) THEN buyer_paid ELSE 0 END)                         AS offplatform,
           SUM(cost_freight)                                                                           AS cogs,
           SUM(CASE WHEN COALESCE(is_bundle, false) AND COALESCE(buyer_paid, 0) = 0 THEN cost_freight ELSE 0 END) AS writeoffs
      FROM profitability
     WHERE show_date BETWEEN d0 AND d1
     GROUP BY 1, 2
  ),
  wn AS (
    SELECT channel, m, paid FROM agg WHERE paid <> 0
  ),
  whatnot_lines AS (
    SELECT channel, gross, commission, processing, show_boost, shipping, adjustments, false AS est FROM st
    UNION ALL
    SELECT w.channel, w.paid, w.paid * COALESCE(tm.r_comm, r.r_comm), w.paid * r.r_proc, w.paid * r.r_boost,
           w.paid * r.r_ship, w.paid * r.r_adj, true
      FROM wn w JOIN rates r USING (channel)
      LEFT JOIN tier_month tm ON tm.channel = w.channel AND tm.m = w.m
     WHERE NOT EXISTS (SELECT 1 FROM st WHERE st.channel = w.channel AND st.m = w.m)
  ),
  wl AS (
    SELECT channel, SUM(gross) gross, SUM(commission) commission, SUM(processing) processing,
           SUM(show_boost) show_boost, SUM(shipping) shipping, SUM(adjustments) adjustments,
           bool_or(est) estimated
      FROM whatnot_lines GROUP BY 1
  ),
  items AS (
    SELECT channel, SUM(items) AS items, SUM(offplatform) AS offplatform,
           SUM(cogs) AS cogs, SUM(writeoffs) AS writeoffs
      FROM agg GROUP BY 1
  ),
  mr AS (
    SELECT m.channel, SUM(m.items) items, SUM(m.cogs) cogs,
           SUM(CASE WHEN EXISTS (SELECT 1 FROM st WHERE st.channel = m.channel
                                                     AND st.m = date_trunc('month', m.period_start)::date)
                    THEN 0 ELSE m.revenue END) AS revenue
      FROM manual_revenue m
     WHERE m.period_start >= d0 AND m.period_end <= d1
     GROUP BY 1
  ),
  per_ch AS (
    SELECT c.channel,
           COALESCE(i.items, 0) + COALESCE(mr.items, 0)                              AS items,
           COALESCE(wl.gross, 0) + COALESCE(mr.revenue, 0)                           AS whatnot_sales,
           COALESCE(i.offplatform, 0)                                                AS offplatform_sales,
           COALESCE(wl.commission, 0) AS commission, COALESCE(wl.processing, 0) AS processing,
           COALESCE(wl.show_boost, 0) AS show_boost, COALESCE(wl.shipping, 0)  AS shipping,
           COALESCE(wl.adjustments, 0) AS adjustments,
           COALESCE(wl.estimated, false)                                             AS fees_estimated,
           COALESCE(i.cogs, 0) + COALESCE(mr.cogs, 0)                                AS cogs,
           COALESCE(i.writeoffs, 0)                                                  AS writeoffs
      FROM chan c
      LEFT JOIN wl    ON wl.channel = c.channel
      LEFT JOIN items i ON i.channel = c.channel
      LEFT JOIN mr    ON mr.channel = c.channel
  )
  SELECT json_object_agg(lower(channel), json_build_object(
           'items', items,
           'whatnot_sales', ROUND(whatnot_sales, 2),
           'offplatform_sales', ROUND(offplatform_sales, 2),
           'revenue', ROUND(whatnot_sales + offplatform_sales, 2),
           'commission', ROUND(commission, 2),
           'processing', ROUND(processing, 2),
           'show_boost', ROUND(show_boost, 2),
           'shipping', ROUND(shipping, 2),
           'adjustments', ROUND(adjustments, 2),
           'fees', ROUND(commission + processing + show_boost + shipping + adjustments, 2),
           'fees_estimated', fees_estimated,
           'net_revenue', ROUND(whatnot_sales + offplatform_sales
                                - (commission + processing + show_boost + shipping + adjustments), 2),
           'cogs', ROUND(cogs, 2),
           'writeoffs', ROUND(writeoffs, 2),
           'gross_profit', ROUND(whatnot_sales + offplatform_sales
                                 - (commission + processing + show_boost + shipping + adjustments) - cogs, 2)
         ))
    INTO ch FROM per_ch;

  -- LANDED: bills capitalized into a load are inventory, not OPEX
  SELECT COALESCE(SUM(amount), 0) INTO total_expenses FROM expenses
   WHERE category = 'OPEX' AND load_id IS NULL AND date >= expense_start AND date <= d1;

  SELECT COALESCE(SUM(amount), 0) INTO total_payroll FROM expenses
   WHERE category = 'PAYROLL' AND date >= expense_start AND date <= d1;

  SELECT COALESCE(SUM(amount), 0) INTO total_payroll_sourcing FROM expenses
   WHERE category = 'PAYROLL_SOURCING' AND date >= expense_start AND date <= d1;

  SELECT COALESCE(SUM(amount), 0) INTO owner_draws FROM expenses
   WHERE category = 'OWNER_DRAW' AND date >= expense_start AND date <= d1;

  -- LANDED: OPEX by GL account excludes capitalized bills
  SELECT COALESCE(json_agg(json_build_object('code', code, 'name', name, 'amount', amount) ORDER BY amount DESC), '[]'::json)
    INTO opex_breakdown
    FROM (SELECT e.gl_code AS code, COALESCE(a.name, 'Unmapped') AS name, ROUND(SUM(e.amount), 2) AS amount
            FROM expenses_gl e LEFT JOIN gl_accounts a ON a.code = e.gl_code
           WHERE e.category = 'OPEX' AND e.load_id IS NULL AND e.date >= expense_start AND e.date <= d1
           GROUP BY 1, 2) x;

  -- LANDED: all inventory cash = the loads table at landed cost (opening carry-over loads excluded)
  SELECT COALESCE(SUM(landed_cost), 0) INTO total_load_cost FROM loads
   WHERE date >= effective_start AND date <= d1 AND COALESCE(is_opening, false) = false;

  SELECT COALESCE(SUM(amount), 0) INTO total_sourcing FROM expenses
   WHERE category IN ('SOURCING', 'INVENTORY')
     AND date <= DATE '2026-06-30'
     AND (   description ILIKE '%reclectic%'
          OR description ILIKE '%businessrsor%'
          OR description ILIKE '%888 digital%'
          OR description ILIKE '%dick%sporting%'
          OR description ILIKE '%dickssporting%')
     AND date >= expense_start AND date <= d1;

  RETURN json_build_object(
    'jumpstart', ch -> 'jumpstart',
    'kickstart', ch -> 'kickstart',
    'expenses', total_expenses,
    'opex_breakdown', opex_breakdown,
    'payroll', total_payroll,
    'payroll_sourcing', total_payroll_sourcing,
    'owner_draws', owner_draws,
    'load_cost', total_load_cost, 'load_freight', 0,
    'sourcing', total_sourcing, 'sourcing_direct', total_sourcing,
    'sourcing_venmo', 0, 'sourcing_ups', 0
  );
END; $$;

NOTIFY pgrst, 'reload schema';

-- Verify: October Jumpstart commission ~5% of sales (was ~7%)
--   SELECT get_dashboard_summary('2026-10-01','2026-10-31');

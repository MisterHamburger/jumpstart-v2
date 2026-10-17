-- ============================================================================
-- Truthful dashboard (2026-10-16, after the YTD audit)
-- ============================================================================
--
-- The dashboard now reports from the records of real money, not estimates:
--
--   GROSS SALES  = Whatnot statement item sales + tips (+ referral credits),
--                  plus off-platform bundle sales (FB Marketplace, bulk lots).
--   WHATNOT FEES = every line from the statement: commission, payment
--                  processing, show boost & promote, seller-paid shipping,
--                  refunds & adjustments.
--   NET SALES    = gross - fees  (= what Whatnot actually paid out, + bundles)
--   COGS         = items sold at cost; write-offs ($0 reconcile/damage-out
--                  bundles) reported separately so shrink is visible.
--   OPEX         = bank/card expenses, also broken out by GL account.
--
-- Months with no statement yet (the current month) are estimated from the
-- scanned sales x each account's ACTUAL 2026 fee rates per line, and flagged
-- `estimated` so the UI can label them. A statement month is only used when
-- the whole month is inside the requested range; partial months estimate.
--
-- Also:
--   * Kickstart sourcing is RETIRED: an identified set (Reclectic, Businessrsor,
--     888 Digital, Dick's) through 2026-06-30 only. It used to be a leftover
--     bucket that absorbed Ghost/Nuzzie ($103K), Cle Deals, Widover... and
--     double-counted cashflow. All inventory cash comes from `loads`.
--   * Load 41 (Nuzzie): $6,100 forklift estimate removed (Craneworks bills it
--     directly; those bills are OPEX).
--   * Widover (freight broker) -> OPEX. Small non-inventory items -> OPEX.
--   * The January manual entry keeps its COGS/items, but its revenue/fees are
--     superseded by the January statements.
--
-- Supersedes fix-ghost-vendor-exclusion.sql and retire-kickstart-sourcing.sql.
-- Safe to re-run.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Data fixes
-- ---------------------------------------------------------------------------
UPDATE loads
   SET total_cost = 102973.93,
       notes = 'CA (arrived; ATL manifest) $52,531.65 + freight $0 (shipper paid) = $52,531.65, 2,291u. '
            || 'ATL (CA manifest) $46,442.28 + freight $4,000 (actual) = $50,442.28, 2,847u. '
            || 'Forklift ($6,100 est.) removed 2026-10-16 — Craneworks bills it directly in OPEX.'
 WHERE id = 'Load 41' AND total_cost = 109073.93;

UPDATE expenses SET category = 'OPEX'
 WHERE description ILIKE '%widover%' AND category IN ('INVENTORY', 'SOURCING');

-- Spectrum internet, Apple Cash, Abristow, a Craneworks bill, Target/FedEx refunds, membership fee adjustment
UPDATE expenses SET category = 'OPEX'
 WHERE id IN (9641, 9653, 9655, 9658, 9722, 9733, 10905, 10909, 11254)
   AND category IN ('INVENTORY', 'SOURCING');


-- ---------------------------------------------------------------------------
-- 2. RPC
-- ---------------------------------------------------------------------------
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
  -- Whole statement months inside the range
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
  -- Each account's actual 2026 fee rates (per $ of sales) for estimating open months
  rates AS (
    SELECT c.channel,
           SUM(s.commission) / NULLIF(SUM(s.sales), 0)                                              AS r_comm,
           SUM(s.processing) / NULLIF(SUM(s.sales), 0)                                              AS r_proc,
           SUM(s.show_boost) / NULLIF(SUM(s.sales), 0)                                              AS r_boost,
           SUM(s.seller_shipping + COALESCE(s.shipping_surcharges, 0)) / NULLIF(SUM(s.sales), 0)    AS r_ship,
           SUM(COALESCE(s.order_refunds, 0) + COALESCE(s.other_adjustments, 0)) / NULLIF(SUM(s.sales), 0) AS r_adj
      FROM whatnot_statements s JOIN chan c ON c.account = s.account
     WHERE s.period_start >= DATE '2026-01-01'
     GROUP BY 1
  ),
  -- ONE pass over the (heavy) profitability view: per channel-month aggregates
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
  -- Scanned Whatnot sales per channel-month (bundles excluded)
  wn AS (
    SELECT channel, m, paid FROM agg WHERE paid <> 0
  ),
  whatnot_lines AS (
    SELECT channel, gross, commission, processing, show_boost, shipping, adjustments, false AS est FROM st
    UNION ALL
    SELECT w.channel, w.paid, w.paid * r.r_comm, w.paid * r.r_proc, w.paid * r.r_boost,
           w.paid * r.r_ship, w.paid * r.r_adj, true
      FROM wn w JOIN rates r USING (channel)
     WHERE NOT EXISTS (SELECT 1 FROM st WHERE st.channel = w.channel AND st.m = w.m)
  ),
  wl AS (
    SELECT channel, SUM(gross) gross, SUM(commission) commission, SUM(processing) processing,
           SUM(show_boost) show_boost, SUM(shipping) shipping, SUM(adjustments) adjustments,
           bool_or(est) estimated
      FROM whatnot_lines GROUP BY 1
  ),
  -- Item counts, off-platform sales, COGS, write-offs from the item-level data
  items AS (
    SELECT channel, SUM(items) AS items, SUM(offplatform) AS offplatform,
           SUM(cogs) AS cogs, SUM(writeoffs) AS writeoffs
      FROM agg GROUP BY 1
  ),
  -- Manual (pre-launch) months: COGS/items always; revenue only if no statement covers the month
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

  SELECT COALESCE(SUM(amount), 0) INTO total_expenses FROM expenses
   WHERE category = 'OPEX' AND date >= expense_start AND date <= d1;

  SELECT COALESCE(SUM(amount), 0) INTO total_payroll FROM expenses
   WHERE category = 'PAYROLL' AND date >= expense_start AND date <= d1;

  SELECT COALESCE(SUM(amount), 0) INTO total_payroll_sourcing FROM expenses
   WHERE category = 'PAYROLL_SOURCING' AND date >= expense_start AND date <= d1;

  SELECT COALESCE(SUM(amount), 0) INTO owner_draws FROM expenses
   WHERE category = 'OWNER_DRAW' AND date >= expense_start AND date <= d1;

  -- OPEX by GL account (largest first)
  SELECT COALESCE(json_agg(json_build_object('code', code, 'name', name, 'amount', amount) ORDER BY amount DESC), '[]'::json)
    INTO opex_breakdown
    FROM (SELECT e.gl_code AS code, COALESCE(a.name, 'Unmapped') AS name, ROUND(SUM(e.amount), 2) AS amount
            FROM expenses_gl e LEFT JOIN gl_accounts a ON a.code = e.gl_code
           WHERE e.category = 'OPEX' AND e.date >= expense_start AND e.date <= d1
           GROUP BY 1, 2) x;

  -- All inventory cash = the loads table (opening carry-over loads excluded)
  SELECT COALESCE(SUM(total_cost), 0) INTO total_load_cost FROM loads
   WHERE date >= effective_start AND date <= d1 AND COALESCE(is_opening, false) = false;

  -- Kickstart sourcing (RETIRED): identified vendors only, through 2026-06-30
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

-- Verify:
-- SELECT get_dashboard_summary('2026-01-01', '2026-12-31');

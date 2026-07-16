-- Blend RDM + UJC into one running "J.Crew/Madewell" WAC — freeze history.
--
-- Background (Josh, 2026-07-16): RDM and UJC are hard to keep separate at sale
-- time. Blend them into a single pool ('JCM') with one running WAC, going
-- forward only — past sales must NOT change.
--
-- Approach (opening-balance carry-over, so history is untouched):
--   * Leave every existing RDM/UJC load and past scan exactly as-is. Historical
--     sales keep resolving to their original separate WAC (the pool_wac CTE is
--     data-driven by pool_tag + date, and these loads/dates don't change).
--   * Seed a new 'JCM' pool with today's on-hand as an OPENING BALANCE:
--       11,280 units @ $5.4326  = $61,279.75
--     Derivation (live data, 2026-07-16):
--       RDM: 20,300 purchased − 13,862 sold (12,340 scans + 1,522 bundle) = 6,438
--            WAC 68,048.76 / 20,300 = 3.35216  → value 21,581.17
--       UJC: 17,395 purchased − 12,553 sold = 4,842
--            WAC 142,618.08 / 17,395 = 8.19880 → value 39,698.58
--       Blend: 11,280 units, 61,279.75 → 5.4326/unit
--   * The opening load is flagged is_opening = true: it feeds WAC + on-hand but
--     is EXCLUDED from cashflow/total-purchased (that money was already booked
--     when the RDM/UJC loads were bought — including it would double-count).
--   * Close the RDM/UJC loads (closed = true): dropped from the on-hand view and
--     the scanner's pool dropdown, but retained for historical COGS + all-time
--     purchased totals. Their remaining is now represented by the JCM opening.
--
-- On-hand reconciliation (handled in AdminInventory/JumpstartInventory code):
--   total-purchased keeps RDM/UJC (real purchases), excludes JCM opening (transfer);
--   on-hand excludes closed RDM/UJC, includes JCM. The JCM opening qty (11,280)
--   exactly equals RDM+UJC remaining, so sold = total − remaining still ties out.
--
-- Run in Supabase Dashboard > SQL Editor.
-- Date: 2026-07-16

-- ── 1. Schema flags ─────────────────────────────────────────────────────────
ALTER TABLE loads ADD COLUMN IF NOT EXISTS closed     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS is_opening BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Seed the blended J.Crew/Madewell pool (opening balance) ───────────────
-- kind='custom' so it behaves like the other brand pools; pool_tag 'JCM' is the
-- new scan token. Dated today so it's in the pool WAC for today's show onward
-- (it does NOT touch any past date's WAC — new pool_tag).
INSERT INTO loads (id, kind, pool_tag, vendor, notes, quantity, total_cost, date, landed, is_opening)
VALUES ('JCM-OPEN', 'custom', 'JCM', 'J.Crew/Madewell',
        'Opening blend of remaining RDM+UJC on hand (carry-over, not a purchase)',
        11280, 61279.75, CURRENT_DATE, true, true)
ON CONFLICT (id) DO UPDATE
  SET quantity = EXCLUDED.quantity, total_cost = EXCLUDED.total_cost,
      pool_tag = EXCLUDED.pool_tag, is_opening = EXCLUDED.is_opening;

-- ── 3. Close the legacy RDM/UJC pools (kept for history, hidden going forward) ─
UPDATE loads SET closed = true WHERE pool_tag IN ('RDM', 'UJC');

-- ── 4. Rebuild dashboard RPC to exclude opening-balance loads from cashflow ──
-- Only the load_cost line changes (adds "AND is_opening = false"); everything
-- else is identical to kickstart-pool-wac.sql. The profitability view is
-- unchanged — 'JCM' resolves through the existing data-driven pool_wac.
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

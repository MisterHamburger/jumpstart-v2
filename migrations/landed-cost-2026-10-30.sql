-- Landed cost: a load's inventory cost = vendor cost + freight + per-load forklift.
--
-- Decision (Josh, 2026-10-30): freight and per-load forklift charges are part of
-- inventory (balance sheet) and cost of goods sold, not operating expenses. On the
-- P&L they show as their own cost-of-goods line ("Freight & Forklift") under
-- inventory cost. Applies to all of 2026. The recurring monthly forklift rental
-- stays an operating expense; only charges tied to unloading a specific load count.
--
--   loads.total_cost      vendor cost (what was paid the vendor) — unchanged meaning
--   loads.freight_cost    freight for the load (estimate until bills are linked)
--   loads.forklift_cost   forklift charges for unloading the load
--   loads.landed_cost     generated: total_cost + freight_cost + forklift_cost
--   expenses.load_id      a freight/forklift bill tied to a load (capitalized:
--   expenses.landed_type  'freight' | 'forklift'; maps to GL 5010, not OPEX)
--
-- Pool cost math: the running WAC is linear in cost, so a pool's landed WAC is
-- exactly its vendor WAC + its freight WAC. pool_wac_parts() tracks both; every
-- item, month-end inventory value and P&L line splits exactly.
--
-- Run in Supabase Dashboard > SQL Editor. Date: 2026-10-30

BEGIN;

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE loads ADD COLUMN IF NOT EXISTS freight_cost  numeric;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS forklift_cost numeric;
UPDATE loads SET freight_cost  = 0 WHERE freight_cost  IS NULL;
UPDATE loads SET forklift_cost = 0 WHERE forklift_cost IS NULL;
ALTER TABLE loads ALTER COLUMN freight_cost  SET DEFAULT 0, ALTER COLUMN freight_cost  SET NOT NULL;
ALTER TABLE loads ALTER COLUMN forklift_cost SET DEFAULT 0, ALTER COLUMN forklift_cost SET NOT NULL;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS landed_cost numeric
  GENERATED ALWAYS AS (COALESCE(total_cost, 0) + freight_cost + forklift_cost) STORED;
COMMENT ON COLUMN loads.total_cost    IS 'Vendor cost: exactly what was paid the vendor for the goods.';
COMMENT ON COLUMN loads.freight_cost  IS 'Freight for this load. Estimate until freight bills are linked (expenses.load_id), then the sum of those bills.';
COMMENT ON COLUMN loads.forklift_cost IS 'Forklift charges for unloading this load (not the monthly rental). Sum of linked forklift bills once linked.';
COMMENT ON COLUMN loads.landed_cost   IS 'Balance-sheet value of the load: vendor + freight + forklift.';

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS load_id text REFERENCES loads(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS landed_type text;
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_landed_type_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_landed_type_check
  CHECK (landed_type IS NULL OR landed_type IN ('freight', 'forklift'));
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_landed_link_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_landed_link_check
  CHECK ((load_id IS NULL) = (landed_type IS NULL));
CREATE INDEX IF NOT EXISTS expenses_load_id_idx ON expenses(load_id) WHERE load_id IS NOT NULL;
COMMENT ON COLUMN expenses.load_id IS 'Freight/forklift bill capitalized into this load (landed cost). Excluded from OPEX; GL 5010.';

-- Linked bills drive the load's freight/forklift (an entered estimate stays until a bill of that type is linked).
CREATE OR REPLACE FUNCTION sync_load_landed_costs() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ids text[] := ARRAY[]::text[];
  old_load text; old_type text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    old_load := OLD.load_id; old_type := OLD.landed_type;
    IF old_load IS NOT NULL THEN ids := ids || old_load; END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.load_id IS NOT NULL THEN ids := ids || NEW.load_id; END IF;
  -- A component with linked bills = their sum. If its last bill was just unlinked, it
  -- drops to 0 (re-enter an estimate if needed); otherwise the entered estimate stays.
  UPDATE loads l SET
    freight_cost = COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.load_id = l.id AND e.landed_type = 'freight'),
                            CASE WHEN old_load = l.id AND old_type = 'freight' THEN 0 ELSE l.freight_cost END),
    forklift_cost = COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.load_id = l.id AND e.landed_type = 'forklift'),
                            CASE WHEN old_load = l.id AND old_type = 'forklift' THEN 0 ELSE l.forklift_cost END)
  WHERE l.id = ANY(ids);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sync_load_landed_costs_trg ON expenses;
CREATE TRIGGER sync_load_landed_costs_trg
AFTER INSERT OR DELETE OR UPDATE OF load_id, landed_type, amount ON expenses
FOR EACH ROW EXECUTE FUNCTION sync_load_landed_costs();

-- Month-end freight/forklift sitting in inventory (part of inventory_value).
ALTER TABLE month_closes ADD COLUMN IF NOT EXISTS landed_cost_value numeric;
COMMENT ON COLUMN month_closes.landed_cost_value IS 'Freight/forklift included in inventory_value at month end (inventory_value is landed; vendor part = inventory_value - landed_cost_value).';

-- ── 2. Chart of accounts ────────────────────────────────────────────────────
INSERT INTO gl_accounts (code, name, type, section, sort) VALUES
  ('5010', 'Cost of Goods Sold - Freight & Forklift', 'cogs', 'Cost of Sales', 5010)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, section = EXCLUDED.section, sort = EXCLUDED.sort;
UPDATE gl_accounts SET name = 'Cost of Goods Sold - Inventory' WHERE code = '5000';

-- Explicit column list (same order as the old e.* expansion) so the view is
-- replaced in place; the two new columns are appended at the end.
CREATE OR REPLACE VIEW expenses_gl AS
SELECT e.id, e.date, e.description, e.amount, e.category, e.created_at, e.gl_account,
       CASE WHEN e.load_id IS NOT NULL THEN '5010' ELSE COALESCE(e.gl_account, r.gl_account) END AS gl_code,
       CASE WHEN e.load_id IS NOT NULL THEN 'load' WHEN e.gl_account IS NOT NULL THEN 'override' ELSE 'rule' END AS gl_source,
       r.id AS gl_rule_id,
       e.account, e.account_mask, e.load_id, e.landed_type
FROM expenses e
LEFT JOIN LATERAL (
  SELECT gr.id, gr.gl_account
  FROM gl_rules gr
  WHERE (gr.category IS NULL OR gr.category = e.category)
    AND e.description ILIKE gr.pattern
  ORDER BY gr.priority, gr.id
  LIMIT 1
) r ON true;

-- ── 3. Pool WAC engine: vendor and freight parts in one pass ───────────────
CREATE OR REPLACE FUNCTION pool_wac_parts(
  p_override_load text DEFAULT NULL,
  p_override_cost numeric DEFAULT NULL      -- replaces that load's VENDOR cost (total_cost)
)
RETURNS TABLE (pool_tag text, for_date date, vendor_cost numeric, landed_costs numeric,
               avg_cost numeric, on_hand numeric, units_sold numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record;
  cur_tag text := NULL;
  q numeric := 0;       -- units on hand
  wv numeric := NULL;   -- running vendor WAC
  wf numeric := NULL;   -- running freight/forklift WAC
BEGIN
  FOR r IN
    WITH tags AS (
      SELECT DISTINCT l.pool_tag AS tag FROM loads l WHERE l.pool_tag IS NOT NULL
    ),
    arrivals AS (
      SELECT l.pool_tag AS tag,
             COALESCE(l.landed_at, l.date) AS d,
             SUM(l.quantity)::numeric AS qty,
             SUM(CASE WHEN l.id = p_override_load THEN p_override_cost ELSE l.total_cost END)::numeric AS cost,
             SUM(l.freight_cost + l.forklift_cost)::numeric AS lc
      FROM loads l
      WHERE l.pool_tag IS NOT NULL
        AND l.date IS NOT NULL
        AND l.quantity IS NOT NULL
        AND l.quantity <> 0
        AND l.landed = true
      GROUP BY 1, 2
    ),
    sales AS (
      SELECT x.tag, x.d, SUM(x.n)::numeric AS n
      FROM (
        SELECT s.barcode AS tag, sh.date AS d, COUNT(*) AS n
        FROM jumpstart_sold_scans s
        JOIN shows sh ON sh.id = s.show_id
        WHERE s.barcode IN (SELECT tag FROM tags)
          AND sh.date IS NOT NULL
          AND COALESCE(sh.is_test, false) = false
        GROUP BY 1, 2
        UNION ALL
        SELECT s.barcode, sh.date, COUNT(*)
        FROM kickstart_sold_scans s
        JOIN shows sh ON sh.id = s.show_id
        WHERE s.barcode IN (SELECT tag FROM tags)
          AND sh.date IS NOT NULL
          AND COALESCE(sh.is_test, false) = false
        GROUP BY 1, 2
        UNION ALL
        SELECT bs.barcode, bb.sold_at::date, COUNT(*)
        FROM jumpstart_bundle_scans bs
        JOIN jumpstart_bundle_boxes bb ON bb.box_number = bs.box_number
        WHERE bs.barcode IN (SELECT tag FROM tags)
          AND bb.sold_at IS NOT NULL
          AND bb.sale_price IS NOT NULL
        GROUP BY 1, 2
        UNION ALL
        SELECT COALESCE(rb.pool_tag, 'RDM'), rb.sold_at::date, SUM(rb.quantity)
        FROM rdm_bundle_sales rb
        WHERE rb.sold_at IS NOT NULL AND rb.quantity > 0
        GROUP BY 1, 2
      ) x
      GROUP BY x.tag, x.d
    ),
    price_dates AS (
      SELECT sh.date AS d FROM shows sh WHERE sh.date IS NOT NULL
      UNION SELECT bb.sold_at::date FROM jumpstart_bundle_boxes bb WHERE bb.sold_at IS NOT NULL
      UNION SELECT rb.sold_at::date FROM rdm_bundle_sales rb WHERE rb.sold_at IS NOT NULL
      UNION SELECT CURRENT_DATE
    ),
    points AS (
      SELECT t.tag, p.d FROM tags t CROSS JOIN price_dates p
      UNION
      SELECT sa.tag, sa.d FROM sales sa
    )
    SELECT a.tag, a.d, 0 AS ord, a.qty, a.cost, a.lc, 0::numeric AS sold FROM arrivals a
    UNION ALL
    SELECT p.tag, p.d, 1, 0::numeric, 0::numeric, 0::numeric, COALESCE(sa.n, 0)
    FROM points p
    LEFT JOIN sales sa ON sa.tag = p.tag AND sa.d = p.d
    ORDER BY 1, 2, 3
  LOOP
    IF cur_tag IS DISTINCT FROM r.tag THEN
      cur_tag := r.tag; q := 0; wv := NULL; wf := NULL;
    END IF;

    IF r.ord = 0 THEN
      -- Arrival (or damage adjustment): blend with what's still on hand.
      IF q > 0 AND q + r.qty > 0 THEN
        wv := (q * wv + r.cost) / (q + r.qty);
        wf := (q * COALESCE(wf, 0) + r.lc) / (q + r.qty);
      ELSIF r.qty > 0 THEN
        wv := r.cost / r.qty;           -- sold out: reset to the new load's cost
        wf := r.lc / r.qty;
      END IF;
      q := q + r.qty;
    ELSE
      -- Price point, then that day's sales deplete the pool.
      IF wv IS NOT NULL THEN
        pool_tag := r.tag; for_date := r.d;
        vendor_cost := ROUND(wv, 4); landed_costs := ROUND(COALESCE(wf, 0), 4);
        avg_cost := ROUND(wv + COALESCE(wf, 0), 4);
        on_hand := q; units_sold := r.sold;
        RETURN NEXT;
      END IF;
      q := q - r.sold;
    END IF;
  END LOOP;
END $$;

-- Same signature as before; avg_cost is now the landed WAC (vendor + freight).
-- profitability, pool_wac_current and pool_wac_preview pick it up unchanged.
CREATE OR REPLACE FUNCTION pool_wac_schedule(
  p_override_load text DEFAULT NULL,
  p_override_cost numeric DEFAULT NULL
)
RETURNS TABLE (pool_tag text, for_date date, avg_cost numeric, on_hand numeric, units_sold numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.pool_tag, p.for_date, p.avg_cost, p.on_hand, p.units_sold
  FROM pool_wac_parts(p_override_load, p_override_cost) p;
$$;

-- Today's WAC per pool, with the split (adds columns; existing ones unchanged).
CREATE OR REPLACE VIEW pool_wac_current AS
SELECT pool_tag, avg_cost, on_hand - units_sold AS on_hand, vendor_cost, landed_costs
FROM pool_wac_parts()
WHERE for_date = CURRENT_DATE;

-- Freight/forklift portion of pool cost of goods sold in a date range (P&L line 5010
-- for open months, where COGS comes from item cost).
CREATE OR REPLACE FUNCTION landed_costs_sold(p_start date, p_end date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ROUND(COALESCE(SUM(p.landed_costs * p.units_sold), 0), 2)
  FROM pool_wac_parts() p
  WHERE p.for_date BETWEEN p_start AND p_end;
$$;

-- ── 4. Month-end inventory valuation, split vendor / freight ───────────────
DROP FUNCTION IF EXISTS pool_inventory_at(date);
CREATE FUNCTION pool_inventory_at(p_date date)
RETURNS TABLE (pool_tag text, units numeric, avg_cost numeric, value numeric, landed_costs_value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record; cur_tag text := NULL; q numeric := 0; wv numeric := NULL; wf numeric := NULL;
BEGIN
  FOR r IN
    WITH tags AS (SELECT DISTINCT l.pool_tag AS tag FROM loads l WHERE l.pool_tag IS NOT NULL),
    -- Pools whose every load is closed (RDM, UJC) were carried into JCM by the
    -- JCM-OPEN opening-balance load; from that date on their units live in JCM.
    retired AS (SELECT l.pool_tag AS tag FROM loads l WHERE l.pool_tag IS NOT NULL
                GROUP BY l.pool_tag HAVING bool_and(COALESCE(l.closed, false))),
    blend AS (SELECT COALESCE(MIN(COALESCE(l.landed_at, l.date)), DATE '9999-12-31') AS d
              FROM loads l WHERE l.id = 'JCM-OPEN'),
    arrivals AS (
      SELECT l.pool_tag AS tag, COALESCE(l.landed_at, l.date) AS d,
             SUM(l.quantity)::numeric AS qty, SUM(l.total_cost)::numeric AS cost,
             SUM(l.freight_cost + l.forklift_cost)::numeric AS lc
      FROM loads l
      WHERE l.pool_tag IS NOT NULL AND l.date IS NOT NULL AND l.quantity IS NOT NULL
        AND l.quantity <> 0 AND l.landed = true AND COALESCE(l.landed_at, l.date) <= p_date
      GROUP BY 1, 2
    ),
    sales AS (
      SELECT x.tag, x.d, SUM(x.n)::numeric AS n FROM (
        SELECT s.barcode AS tag, sh.date AS d, COUNT(*) AS n
        FROM jumpstart_sold_scans s JOIN shows sh ON sh.id = s.show_id
        WHERE s.barcode IN (SELECT tag FROM tags) AND sh.date <= p_date AND COALESCE(sh.is_test, false) = false
        GROUP BY 1, 2
        UNION ALL
        SELECT s.barcode, sh.date, COUNT(*)
        FROM kickstart_sold_scans s JOIN shows sh ON sh.id = s.show_id
        WHERE s.barcode IN (SELECT tag FROM tags) AND sh.date <= p_date AND COALESCE(sh.is_test, false) = false
        GROUP BY 1, 2
        UNION ALL
        SELECT bs.barcode, bb.sold_at::date, COUNT(*)
        FROM jumpstart_bundle_scans bs JOIN jumpstart_bundle_boxes bb ON bb.box_number = bs.box_number
        WHERE bs.barcode IN (SELECT tag FROM tags) AND bb.sold_at::date <= p_date AND bb.sale_price IS NOT NULL
        GROUP BY 1, 2
        UNION ALL
        SELECT COALESCE(rb.pool_tag, 'RDM'), rb.sold_at::date, SUM(rb.quantity)
        FROM rdm_bundle_sales rb
        WHERE rb.sold_at::date <= p_date AND rb.quantity > 0
        GROUP BY 1, 2
      ) x GROUP BY x.tag, x.d
    )
    SELECT a.tag, a.d, 0 AS ord, a.qty, a.cost, a.lc, 0::numeric AS sold FROM arrivals a
    UNION ALL
    SELECT sa.tag, sa.d, 1, 0::numeric, 0::numeric, 0::numeric, sa.n FROM sales sa
    UNION ALL
    SELECT t.tag, p_date, 2, 0::numeric, 0::numeric, 0::numeric, 0::numeric FROM tags t   -- end-of-day marker
    WHERE NOT (t.tag IN (SELECT tag FROM retired) AND p_date >= (SELECT d FROM blend))
    ORDER BY 1, 2, 3
  LOOP
    IF cur_tag IS DISTINCT FROM r.tag THEN cur_tag := r.tag; q := 0; wv := NULL; wf := NULL; END IF;
    IF r.ord = 0 THEN
      IF q > 0 AND q + r.qty > 0 THEN
        wv := (q * wv + r.cost) / (q + r.qty);
        wf := (q * COALESCE(wf, 0) + r.lc) / (q + r.qty);
      ELSIF r.qty > 0 THEN
        wv := r.cost / r.qty; wf := r.lc / r.qty;
      END IF;
      q := q + r.qty;
    ELSIF r.ord = 1 THEN
      q := q - r.sold;
    ELSE
      pool_tag := r.tag; units := q;
      avg_cost := ROUND(COALESCE(wv, 0) + COALESCE(wf, 0), 4);
      value := ROUND(GREATEST(q, 0) * (COALESCE(wv, 0) + COALESCE(wf, 0)), 2);
      landed_costs_value := ROUND(GREATEST(q, 0) * COALESCE(wf, 0), 2);
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;

-- Paid-for pool loads not yet landed at p_date (owned, in transit), at landed cost.
DROP FUNCTION IF EXISTS in_transit_inventory_at(date);
CREATE FUNCTION in_transit_inventory_at(p_date date)
RETURNS TABLE (load_id text, pool_tag text, units numeric, value numeric, landed_costs_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT l.id, l.pool_tag, l.quantity::numeric, l.landed_cost::numeric,
         (l.freight_cost + l.forklift_cost)::numeric
  FROM loads l
  WHERE l.pool_tag IS NOT NULL AND COALESCE(l.is_opening, false) = false
    AND l.date <= p_date
    AND (l.landed = false OR COALESCE(l.landed_at, l.date) > p_date);
$$;

-- Manifested (per-barcode) loads: manifest cost on hand, plus the loads'
-- freight/forklift in the same proportion as the manifest cost still on hand.
DROP FUNCTION IF EXISTS manifested_inventory_at(date);
CREATE FUNCTION manifested_inventory_at(p_date date)
RETURNS TABLE (landed_cost numeric, sold_cost numeric, value numeric, landed_costs_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH landed AS (
    SELECT COALESCE(SUM(m.cost_freight), 0)::numeric AS c
    FROM jumpstart_manifest m JOIN loads l ON l.id = m.load_id
    WHERE l.kind = 'manifested' AND COALESCE(l.landed_at, l.date) <= p_date
  ),
  lc AS (
    SELECT COALESCE(SUM(l.freight_cost + l.forklift_cost), 0)::numeric AS f
    FROM loads l
    WHERE l.kind = 'manifested' AND COALESCE(l.landed_at, l.date) <= p_date
  ),
  sold AS (
    SELECT COALESCE(SUM(p.cost_freight), 0)::numeric AS c
    FROM profitability p
    WHERE p.show_date <= p_date AND p.item_status = 'valid'
      AND COALESCE(p.is_wac_cost, false) = false AND COALESCE(p.is_custom_cost, false) = false
      AND p.barcode IN (SELECT barcode FROM jumpstart_manifest)
  ),
  v AS (SELECT landed.c AS c, sold.c AS s, GREATEST(landed.c - sold.c, 0) AS vendor_left, lc.f AS f FROM landed, sold, lc)
  SELECT v.c, v.s,
         v.vendor_left + ROUND(CASE WHEN v.c > 0 THEN v.f * v.vendor_left / v.c ELSE 0 END, 2),
         ROUND(CASE WHEN v.c > 0 THEN v.f * v.vendor_left / v.c ELSE 0 END, 2)
  FROM v;
$$;

-- Freight/forklift sitting in all inventory at p_date (used to restate and close months).
CREATE OR REPLACE FUNCTION landed_costs_inventory_at(p_date date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ROUND(
      COALESCE((SELECT SUM(landed_costs_value) FROM pool_inventory_at(p_date) WHERE units <> 0), 0)
    + COALESCE((SELECT SUM(landed_costs_value) FROM in_transit_inventory_at(p_date)), 0)
    + COALESCE((SELECT landed_costs_value FROM manifested_inventory_at(p_date)), 0), 2);
$$;

-- ── 5. Dashboard RPC: linked bills are inventory, not OPEX; load cash at landed cost ──
-- Identical to migrations/dashboard-cleanup-2026-10-16.sql except the three
-- statements marked LANDED.
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

COMMIT;
NOTIFY pgrst, 'reload schema';

-- Verify (before any freight is entered, every number matches pre-migration):
--   SELECT pool_tag, avg_cost, vendor_cost, landed_costs FROM pool_wac_current;   -- landed_costs all 0
--   SELECT landed_costs_inventory_at(CURRENT_DATE);                               -- 0
--   SELECT code, name FROM gl_accounts WHERE code IN ('5000','5010');

-- Landed cost, part 2: freight/forklift bills count from the day they're PAID.
--
-- Books are cash basis: a bill paid after its load landed (e.g. October forklift for a
-- September load) can't be inventory before it was paid. Linked bills now join the
-- pool on max(bill date, landing date) — raising the cost of units still on hand —
-- instead of being back-dated to the landing. Freight/forklift that is still only an
-- estimate (no bill linked) applies at landing as before. If a pool is sold out when a
-- bill is paid, the bill goes straight to cost of goods sold in the books (GL 5010).
--
-- Run in Supabase Dashboard > SQL Editor after landed-cost-2026-10-30.sql. Date: 2026-10-30

BEGIN;

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
    billed AS (
      SELECT e.load_id, SUM(e.amount) AS amt FROM expenses e WHERE e.load_id IS NOT NULL GROUP BY 1
    ),
    -- Loads land with their vendor cost + any freight/forklift still only estimated;
    -- each linked bill joins the pool on the day it was paid (not before landing).
    arrivals AS (
      SELECT x.tag, x.d, SUM(x.qty)::numeric AS qty, SUM(x.cost)::numeric AS cost, SUM(x.lc)::numeric AS lc
      FROM (
        SELECT l.pool_tag AS tag, COALESCE(l.landed_at, l.date) AS d, l.quantity AS qty,
               CASE WHEN l.id = p_override_load THEN p_override_cost ELSE l.total_cost END AS cost,
               GREATEST(l.freight_cost + l.forklift_cost - COALESCE(b.amt, 0), 0) AS lc
        FROM loads l LEFT JOIN billed b ON b.load_id = l.id
        WHERE l.pool_tag IS NOT NULL AND l.date IS NOT NULL AND l.quantity IS NOT NULL
          AND l.quantity <> 0 AND l.landed = true
        UNION ALL
        SELECT l.pool_tag, GREATEST(e.date, COALESCE(l.landed_at, l.date)), 0, 0, e.amount
        FROM expenses e JOIN loads l ON l.id = e.load_id
        WHERE l.pool_tag IS NOT NULL AND l.date IS NOT NULL AND l.quantity IS NOT NULL
          AND l.quantity <> 0 AND l.landed = true
      ) x
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


CREATE OR REPLACE FUNCTION pool_inventory_at(p_date date)
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
    billed AS (
      SELECT e.load_id, SUM(e.amount) AS amt FROM expenses e WHERE e.load_id IS NOT NULL GROUP BY 1
    ),
    arrivals AS (
      SELECT x.tag, x.d, SUM(x.qty)::numeric AS qty, SUM(x.cost)::numeric AS cost, SUM(x.lc)::numeric AS lc
      FROM (
        SELECT l.pool_tag AS tag, COALESCE(l.landed_at, l.date) AS d, l.quantity AS qty, l.total_cost AS cost,
               GREATEST(l.freight_cost + l.forklift_cost - COALESCE(b.amt, 0), 0) AS lc
        FROM loads l LEFT JOIN billed b ON b.load_id = l.id
        WHERE l.pool_tag IS NOT NULL AND l.date IS NOT NULL AND l.quantity IS NOT NULL
          AND l.quantity <> 0 AND l.landed = true
        UNION ALL
        SELECT l.pool_tag, GREATEST(e.date, COALESCE(l.landed_at, l.date)), 0, 0, e.amount
        FROM expenses e JOIN loads l ON l.id = e.load_id
        WHERE l.pool_tag IS NOT NULL AND l.date IS NOT NULL AND l.quantity IS NOT NULL
          AND l.quantity <> 0 AND l.landed = true
      ) x
      WHERE x.d <= p_date
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


-- In transit: estimated freight at cost; billed freight only once paid.
CREATE OR REPLACE FUNCTION in_transit_inventory_at(p_date date)
RETURNS TABLE (load_id text, pool_tag text, units numeric, value numeric, landed_costs_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH lc AS (
    SELECT l.id,
           GREATEST(l.freight_cost + l.forklift_cost
                    - COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.load_id = l.id), 0), 0)
           + COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.load_id = l.id AND e.date <= p_date), 0) AS f
    FROM loads l
  )
  SELECT l.id, l.pool_tag, l.quantity::numeric, (COALESCE(l.total_cost, 0) + lc.f)::numeric, lc.f::numeric
  FROM loads l JOIN lc ON lc.id = l.id
  WHERE l.pool_tag IS NOT NULL AND COALESCE(l.is_opening, false) = false
    AND l.date <= p_date
    AND (l.landed = false OR COALESCE(l.landed_at, l.date) > p_date);
$$;

-- Manifested loads: same rule for their freight/forklift.
CREATE OR REPLACE FUNCTION manifested_inventory_at(p_date date)
RETURNS TABLE (landed_cost numeric, sold_cost numeric, value numeric, landed_costs_value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH landed AS (
    SELECT COALESCE(SUM(m.cost_freight), 0)::numeric AS c
    FROM jumpstart_manifest m JOIN loads l ON l.id = m.load_id
    WHERE l.kind = 'manifested' AND COALESCE(l.landed_at, l.date) <= p_date
  ),
  lc AS (
    SELECT COALESCE(SUM(
             GREATEST(l.freight_cost + l.forklift_cost
                      - COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.load_id = l.id), 0), 0)
             + COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.load_id = l.id AND e.date <= p_date), 0)
           ), 0)::numeric AS f
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

COMMIT;
NOTIFY pgrst, 'reload schema';

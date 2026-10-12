-- Fix: pool_inventory_at double-counted the retired RDM/UJC pools.
--
-- On 2026-07-16 RDM + UJC (all loads closed=true) were carried into the JCM
-- pool via the JCM-OPEN opening-balance load (11,280 units). pool_inventory_at
-- kept valuing RDM/UJC's leftover units after that date as well, so any
-- month-end from July on was ~$65K too high. Retired pools are now dropped
-- from the end-of-day result on/after JCM-OPEN's landing date; earlier
-- month-ends (when RDM/UJC were live and JCM-OPEN didn't exist) are unchanged.
--
-- Run in Supabase Dashboard > SQL Editor.
-- Date: 2026-10-12

CREATE OR REPLACE FUNCTION pool_inventory_at(p_date date)
RETURNS TABLE (pool_tag text, units numeric, avg_cost numeric, value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record; cur_tag text := NULL; q numeric := 0; w numeric := NULL;
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
             SUM(l.quantity)::numeric AS qty, SUM(l.total_cost)::numeric AS cost
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
    SELECT a.tag, a.d, 0 AS ord, a.qty, a.cost, 0::numeric AS sold FROM arrivals a
    UNION ALL
    SELECT sa.tag, sa.d, 1, 0::numeric, 0::numeric, sa.n FROM sales sa
    UNION ALL
    SELECT t.tag, p_date, 2, 0::numeric, 0::numeric, 0::numeric FROM tags t   -- end-of-day marker
    WHERE NOT (t.tag IN (SELECT tag FROM retired) AND p_date >= (SELECT d FROM blend))
    ORDER BY 1, 2, 3
  LOOP
    IF cur_tag IS DISTINCT FROM r.tag THEN cur_tag := r.tag; q := 0; w := NULL; END IF;
    IF r.ord = 0 THEN
      IF q > 0 AND q + r.qty > 0 THEN w := (q * w + r.cost) / (q + r.qty);
      ELSIF r.qty > 0 THEN w := r.cost / r.qty; END IF;
      q := q + r.qty;
    ELSIF r.ord = 1 THEN
      q := q - r.sold;
    ELSE
      pool_tag := r.tag; units := q; avg_cost := ROUND(COALESCE(w, 0), 4);
      value := ROUND(GREATEST(q, 0) * COALESCE(w, 0), 2);
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;


NOTIFY pgrst, 'reload schema';

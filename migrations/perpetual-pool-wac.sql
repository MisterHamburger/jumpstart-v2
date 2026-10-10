-- Perpetual (running) pool WAC — replaces the all-time cumulative average.
--
-- Background (Josh, 2026-10-09): pool WAC was SUM(total_cost)/SUM(quantity)
-- over EVERY landed load ever, so loads that sold out months ago kept diluting
-- (or inflating) the cost of today's stock. Example: 100 Cozy Earth @ $5 all
-- sell, then 100 arrive @ $6 — the old formula said $5.50; the true cost is $6.
-- Live data showed this understated pool COGS by ~$38.5K (JCM alone ~$32K).
--
-- The right method is a perpetual moving average, driven by two levers:
--   1) Sales deplete on-hand units (the WAC itself is unchanged by a sale).
--   2) A newly landed load blends ONLY with the units still on hand:
--        new WAC = (on_hand × WAC + load_cost) / (on_hand + load_qty)
--      If the pool is sold out (on_hand ≤ 0), the WAC resets to the new load's
--      unit cost.
-- Damage adjustment loads (negative qty, −$1/unit) are the same formula, so
-- shrinkage still raises the WAC on the units that remain.
--
-- Same-day convention (unchanged): loads that land on day D are available to
-- D's sales; all of D's sales cost at the WAC after D's arrivals.
-- Depletion = every non-test pool-token scan (both channels) + pool bundle-box
-- scans + rdm_bundle_sales units (bulk/off-platform/damage-out) — the same
-- units the Inventory tab deducts.
--
-- Full history is restated (that's the point — past COGS was understated).
-- Consequently the JCM opening balance (JCM-OPEN, 11,280 units carried over
-- from RDM+UJC on 2026-07-16) is re-valued at those pools' perpetual WACs
-- instead of their cumulative ones: was $61,279.75 (@ $5.4326).
--
-- Also adds:
--   * pool_wac_current      — today's WAC per pool (Inventory tab, off-platform
--                             sale / damage-out previews, Jumpstart inventory).
--   * pool_wac_preview(id, cost) — before/after WAC + exact COGS restatement
--                             for the load-cost editor.
--
-- Run in Supabase Dashboard > SQL Editor (one transaction).
-- Date: 2026-10-09

BEGIN;

-- ── 1. The running-WAC engine ───────────────────────────────────────────────
-- One row per (pool, date) we need a cost for: show dates, bundle-sale dates,
-- every pool sale date, and today. on_hand = units on hand at the start of
-- that day's sales (after that day's arrivals); units_sold = that day's sales.
-- Optional override swaps one load's total_cost (used by pool_wac_preview).
CREATE OR REPLACE FUNCTION pool_wac_schedule(
  p_override_load text DEFAULT NULL,
  p_override_cost numeric DEFAULT NULL
)
RETURNS TABLE (pool_tag text, for_date date, avg_cost numeric, on_hand numeric, units_sold numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record;
  cur_tag text := NULL;
  q numeric := 0;      -- units on hand
  w numeric := NULL;   -- running WAC
BEGIN
  FOR r IN
    WITH tags AS (
      SELECT DISTINCT l.pool_tag AS tag FROM loads l WHERE l.pool_tag IS NOT NULL
    ),
    arrivals AS (
      SELECT l.pool_tag AS tag,
             COALESCE(l.landed_at, l.date) AS d,
             SUM(l.quantity)::numeric AS qty,
             SUM(CASE WHEN l.id = p_override_load THEN p_override_cost ELSE l.total_cost END)::numeric AS cost
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
    SELECT a.tag, a.d, 0 AS ord, a.qty, a.cost, 0::numeric AS sold FROM arrivals a
    UNION ALL
    SELECT p.tag, p.d, 1, 0::numeric, 0::numeric, COALESCE(sa.n, 0)
    FROM points p
    LEFT JOIN sales sa ON sa.tag = p.tag AND sa.d = p.d
    ORDER BY 1, 2, 3
  LOOP
    IF cur_tag IS DISTINCT FROM r.tag THEN
      cur_tag := r.tag; q := 0; w := NULL;
    END IF;

    IF r.ord = 0 THEN
      -- Arrival (or damage adjustment): blend with what's still on hand.
      IF q > 0 AND q + r.qty > 0 THEN
        w := (q * w + r.cost) / (q + r.qty);
      ELSIF r.qty > 0 THEN
        w := r.cost / r.qty;           -- sold out: reset to the new load's cost
      END IF;
      q := q + r.qty;
    ELSE
      -- Price point, then that day's sales deplete the pool.
      IF w IS NOT NULL THEN
        pool_tag := r.tag; for_date := r.d; avg_cost := ROUND(w, 4);
        on_hand := q; units_sold := r.sold;
        RETURN NEXT;
      END IF;
      q := q - r.sold;
    END IF;
  END LOOP;
END $$;

-- ── 2. Today's WAC per pool ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW pool_wac_current AS
SELECT pool_tag, avg_cost, on_hand - units_sold AS on_hand
FROM pool_wac_schedule()
WHERE for_date = CURRENT_DATE;

-- ── 3. Load-cost editor preview ─────────────────────────────────────────────
-- What today's pool WAC and the pool's total booked COGS become if p_load_id's
-- total_cost is set to p_new_cost.
CREATE OR REPLACE FUNCTION pool_wac_preview(p_load_id text, p_new_cost numeric)
RETURNS TABLE (pool_tag text, wac_before numeric, wac_after numeric,
               units_sold numeric, cogs_before numeric, cogs_after numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH t AS (SELECT l.pool_tag AS tag FROM loads l WHERE l.id = p_load_id),
  b AS (SELECT * FROM pool_wac_schedule() s WHERE s.pool_tag = (SELECT tag FROM t)),
  a AS (SELECT * FROM pool_wac_schedule(p_load_id, p_new_cost) s WHERE s.pool_tag = (SELECT tag FROM t))
  SELECT
    (SELECT tag FROM t),
    (SELECT b.avg_cost FROM b WHERE b.for_date = CURRENT_DATE),
    (SELECT a.avg_cost FROM a WHERE a.for_date = CURRENT_DATE),
    (SELECT COALESCE(SUM(b.units_sold), 0) FROM b),
    (SELECT ROUND(COALESCE(SUM(b.avg_cost * b.units_sold), 0), 2) FROM b),
    (SELECT ROUND(COALESCE(SUM(a.avg_cost * a.units_sold), 0), 2) FROM a);
$$;

-- ── 4. Re-value the JCM opening balance at RDM/UJC perpetual WAC ────────────
-- Remaining RDM/UJC units at the 2026-07-16 blend × each pool's running WAC.
DO $$
DECLARE units numeric; val numeric;
BEGIN
  SELECT SUM(x.on_hand - x.units_sold), ROUND(SUM((x.on_hand - x.units_sold) * x.avg_cost), 2)
    INTO units, val
  FROM (
    SELECT DISTINCT ON (s.pool_tag) s.*
    FROM pool_wac_schedule() s
    WHERE s.pool_tag IN ('RDM', 'UJC') AND s.for_date <= DATE '2026-07-16'
    ORDER BY s.pool_tag, s.for_date DESC
  ) x;
  IF units IS DISTINCT FROM 11280 THEN
    RAISE EXCEPTION 'JCM-OPEN re-value aborted: RDM+UJC remaining = % (expected 11,280)', units;
  END IF;
  UPDATE loads SET total_cost = val WHERE id = 'JCM-OPEN';
  RAISE NOTICE 'JCM-OPEN re-valued: 11,280 units = $% ($%/unit; was $61,279.75)', val, ROUND(val / 11280, 4);
END $$;

-- ── 5. Profitability view: pool_wac now comes from the running engine ───────
CREATE OR REPLACE VIEW profitability AS

WITH pool_tags AS (
  SELECT DISTINCT pool_tag FROM loads WHERE pool_tag IS NOT NULL
),
kickstart_show_wac_raw AS (
  SELECT s.show_id, ROUND(AVG(COALESCE(k.true_cost, k.cost, k2.true_cost, k2.cost)), 2) AS avg_cost, 1 AS priority
  FROM kickstart_sold_scans s
  LEFT JOIN kickstart_intake k ON k.id = s.intake_id
  LEFT JOIN (
    SELECT DISTINCT ON (upc) *
    FROM kickstart_intake
    WHERE upc IS NOT NULL AND upc != ''
    ORDER BY upc, id
  ) k2 ON s.intake_id IS NULL AND s.barcode = k2.upc
  WHERE COALESCE(k.true_cost, k.cost, k2.true_cost, k2.cost) IS NOT NULL
  GROUP BY s.show_id

  UNION ALL

  SELECT 38, 15.50, 0
  UNION ALL SELECT 40, 15.50, 0
  UNION ALL SELECT 41, 15.50, 0
),
kickstart_show_wac AS (
  SELECT DISTINCT ON (show_id) show_id, avg_cost
  FROM kickstart_show_wac_raw
  ORDER BY show_id, priority
),
jumpstart_show_wac AS (
  SELECT s.show_id, ROUND(AVG(m.cost_freight), 4) AS avg_cost
  FROM jumpstart_sold_scans s
  LEFT JOIN (
    SELECT DISTINCT ON (barcode) *
    FROM jumpstart_manifest
    ORDER BY barcode, id
  ) m ON s.barcode = m.barcode
  WHERE m.cost_freight IS NOT NULL
    AND s.barcode NOT IN (SELECT pool_tag FROM pool_tags)
  GROUP BY s.show_id
),
-- Perpetual (running) WAC per pool token, from pool_wac_schedule(): sales
-- deplete the pool, and each new landed load re-blends ONLY with the units
-- still on hand. Sold-out history no longer drags the WAC.
pool_wac AS (
  SELECT pool_tag, for_date, avg_cost FROM pool_wac_schedule()
)

-- JUMPSTART: Whatnot live sales
SELECT
  s.id AS scan_id,
  s.barcode,
  si.listing_number::text AS listing_number,
  sh.name AS show_name,
  sh.date AS show_date,
  sh.time_of_day,
  sh.channel,
  m.description,
  m.category,
  m.msrp,
  m.cost,
  COALESCE(
    pw.avg_cost,
    m.cost_freight,
    si.custom_item_cost,
    sh.custom_item_cost,
    jwac.avg_cost
  ) AS cost_freight,
  m.zone::text AS zone,
  si.product_name,
  si.buyer_paid,
  si.coupon_code,
  si.coupon_amount,
  si.original_hammer,
  si.status AS item_status,
  -- is_bad_barcode: not a pool scan, and nothing resolved at all
  (s.barcode NOT IN (SELECT pool_tag FROM pool_tags)
    AND m.barcode IS NULL
    AND si.custom_item_cost IS NULL
    AND sh.custom_item_cost IS NULL
    AND jwac.avg_cost IS NULL) AS is_bad_barcode,
  false AS is_bundle,
  -- is_wac_cost: only the show-WAC fallback resolved (no pool, no manifest, no custom)
  (s.barcode NOT IN (SELECT pool_tag FROM pool_tags)
    AND m.barcode IS NULL
    AND si.custom_item_cost IS NULL
    AND sh.custom_item_cost IS NULL
    AND jwac.avg_cost IS NOT NULL) AS is_wac_cost,
  -- is_custom_cost: per-item or per-show custom cost resolved (no pool, no manifest)
  (s.barcode NOT IN (SELECT pool_tag FROM pool_tags)
    AND m.barcode IS NULL
    AND (si.custom_item_cost IS NOT NULL OR sh.custom_item_cost IS NOT NULL)
  ) AS is_custom_cost,
  ROUND(si.buyer_paid * 0.072, 2) AS commission,
  ROUND(si.buyer_paid * 0.051, 2) AS processing_fee,
  ROUND(si.buyer_paid * 0.123, 2) AS total_fees,
  ROUND(si.buyer_paid - si.buyer_paid * 0.123, 2) AS net_payout,
  ROUND(
    si.buyer_paid - si.buyer_paid * 0.123
    - COALESCE(
        pw.avg_cost,
        m.cost_freight,
        si.custom_item_cost,
        sh.custom_item_cost,
        jwac.avg_cost,
        0
      ),
    2
  ) AS profit,
  CASE
    WHEN si.buyer_paid > 0 THEN
      ROUND(
        ((si.buyer_paid - si.buyer_paid * 0.123
          - COALESCE(
              pw.avg_cost,
              m.cost_freight,
              si.custom_item_cost,
              sh.custom_item_cost,
              jwac.avg_cost,
              0
            ))
         / si.buyer_paid) * 100,
        1
      )
    ELSE 0
  END AS margin
FROM jumpstart_sold_scans s
JOIN show_items si ON s.show_id = si.show_id AND s.listing_number = si.listing_number
JOIN shows sh ON s.show_id = sh.id
LEFT JOIN (
  SELECT DISTINCT ON (barcode) *
  FROM jumpstart_manifest
  ORDER BY barcode, id
) m ON s.barcode = m.barcode
LEFT JOIN jumpstart_show_wac jwac ON jwac.show_id = s.show_id
LEFT JOIN pool_wac pw ON pw.pool_tag = s.barcode AND pw.for_date = sh.date
WHERE si.status = 'valid'
  AND COALESCE(sh.is_test, false) = false

UNION ALL

-- KICKSTART: Whatnot live sales.
-- Now resolves shared-pool COGS (pool_wac) and 099-manifest cost exactly like
-- Jumpstart, prepended to the historical intake/true_cost/custom fallback chain.
SELECT
  s.id AS scan_id,
  s.barcode,
  si.listing_number::text AS listing_number,
  sh.name AS show_name,
  sh.date AS show_date,
  sh.time_of_day,
  sh.channel,
  COALESCE(k.description, k2.description, m.description) AS description,
  COALESCE(k.brand, k2.brand, m.category) AS category,
  COALESCE(k.msrp, k2.msrp, m.msrp) AS msrp,
  COALESCE(k.true_cost, k.cost, k2.true_cost, k2.cost, si.custom_item_cost, sh.custom_item_cost, wac.avg_cost) AS cost,
  COALESCE(pw.avg_cost, m.cost_freight, k.true_cost, k.cost, k2.true_cost, k2.cost, si.custom_item_cost, sh.custom_item_cost, wac.avg_cost, 0) AS cost_freight,
  NULL::text AS zone,
  si.product_name,
  si.buyer_paid,
  si.coupon_code,
  si.coupon_amount,
  si.original_hammer,
  si.status AS item_status,
  -- is_bad_barcode: not a pool scan, no manifest, no intake, no custom, no show-WAC
  (s.barcode NOT IN (SELECT pool_tag FROM pool_tags)
    AND m.barcode IS NULL
    AND k.id IS NULL AND k2.id IS NULL
    AND si.custom_item_cost IS NULL
    AND sh.custom_item_cost IS NULL
    AND wac.avg_cost IS NULL) AS is_bad_barcode,
  false AS is_bundle,
  (s.barcode NOT IN (SELECT pool_tag FROM pool_tags)
    AND m.barcode IS NULL
    AND k.id IS NULL AND k2.id IS NULL
    AND si.custom_item_cost IS NULL
    AND sh.custom_item_cost IS NULL
    AND wac.avg_cost IS NOT NULL) AS is_wac_cost,
  (s.barcode NOT IN (SELECT pool_tag FROM pool_tags)
    AND m.barcode IS NULL
    AND k.id IS NULL AND k2.id IS NULL
    AND (si.custom_item_cost IS NOT NULL OR sh.custom_item_cost IS NOT NULL)
  ) AS is_custom_cost,
  ROUND(si.buyer_paid * 0.072, 2) AS commission,
  ROUND(si.buyer_paid * 0.051, 2) AS processing_fee,
  ROUND(si.buyer_paid * 0.123, 2) AS total_fees,
  ROUND(si.buyer_paid - si.buyer_paid * 0.123, 2) AS net_payout,
  ROUND(
    si.buyer_paid - si.buyer_paid * 0.123
    - COALESCE(pw.avg_cost, m.cost_freight, k.true_cost, k.cost, k2.true_cost, k2.cost, si.custom_item_cost, sh.custom_item_cost, wac.avg_cost, 0),
    2
  ) AS profit,
  CASE
    WHEN si.buyer_paid > 0 THEN
      ROUND(
        ((si.buyer_paid - si.buyer_paid * 0.123
          - COALESCE(pw.avg_cost, m.cost_freight, k.true_cost, k.cost, k2.true_cost, k2.cost, si.custom_item_cost, sh.custom_item_cost, wac.avg_cost, 0))
         / si.buyer_paid) * 100,
        1
      )
    ELSE 0
  END AS margin
FROM kickstart_sold_scans s
JOIN show_items si ON s.show_id = si.show_id AND s.listing_number::integer = si.listing_number
JOIN shows sh ON s.show_id = sh.id
LEFT JOIN kickstart_intake k ON k.id = s.intake_id
LEFT JOIN (
  SELECT DISTINCT ON (upc) *
  FROM kickstart_intake
  WHERE upc IS NOT NULL AND upc != ''
  ORDER BY upc, id
) k2 ON s.intake_id IS NULL AND s.barcode = k2.upc
LEFT JOIN kickstart_show_wac wac ON wac.show_id = s.show_id
LEFT JOIN (
  SELECT DISTINCT ON (barcode) *
  FROM jumpstart_manifest
  ORDER BY barcode, id
) m ON s.barcode = m.barcode
LEFT JOIN pool_wac pw ON pw.pool_tag = s.barcode AND pw.for_date = sh.date
WHERE si.status = 'valid'
  AND COALESCE(sh.is_test, false) = false

UNION ALL

-- JUMPSTART BUNDLES: generalized pool WAC (was uw_rdm/uw_ujc)
SELECT
  bs.id AS scan_id,
  bs.barcode,
  ('B' || bb.box_number)::text AS listing_number,
  'Bundle Box ' || bb.box_number AS show_name,
  bb.sold_at::date AS show_date,
  NULL::text AS time_of_day,
  'Jumpstart' AS channel,
  m.description,
  m.category,
  m.msrp,
  m.cost,
  COALESCE(
    pw.avg_cost,
    m.cost_freight,
    m.cost,
    0
  ) + (COALESCE(bb.shipping_cost, 0) / NULLIF(item_counts.cnt, 0)) AS cost_freight,
  m.zone::text AS zone,
  m.description AS product_name,
  ROUND((bb.sale_price + COALESCE(bb.shipping_charged, 0)) / NULLIF(item_counts.cnt, 0), 2) AS buyer_paid,
  NULL::text AS coupon_code,
  NULL::numeric AS coupon_amount,
  ROUND((bb.sale_price + COALESCE(bb.shipping_charged, 0)) / NULLIF(item_counts.cnt, 0), 2) AS original_hammer,
  'valid' AS item_status,
  false AS is_bad_barcode,
  true AS is_bundle,
  false AS is_wac_cost,
  false AS is_custom_cost,
  0::numeric AS commission,
  0::numeric AS processing_fee,
  0::numeric AS total_fees,
  ROUND((bb.sale_price + COALESCE(bb.shipping_charged, 0)) / NULLIF(item_counts.cnt, 0), 2) AS net_payout,
  ROUND(
    (bb.sale_price + COALESCE(bb.shipping_charged, 0)) / NULLIF(item_counts.cnt, 0)
    - COALESCE(
        pw.avg_cost,
        m.cost_freight,
        m.cost,
        0
      )
    - (COALESCE(bb.shipping_cost, 0) / NULLIF(item_counts.cnt, 0)),
    2
  ) AS profit,
  CASE
    WHEN (bb.sale_price + COALESCE(bb.shipping_charged, 0)) > 0 THEN
      ROUND(
        (((bb.sale_price + COALESCE(bb.shipping_charged, 0)) / NULLIF(item_counts.cnt, 0)
          - COALESCE(
              pw.avg_cost,
              m.cost_freight,
              m.cost,
              0
            )
          - (COALESCE(bb.shipping_cost, 0) / NULLIF(item_counts.cnt, 0)))
         / ((bb.sale_price + COALESCE(bb.shipping_charged, 0)) / NULLIF(item_counts.cnt, 0))) * 100,
        1
      )
    ELSE 0
  END AS margin
FROM jumpstart_bundle_scans bs
JOIN jumpstart_bundle_boxes bb ON bs.box_number = bb.box_number
JOIN (
  SELECT box_number, COUNT(*) AS cnt
  FROM jumpstart_bundle_scans
  GROUP BY box_number
) item_counts ON item_counts.box_number = bs.box_number
LEFT JOIN (
  SELECT DISTINCT ON (barcode) *
  FROM jumpstart_manifest
  ORDER BY barcode, id
) m ON bs.barcode = m.barcode
LEFT JOIN pool_wac pw ON pw.pool_tag = bs.barcode AND pw.for_date = bb.sold_at::date
WHERE bb.sold_at IS NOT NULL AND bb.sale_price IS NOT NULL

UNION ALL

-- KICKSTART BUNDLES: unchanged
SELECT
  bs.id AS scan_id,
  ki.upc AS barcode,
  ('B' || bb.box_number)::text AS listing_number,
  'Bundle Box ' || bb.box_number AS show_name,
  bb.sold_at::date AS show_date,
  NULL::text AS time_of_day,
  'Kickstart' AS channel,
  ki.description,
  ki.brand AS category,
  ki.msrp,
  COALESCE(ki.true_cost, ki.cost, 0) AS cost,
  COALESCE(ki.true_cost, ki.cost, 0) + (COALESCE(bb.shipping_cost, 0) / NULLIF(item_counts.cnt, 0)) AS cost_freight,
  NULL::text AS zone,
  ki.description AS product_name,
  ROUND((bb.sale_price + COALESCE(bb.shipping_charged, 0)) / NULLIF(item_counts.cnt, 0), 2) AS buyer_paid,
  NULL::text AS coupon_code,
  NULL::numeric AS coupon_amount,
  ROUND((bb.sale_price + COALESCE(bb.shipping_charged, 0)) / NULLIF(item_counts.cnt, 0), 2) AS original_hammer,
  'valid' AS item_status,
  false AS is_bad_barcode,
  true AS is_bundle,
  false AS is_wac_cost,
  false AS is_custom_cost,
  0::numeric AS commission,
  0::numeric AS processing_fee,
  0::numeric AS total_fees,
  ROUND((bb.sale_price + COALESCE(bb.shipping_charged, 0)) / NULLIF(item_counts.cnt, 0), 2) AS net_payout,
  ROUND(
    (bb.sale_price + COALESCE(bb.shipping_charged, 0)) / NULLIF(item_counts.cnt, 0)
    - COALESCE(ki.true_cost, ki.cost, 0)
    - (COALESCE(bb.shipping_cost, 0) / NULLIF(item_counts.cnt, 0)),
    2
  ) AS profit,
  CASE
    WHEN (bb.sale_price + COALESCE(bb.shipping_charged, 0)) > 0 THEN
      ROUND(
        (((bb.sale_price + COALESCE(bb.shipping_charged, 0)) / NULLIF(item_counts.cnt, 0)
          - COALESCE(ki.true_cost, ki.cost, 0)
          - (COALESCE(bb.shipping_cost, 0) / NULLIF(item_counts.cnt, 0)))
         / ((bb.sale_price + COALESCE(bb.shipping_charged, 0)) / NULLIF(item_counts.cnt, 0))) * 100,
        1
      )
    ELSE 0
  END AS margin
FROM kickstart_bundle_scans bs
JOIN kickstart_bundle_boxes bb ON bs.box_number = bb.box_number
JOIN (
  SELECT box_number, COUNT(*) AS cnt
  FROM kickstart_bundle_scans
  GROUP BY box_number
) item_counts ON item_counts.box_number = bs.box_number
LEFT JOIN kickstart_intake ki ON bs.intake_id = ki.id
WHERE bb.sold_at IS NOT NULL AND bb.sale_price IS NOT NULL

UNION ALL

-- JUMPSTART RDM BUNDLE SALES: bulk RDM sold outside Whatnot (0% fees).
-- Intrinsically RDM-only (rdm_bundle_sales). Cost = RDM WAC at sold_at,
-- with the day-one $3.41 fallback preserved.
SELECT
  (1000000000000::bigint + (hashtext(r.id::text)::bigint & 2147483647) * 1000 + gs.n) AS scan_id,
  r.pool_tag::text AS barcode,
  (r.pool_tag || '-' || r.id::text) AS listing_number,
  (r.pool_tag || ' Bundle - ' || COALESCE(r.buyer_name, 'Unknown')) AS show_name,
  r.sold_at::date AS show_date,
  NULL::text AS time_of_day,
  'Jumpstart' AS channel,
  (r.pool_tag || ' bundle item')::text AS description,
  NULL::text AS category,
  NULL::numeric AS msrp,
  COALESCE(pw.avg_cost, CASE WHEN r.pool_tag = 'RDM' THEN 3.41 ELSE 0 END)::numeric AS cost,
  COALESCE(pw.avg_cost, CASE WHEN r.pool_tag = 'RDM' THEN 3.41 ELSE 0 END)::numeric AS cost_freight,
  NULL::text AS zone,
  (r.pool_tag || ' bundle item')::text AS product_name,
  ROUND(r.sale_price / NULLIF(r.quantity, 0)::numeric, 2) AS buyer_paid,
  NULL::text AS coupon_code,
  NULL::numeric AS coupon_amount,
  ROUND(r.sale_price / NULLIF(r.quantity, 0)::numeric, 2) AS original_hammer,
  'valid'::text AS item_status,
  false AS is_bad_barcode,
  true AS is_bundle,
  false AS is_wac_cost,
  false AS is_custom_cost,
  0::numeric AS commission,
  0::numeric AS processing_fee,
  0::numeric AS total_fees,
  ROUND(r.sale_price / NULLIF(r.quantity, 0)::numeric, 2) AS net_payout,
  ROUND(r.sale_price / NULLIF(r.quantity, 0)::numeric - COALESCE(pw.avg_cost, CASE WHEN r.pool_tag = 'RDM' THEN 3.41 ELSE 0 END), 2) AS profit,
  CASE
    WHEN r.sale_price > 0 THEN
      ROUND(
        ((r.sale_price / NULLIF(r.quantity, 0)::numeric - COALESCE(pw.avg_cost, CASE WHEN r.pool_tag = 'RDM' THEN 3.41 ELSE 0 END))
         / (r.sale_price / NULLIF(r.quantity, 0)::numeric)) * 100,
        1
      )
    ELSE 0
  END AS margin
FROM rdm_bundle_sales r
CROSS JOIN LATERAL generate_series(1, r.quantity) AS gs(n)
LEFT JOIN pool_wac pw ON pw.pool_tag = r.pool_tag AND pw.for_date = r.sold_at::date
WHERE r.sale_price IS NOT NULL AND r.quantity > 0;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Custom brand loads: generalize the RDM/UJC "pool" mechanism to arbitrary
-- brand pools (Quince, Buck Mason, …) keyed by a per-load `pool_tag`.
--
-- Background (Josh, 2026-06-11): "any load where we don't upload a manifest,
-- that inventory should be tagged with the brand name, and subsequent loads
-- are blended into a running WAC." First case: Quince — 460 units, $4,167.25,
-- no manifest (the bank payment is the 2026-06-09 "Hemster, Inc. - Jumpstart
-- Deals" INVENTORY row, already excluded from the dashboard sourcing aggregate
-- via the %jumpstart% filter, so the loads row counts that cash exactly once).
--
-- Mechanism: today RDM/UJC items are sold by scanning a fixed barcode TOKEN
-- ('RDM'/'UJC'); inventory deducts from that pool and COGS resolves to the
-- pool's point-in-time cumulative WAC. We add `loads.pool_tag` = that scan
-- token, generalize the WAC CTE to group by pool_tag, and replace the two
-- hardcoded 'RDM'/'UJC' CASE/join pairs with a single join on
-- `pool_tag = scan barcode`. RDM/UJC are backfilled to pool_tag 'RDM'/'UJC',
-- so their COGS is byte-for-byte unchanged (same load partitions, new key).
--
-- Run in Supabase Dashboard > SQL Editor.
-- Date: 2026-06-11

-- ── 1. Schema: pool_tag column + allow kind='custom' ────────────────────────

ALTER TABLE loads ADD COLUMN IF NOT EXISTS pool_tag TEXT;

UPDATE loads SET pool_tag = 'RDM' WHERE kind = 'rdm'          AND pool_tag IS NULL;
UPDATE loads SET pool_tag = 'UJC' WHERE kind = 'unmanifested' AND pool_tag IS NULL;
-- manifested loads keep pool_tag = NULL (they resolve barcode → manifest).

ALTER TABLE loads DROP CONSTRAINT IF EXISTS loads_kind_check;
ALTER TABLE loads ADD CONSTRAINT loads_kind_check
  CHECK (kind IN ('manifested', 'rdm', 'unmanifested', 'custom'));

-- ── 2. Rebuild the profitability view with generalized pool WAC ─────────────

DROP VIEW IF EXISTS profitability CASCADE;

CREATE VIEW profitability AS

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
unmanifested_wac_dates AS (
  SELECT date AS d FROM shows WHERE date IS NOT NULL
  UNION
  SELECT sold_at::date FROM jumpstart_bundle_boxes WHERE sold_at IS NOT NULL
  UNION
  SELECT sold_at::date FROM rdm_bundle_sales WHERE sold_at IS NOT NULL
),
-- Point-in-time cumulative WAC per pool token (RDM, UJC, QUINCE, …).
-- Any pool load with a quantity on or before the date contributes; NULL- or
-- zero-quantity loads (e.g. cashflow-only 'BBB-1') are excluded from WAC.
pool_wac AS (
  SELECT
    l.pool_tag,
    d.d AS for_date,
    ROUND(SUM(l.total_cost) / NULLIF(SUM(l.quantity), 0), 4) AS avg_cost
  FROM unmanifested_wac_dates d
  JOIN loads l
    ON l.pool_tag IS NOT NULL
   AND l.date IS NOT NULL
   AND l.date <= d.d
   AND l.quantity IS NOT NULL
   AND l.quantity > 0
  GROUP BY l.pool_tag, d.d
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

-- KICKSTART: Whatnot live sales (unchanged)
SELECT
  s.id AS scan_id,
  s.barcode,
  si.listing_number::text AS listing_number,
  sh.name AS show_name,
  sh.date AS show_date,
  sh.time_of_day,
  sh.channel,
  COALESCE(k.description, k2.description) AS description,
  COALESCE(k.brand, k2.brand) AS category,
  COALESCE(k.msrp, k2.msrp) AS msrp,
  COALESCE(k.true_cost, k.cost, k2.true_cost, k2.cost, si.custom_item_cost, sh.custom_item_cost, wac.avg_cost) AS cost,
  COALESCE(k.true_cost, k.cost, k2.true_cost, k2.cost, si.custom_item_cost, sh.custom_item_cost, wac.avg_cost, 0) AS cost_freight,
  NULL::text AS zone,
  si.product_name,
  si.buyer_paid,
  si.coupon_code,
  si.coupon_amount,
  si.original_hammer,
  si.status AS item_status,
  CASE WHEN k.id IS NULL AND k2.id IS NULL AND si.custom_item_cost IS NULL AND sh.custom_item_cost IS NULL THEN true ELSE false END AS is_bad_barcode,
  false AS is_bundle,
  CASE WHEN k.id IS NULL AND k2.id IS NULL AND si.custom_item_cost IS NULL AND sh.custom_item_cost IS NULL THEN true ELSE false END AS is_wac_cost,
  CASE WHEN k.id IS NULL AND k2.id IS NULL AND (si.custom_item_cost IS NOT NULL OR sh.custom_item_cost IS NOT NULL) THEN true ELSE false END AS is_custom_cost,
  ROUND(si.buyer_paid * 0.072, 2) AS commission,
  ROUND(si.buyer_paid * 0.051, 2) AS processing_fee,
  ROUND(si.buyer_paid * 0.123, 2) AS total_fees,
  ROUND(si.buyer_paid - si.buyer_paid * 0.123, 2) AS net_payout,
  ROUND(
    si.buyer_paid - si.buyer_paid * 0.123
    - COALESCE(k.true_cost, k.cost, k2.true_cost, k2.cost, si.custom_item_cost, sh.custom_item_cost, wac.avg_cost, 0),
    2
  ) AS profit,
  CASE
    WHEN si.buyer_paid > 0 THEN
      ROUND(
        ((si.buyer_paid - si.buyer_paid * 0.123
          - COALESCE(k.true_cost, k.cost, k2.true_cost, k2.cost, si.custom_item_cost, sh.custom_item_cost, wac.avg_cost, 0))
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
  'RDM'::text AS barcode,
  ('RDM-' || r.id::text) AS listing_number,
  ('RDM Bundle - ' || COALESCE(r.buyer_name, 'Unknown')) AS show_name,
  r.sold_at::date AS show_date,
  NULL::text AS time_of_day,
  'Jumpstart' AS channel,
  'RDM bundle item'::text AS description,
  NULL::text AS category,
  NULL::numeric AS msrp,
  COALESCE(uw_rdm.avg_cost, 3.41)::numeric AS cost,
  COALESCE(uw_rdm.avg_cost, 3.41)::numeric AS cost_freight,
  NULL::text AS zone,
  'RDM bundle item'::text AS product_name,
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
  ROUND(r.sale_price / NULLIF(r.quantity, 0)::numeric - COALESCE(uw_rdm.avg_cost, 3.41), 2) AS profit,
  CASE
    WHEN r.sale_price > 0 THEN
      ROUND(
        ((r.sale_price / NULLIF(r.quantity, 0)::numeric - COALESCE(uw_rdm.avg_cost, 3.41))
         / (r.sale_price / NULLIF(r.quantity, 0)::numeric)) * 100,
        1
      )
    ELSE 0
  END AS margin
FROM rdm_bundle_sales r
CROSS JOIN LATERAL generate_series(1, r.quantity) AS gs(n)
LEFT JOIN pool_wac uw_rdm ON uw_rdm.pool_tag = 'RDM' AND uw_rdm.for_date = r.sold_at::date
WHERE r.sale_price IS NOT NULL AND r.quantity > 0;

-- ============================================================================
-- Dashboard summary RPC — recreated (CASCADE dropped it). Body identical to
-- fix-cashflow-double-count.sql, plus %quince% added to the sourcing-vendor
-- exclusion list (insurance: a Quince bank payment imported as INVENTORY must
-- not double-count against the loads table).
-- ============================================================================

DROP FUNCTION IF EXISTS get_dashboard_summary(date, date);

CREATE FUNCTION get_dashboard_summary(date_cutoff DATE DEFAULT NULL, date_end DATE DEFAULT NULL)
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

  SELECT COALESCE(SUM(total_cost), 0) INTO total_load_cost FROM loads
    WHERE date >= effective_start AND (date_end IS NULL OR date <= date_end);

  -- Freight is already inside Inmar load payments (or arrives as separate OPEX
  -- from the freight broker) — adding 0.45/item double-counted it. Kept at 0
  -- for frontend compatibility.
  total_load_freight := 0;

  -- Kickstart sourcing: SOURCING + INVENTORY expenses, minus shipping and
  -- minus Jumpstart load vendors (canonical in the `loads` table).
  -- ⚠️ Keep this vendor list in sync with the expense-import INVENTORY rules
  -- and with any new pool/custom-load brands added via Add New Load.
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

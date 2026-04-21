-- Fix two Jumpstart cost regressions that caused Dashboard and Profitability
-- to disagree by $21,380 for April 2026:
--
-- 1. RDM hardcode ($3.41 per item) was dropped when tune-whatnot-fees.sql
--    rebuilt the view. RDM items have m.barcode=NULL in the manifest join,
--    so their cost_freight was resolving to NULL → 0. Restored as the
--    highest-priority cost source for Jumpstart live sales + bundles.
--
-- 2. Non-RDM bad-barcode items (scanned barcodes that don't match manifest)
--    had cost_freight=NULL/0. The Profitability page was post-processing
--    these by applying each show's WAC client-side; the Dashboard wasn't,
--    so the two disagreed. Adds jumpstart_show_wac CTE (mirrors Kickstart)
--    so WAC is applied at the VIEW level consistently for both.
--
-- Cost resolution order for Jumpstart live sales after this migration:
--   RDM hardcode ($3.41) → m.cost_freight → jumpstart_show_wac.avg_cost
--
-- Run in Supabase Dashboard > SQL Editor
-- Date: 2026-04-21

DROP VIEW IF EXISTS profitability CASCADE;

CREATE VIEW profitability AS

WITH kickstart_show_wac_raw AS (
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
-- NEW: Jumpstart per-show WAC. Avg cost_freight of items whose barcode
-- did match the manifest (excludes RDM and bad-barcode items). Used as
-- a fallback cost for bad-barcode scans in the same show.
jumpstart_show_wac AS (
  SELECT s.show_id, ROUND(AVG(m.cost_freight), 4) AS avg_cost
  FROM jumpstart_sold_scans s
  LEFT JOIN (
    SELECT DISTINCT ON (barcode) *
    FROM jumpstart_manifest
    ORDER BY barcode, id
  ) m ON s.barcode = m.barcode
  WHERE m.cost_freight IS NOT NULL
    AND s.barcode IS DISTINCT FROM 'RDM'
  GROUP BY s.show_id
)

-- JUMPSTART: Whatnot live sales
-- Cost resolution: RDM hardcode → m.cost_freight → jwac.avg_cost
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
    CASE WHEN s.barcode = 'RDM' THEN 3.41 END,
    m.cost_freight,
    jwac.avg_cost
  ) AS cost_freight,
  m.zone::text AS zone,
  si.product_name,
  si.buyer_paid,
  si.coupon_code,
  si.coupon_amount,
  si.original_hammer,
  si.status AS item_status,
  -- is_bad_barcode: true only if NO cost source resolved
  (s.barcode IS DISTINCT FROM 'RDM' AND m.barcode IS NULL AND jwac.avg_cost IS NULL) AS is_bad_barcode,
  false AS is_bundle,
  -- is_wac_cost: true when we fell through to show-WAC (not RDM, not in manifest, but show had some matched items)
  (s.barcode IS DISTINCT FROM 'RDM' AND m.barcode IS NULL AND jwac.avg_cost IS NOT NULL) AS is_wac_cost,
  false AS is_custom_cost,
  ROUND(si.buyer_paid * 0.072, 2) AS commission,
  ROUND(si.buyer_paid * 0.051, 2) AS processing_fee,
  ROUND(si.buyer_paid * 0.123, 2) AS total_fees,
  ROUND(si.buyer_paid - si.buyer_paid * 0.123, 2) AS net_payout,
  ROUND(
    si.buyer_paid - si.buyer_paid * 0.123
    - COALESCE(
        CASE WHEN s.barcode = 'RDM' THEN 3.41 END,
        m.cost_freight,
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
              CASE WHEN s.barcode = 'RDM' THEN 3.41 END,
              m.cost_freight,
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
WHERE si.status = 'valid'

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

UNION ALL

-- JUMPSTART BUNDLES: sold outside Whatnot (0% fees)
-- RDM hardcode applied at bundle scan level too.
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
    CASE WHEN bs.barcode = 'RDM' THEN 3.41 END,
    m.cost_freight,
    m.cost,
    0
  ) AS cost_freight,
  m.zone::text AS zone,
  m.description AS product_name,
  ROUND(bb.sale_price / NULLIF(item_counts.cnt, 0), 2) AS buyer_paid,
  NULL::text AS coupon_code,
  NULL::numeric AS coupon_amount,
  ROUND(bb.sale_price / NULLIF(item_counts.cnt, 0), 2) AS original_hammer,
  'valid' AS item_status,
  false AS is_bad_barcode,
  true AS is_bundle,
  false AS is_wac_cost,
  false AS is_custom_cost,
  0::numeric AS commission,
  0::numeric AS processing_fee,
  0::numeric AS total_fees,
  ROUND(bb.sale_price / NULLIF(item_counts.cnt, 0), 2) AS net_payout,
  ROUND(
    bb.sale_price / NULLIF(item_counts.cnt, 0)
    - COALESCE(
        CASE WHEN bs.barcode = 'RDM' THEN 3.41 END,
        m.cost_freight,
        m.cost,
        0
      ),
    2
  ) AS profit,
  CASE
    WHEN bb.sale_price > 0 THEN
      ROUND(
        ((bb.sale_price / NULLIF(item_counts.cnt, 0)
          - COALESCE(
              CASE WHEN bs.barcode = 'RDM' THEN 3.41 END,
              m.cost_freight,
              m.cost,
              0
            ))
         / (bb.sale_price / NULLIF(item_counts.cnt, 0))) * 100,
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
  COALESCE(ki.true_cost, ki.cost, 0) AS cost_freight,
  NULL::text AS zone,
  ki.description AS product_name,
  ROUND(bb.sale_price / NULLIF(item_counts.cnt, 0), 2) AS buyer_paid,
  NULL::text AS coupon_code,
  NULL::numeric AS coupon_amount,
  ROUND(bb.sale_price / NULLIF(item_counts.cnt, 0), 2) AS original_hammer,
  'valid' AS item_status,
  false AS is_bad_barcode,
  true AS is_bundle,
  false AS is_wac_cost,
  false AS is_custom_cost,
  0::numeric AS commission,
  0::numeric AS processing_fee,
  0::numeric AS total_fees,
  ROUND(bb.sale_price / NULLIF(item_counts.cnt, 0), 2) AS net_payout,
  ROUND(
    bb.sale_price / NULLIF(item_counts.cnt, 0) - COALESCE(ki.true_cost, ki.cost, 0),
    2
  ) AS profit,
  CASE
    WHEN bb.sale_price > 0 THEN
      ROUND(
        ((bb.sale_price / NULLIF(item_counts.cnt, 0) - COALESCE(ki.true_cost, ki.cost, 0))
         / (bb.sale_price / NULLIF(item_counts.cnt, 0))) * 100,
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
WHERE bb.sold_at IS NOT NULL AND bb.sale_price IS NOT NULL;

-- Recreate dashboard summary function (OPEX filter preserved from prior fix)
DROP FUNCTION IF EXISTS get_dashboard_summary(date, date);

CREATE FUNCTION get_dashboard_summary(date_cutoff DATE DEFAULT NULL, date_end DATE DEFAULT NULL)
RETURNS JSON LANGUAGE plpgsql AS $$
DECLARE
  result JSON; js RECORD; ks RECORD; total_expenses NUMERIC; total_payroll NUMERIC;
BEGIN
  SELECT COUNT(*)::BIGINT AS items, COALESCE(SUM(buyer_paid),0) AS revenue, COALESCE(SUM(total_fees),0) AS fees,
         ROUND(COALESCE(SUM(buyer_paid),0)-COALESCE(SUM(total_fees),0),2) AS net_revenue,
         COALESCE(SUM(cost_freight),0) AS cogs,
         ROUND(COALESCE(SUM(buyer_paid),0)-COALESCE(SUM(total_fees),0)-COALESCE(SUM(cost_freight),0),2) AS gross_profit
    INTO js FROM profitability WHERE channel = 'Jumpstart'
      AND (date_cutoff IS NULL OR show_date >= date_cutoff)
      AND (date_end IS NULL OR show_date <= date_end);
  SELECT COUNT(*)::BIGINT AS items, COALESCE(SUM(buyer_paid),0) AS revenue, COALESCE(SUM(total_fees),0) AS fees,
         ROUND(COALESCE(SUM(buyer_paid),0)-COALESCE(SUM(total_fees),0),2) AS net_revenue,
         COALESCE(SUM(cost_freight),0) AS cogs,
         ROUND(COALESCE(SUM(buyer_paid),0)-COALESCE(SUM(total_fees),0)-COALESCE(SUM(cost_freight),0),2) AS gross_profit
    INTO ks FROM profitability WHERE channel = 'Kickstart'
      AND (date_cutoff IS NULL OR show_date >= date_cutoff)
      AND (date_end IS NULL OR show_date <= date_end);
  SELECT COALESCE(SUM(amount),0) INTO total_expenses FROM expenses WHERE category = 'OPEX'
    AND (date_cutoff IS NULL OR date >= date_cutoff)
    AND (date_end IS NULL OR date <= date_end);
  SELECT COALESCE(SUM(amount),0) INTO total_payroll FROM expenses WHERE category = 'PAYROLL'
    AND (date_cutoff IS NULL OR date >= date_cutoff)
    AND (date_end IS NULL OR date <= date_end);
  result := json_build_object(
    'jumpstart', json_build_object('items',js.items,'revenue',js.revenue,'fees',js.fees,'net_revenue',js.net_revenue,'cogs',js.cogs,'gross_profit',js.gross_profit),
    'kickstart', json_build_object('items',ks.items,'revenue',ks.revenue,'fees',ks.fees,'net_revenue',ks.net_revenue,'cogs',ks.cogs,'gross_profit',ks.gross_profit),
    'expenses', total_expenses, 'payroll', total_payroll);
  RETURN result;
END; $$;

NOTIFY pgrst, 'reload schema';

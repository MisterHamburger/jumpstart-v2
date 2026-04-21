-- Adds custom item COGS for Kickstart Whatnot live sales at two levels:
--   1. Per-SHOW  (shows.custom_item_cost)        — flat estimate for whole show
--   2. Per-ITEM  (show_items.custom_item_cost)   — override for a specific sticker #
-- When ops runs a show with items that weren't pre-scanned into kickstart_intake
-- (no true_cost, no UPC match), they can set either/both and the profitability
-- view will substitute them as COGS. Works analogously to Jumpstart's RDM $3.41.
--
-- Priority order in the profitability view:
--   k.true_cost → k.cost → k2.true_cost → k2.cost
--     → si.custom_item_cost (per-item override)
--     → sh.custom_item_cost (per-show estimate)
--     → wac.avg_cost
-- Known intake items keep their real cost; only unknowns fall to custom values.
--
-- This migration also incorporates the Box 1 hardcode removal from
-- migrations/remove-box1-hardcode.sql — running this one covers both changes.
--
-- Run in Supabase Dashboard > SQL Editor
-- Date: 2026-04-19

-- PART 1: Add custom_item_cost columns
ALTER TABLE shows ADD COLUMN IF NOT EXISTS custom_item_cost NUMERIC(8,2);
COMMENT ON COLUMN shows.custom_item_cost IS
  'Per-item cost estimate used when a show''s items weren''t pre-scanned into kickstart_intake. '
  'Applies in the profitability view below UPC-match but above WAC fallback. '
  'Analogous to Jumpstart''s RDM $3.41 hardcode.';

ALTER TABLE show_items ADD COLUMN IF NOT EXISTS custom_item_cost NUMERIC(8,2);
COMMENT ON COLUMN show_items.custom_item_cost IS
  'Per-sticker-number custom COGS override. Wins over shows.custom_item_cost when set. '
  'Use for individual high-ticket or oddball items in a custom-COGS show.';

-- PART 2: Rebuild profitability view with:
--   (a) Box 1 hardcode removed (Box 1 intake data is now verified correct)
--   (b) sh.custom_item_cost inserted into the Kickstart live-sales COALESCE chain
--   (c) is_bad_barcode / is_wac_cost adjusted to not flag items with valid custom cost
--   (d) new is_custom_cost boolean flag for dashboard clarity
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
)

-- JUMPSTART: Whatnot live sales (unchanged)
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
  m.cost_freight,
  m.zone::text AS zone,
  si.product_name,
  si.buyer_paid,
  si.coupon_code,
  si.coupon_amount,
  si.original_hammer,
  si.status AS item_status,
  CASE WHEN m.barcode IS NULL THEN true ELSE false END AS is_bad_barcode,
  false AS is_bundle,
  false AS is_wac_cost,
  false AS is_custom_cost,
  ROUND(si.buyer_paid * 0.072, 2) AS commission,
  ROUND(si.buyer_paid * 0.029 + 0.30, 2) AS processing_fee,
  ROUND(si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30, 2) AS total_fees,
  ROUND(si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30), 2) AS net_payout,
  ROUND(
    si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30) - COALESCE(m.cost_freight, 0),
    2
  ) AS profit,
  CASE
    WHEN si.buyer_paid > 0 THEN
      ROUND(
        ((si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30) - COALESCE(m.cost_freight, 0))
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
WHERE si.status = 'valid'

UNION ALL

-- KICKSTART: Whatnot live sales
-- COALESCE chain for unknown items, in priority order:
--   per-item override → per-show estimate → WAC fallback
-- Known intake matches still win over all custom values.
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
  -- bad_barcode only if NO cost source resolves (no intake, no per-item, no per-show)
  CASE WHEN k.id IS NULL AND k2.id IS NULL AND si.custom_item_cost IS NULL AND sh.custom_item_cost IS NULL THEN true ELSE false END AS is_bad_barcode,
  false AS is_bundle,
  -- wac_cost only when falling all the way to WAC (no per-item, no per-show)
  CASE WHEN k.id IS NULL AND k2.id IS NULL AND si.custom_item_cost IS NULL AND sh.custom_item_cost IS NULL THEN true ELSE false END AS is_wac_cost,
  -- custom_cost flag: unknown item that picked up either a per-item OR per-show custom cost
  CASE WHEN k.id IS NULL AND k2.id IS NULL AND (si.custom_item_cost IS NOT NULL OR sh.custom_item_cost IS NOT NULL) THEN true ELSE false END AS is_custom_cost,
  ROUND(si.buyer_paid * 0.072, 2) AS commission,
  ROUND(si.buyer_paid * 0.029 + 0.30, 2) AS processing_fee,
  ROUND(si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30, 2) AS total_fees,
  ROUND(si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30), 2) AS net_payout,
  ROUND(
    si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30)
    - COALESCE(k.true_cost, k.cost, k2.true_cost, k2.cost, si.custom_item_cost, sh.custom_item_cost, wac.avg_cost, 0),
    2
  ) AS profit,
  CASE
    WHEN si.buyer_paid > 0 THEN
      ROUND(
        ((si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30)
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

-- JUMPSTART BUNDLES: sold outside Whatnot (0% fees) — unchanged
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
  COALESCE(m.cost_freight, m.cost, 0) AS cost_freight,
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
    bb.sale_price / NULLIF(item_counts.cnt, 0) - COALESCE(m.cost_freight, m.cost, 0),
    2
  ) AS profit,
  CASE
    WHEN bb.sale_price > 0 THEN
      ROUND(
        ((bb.sale_price / NULLIF(item_counts.cnt, 0) - COALESCE(m.cost_freight, m.cost, 0))
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

-- KICKSTART BUNDLES: sold outside Whatnot (0% fees)
-- Box 1 hardcode removed — all boxes now use live true_cost from kickstart_intake
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

-- PART 3: Recreate dashboard summary function (depended on the old view)
DROP FUNCTION IF EXISTS get_dashboard_summary(date, date);

CREATE OR REPLACE FUNCTION get_dashboard_summary(
  date_cutoff DATE DEFAULT NULL,
  date_end DATE DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  result JSON;
  js RECORD;
  ks RECORD;
  total_expenses NUMERIC;
  total_payroll NUMERIC;
BEGIN
  SELECT
    COUNT(*)::BIGINT AS items,
    COALESCE(SUM(buyer_paid), 0) AS revenue,
    COALESCE(SUM(total_fees), 0) AS fees,
    ROUND(COALESCE(SUM(buyer_paid), 0) - COALESCE(SUM(total_fees), 0), 2) AS net_revenue,
    COALESCE(SUM(cost_freight), 0) AS cogs,
    ROUND(COALESCE(SUM(buyer_paid), 0) - COALESCE(SUM(total_fees), 0) - COALESCE(SUM(cost_freight), 0), 2) AS gross_profit
  INTO js
  FROM profitability
  WHERE channel = 'Jumpstart'
    AND (date_cutoff IS NULL OR show_date >= date_cutoff)
    AND (date_end IS NULL OR show_date <= date_end);

  SELECT
    COUNT(*)::BIGINT AS items,
    COALESCE(SUM(buyer_paid), 0) AS revenue,
    COALESCE(SUM(total_fees), 0) AS fees,
    ROUND(COALESCE(SUM(buyer_paid), 0) - COALESCE(SUM(total_fees), 0), 2) AS net_revenue,
    COALESCE(SUM(cost_freight), 0) AS cogs,
    ROUND(COALESCE(SUM(buyer_paid), 0) - COALESCE(SUM(total_fees), 0) - COALESCE(SUM(cost_freight), 0), 2) AS gross_profit
  INTO ks
  FROM profitability
  WHERE channel = 'Kickstart'
    AND (date_cutoff IS NULL OR show_date >= date_cutoff)
    AND (date_end IS NULL OR show_date <= date_end);

  SELECT COALESCE(SUM(amount), 0)
  INTO total_expenses
  FROM expenses
  WHERE category = 'OPEX'
    AND (date_cutoff IS NULL OR date >= date_cutoff)
    AND (date_end IS NULL OR date <= date_end);

  SELECT COALESCE(SUM(amount), 0)
  INTO total_payroll
  FROM expenses
  WHERE category = 'PAYROLL'
    AND (date_cutoff IS NULL OR date >= date_cutoff)
    AND (date_end IS NULL OR date <= date_end);

  result := json_build_object(
    'jumpstart', json_build_object(
      'items', js.items,
      'revenue', js.revenue,
      'fees', js.fees,
      'net_revenue', js.net_revenue,
      'cogs', js.cogs,
      'gross_profit', js.gross_profit
    ),
    'kickstart', json_build_object(
      'items', ks.items,
      'revenue', ks.revenue,
      'fees', ks.fees,
      'net_revenue', ks.net_revenue,
      'cogs', ks.cogs,
      'gross_profit', ks.gross_profit
    ),
    'expenses', total_expenses,
    'payroll', total_payroll
  );

  RETURN result;
END;
$$;

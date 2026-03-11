-- Add bundle sales to profitability view
-- Each item in a sold bundle gets a proportional share of the sale price
-- Bundles sold outside Whatnot → 0% fees
-- Run in Supabase Dashboard > SQL Editor
-- Date: 2026-03-11

DROP VIEW IF EXISTS profitability CASCADE;

CREATE VIEW profitability AS

-- CTE: per-show average cost for Kickstart items (WAC fallback for unmatched items)
WITH kickstart_show_wac AS (
  SELECT s.show_id, ROUND(AVG(COALESCE(k.cost, k2.cost)), 2) AS avg_cost
  FROM kickstart_sold_scans s
  LEFT JOIN kickstart_intake k ON k.id = s.intake_id
  LEFT JOIN (
    SELECT DISTINCT ON (upc) *
    FROM kickstart_intake
    WHERE upc IS NOT NULL AND upc != ''
    ORDER BY upc, id
  ) k2 ON s.intake_id IS NULL AND s.barcode = k2.upc
  WHERE COALESCE(k.cost, k2.cost) IS NOT NULL
  GROUP BY s.show_id
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
-- Unmatched items (no intake_id, no UPC match) use per-show WAC as cost fallback
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
  COALESCE(k.cost, k2.cost, wac.avg_cost) AS cost,
  COALESCE(k.cost, k2.cost, wac.avg_cost, 0) AS cost_freight,
  NULL::text AS zone,
  si.product_name,
  si.buyer_paid,
  si.coupon_code,
  si.coupon_amount,
  si.original_hammer,
  si.status AS item_status,
  CASE WHEN k.id IS NULL AND k2.id IS NULL THEN true ELSE false END AS is_bad_barcode,
  false AS is_bundle,
  CASE WHEN k.id IS NULL AND k2.id IS NULL THEN true ELSE false END AS is_wac_cost,
  ROUND(si.buyer_paid * 0.072, 2) AS commission,
  ROUND(si.buyer_paid * 0.029 + 0.30, 2) AS processing_fee,
  ROUND(si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30, 2) AS total_fees,
  ROUND(si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30), 2) AS net_payout,
  ROUND(
    si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30) - COALESCE(k.cost, k2.cost, wac.avg_cost, 0),
    2
  ) AS profit,
  CASE
    WHEN si.buyer_paid > 0 THEN
      ROUND(
        ((si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30) - COALESCE(k.cost, k2.cost, wac.avg_cost, 0))
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
-- Each item gets proportional share of box sale_price
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
  -- Proportional share: sale_price / item_count
  ROUND(bb.sale_price / NULLIF(item_counts.cnt, 0), 2) AS buyer_paid,
  NULL::text AS coupon_code,
  NULL::numeric AS coupon_amount,
  ROUND(bb.sale_price / NULLIF(item_counts.cnt, 0), 2) AS original_hammer,
  'valid' AS item_status,
  false AS is_bad_barcode,
  true AS is_bundle,
  false AS is_wac_cost,
  -- No Whatnot fees on bundle sales
  0::numeric AS commission,
  0::numeric AS processing_fee,
  0::numeric AS total_fees,
  -- Net payout = full buyer_paid (no fees)
  ROUND(bb.sale_price / NULLIF(item_counts.cnt, 0), 2) AS net_payout,
  -- Profit = buyer_paid - cost (no fees)
  ROUND(
    bb.sale_price / NULLIF(item_counts.cnt, 0) - COALESCE(m.cost_freight, m.cost, 0),
    2
  ) AS profit,
  CASE
    WHEN bb.sale_price > 0 THEN
      ROUND(
        ((bb.sale_price / NULLIF(item_counts.cnt, 0) - COALESCE(bs.cost_override, m.cost_freight, m.cost, 0))
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
  ki.cost,
  COALESCE(ki.cost, 0) AS cost_freight,
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
  0::numeric AS commission,
  0::numeric AS processing_fee,
  0::numeric AS total_fees,
  ROUND(bb.sale_price / NULLIF(item_counts.cnt, 0), 2) AS net_payout,
  ROUND(
    bb.sale_price / NULLIF(item_counts.cnt, 0) - COALESCE(ki.cost, 0),
    2
  ) AS profit,
  CASE
    WHEN bb.sale_price > 0 THEN
      ROUND(
        ((bb.sale_price / NULLIF(item_counts.cnt, 0) - COALESCE(bs.cost_override, ki.cost, 0))
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

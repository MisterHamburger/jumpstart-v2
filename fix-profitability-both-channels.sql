-- FIX: Profitability view to include BOTH Jumpstart and Kickstart data
-- Run this in Supabase Dashboard → SQL Editor
-- Date: 2026-02-25

-- Must drop first because we're changing the structure
DROP VIEW IF EXISTS profitability CASCADE;

CREATE VIEW profitability AS

-- JUMPSTART: J.Crew / Madewell
SELECT
  s.id AS scan_id,
  s.barcode,
  si.listing_number,
  sh.name AS show_name,
  sh.date AS show_date,
  sh.time_of_day,
  sh.channel,
  m.description,
  m.category,
  m.msrp,
  m.cost,
  m.cost_freight,
  m.zone,
  si.product_name,
  si.buyer_paid,
  si.coupon_code,
  si.coupon_amount,
  si.original_hammer,
  si.status AS item_status,
  CASE WHEN m.barcode IS NULL THEN true ELSE false END AS is_bad_barcode,
  -- Fees on buyer_paid (what Whatnot actually charges on)
  ROUND(si.buyer_paid * 0.072, 2) AS commission,
  ROUND(si.buyer_paid * 0.029 + 0.30, 2) AS processing_fee,
  ROUND(si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30, 2) AS total_fees,
  -- Net payout
  ROUND(si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30), 2) AS net_payout,
  -- Profit = net payout minus cost
  ROUND(
    si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30) - COALESCE(m.cost_freight, 0),
    2
  ) AS profit,
  -- Margin (avoid divide by zero)
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

-- KICKSTART: Free People / Urban Outfitters / Anthropologie
SELECT
  s.id AS scan_id,
  s.barcode,
  si.listing_number,
  sh.name AS show_name,
  sh.date AS show_date,
  sh.time_of_day,
  sh.channel,
  k.description,
  k.brand AS category,  -- Use brand as category for Kickstart
  k.msrp,
  k.cost,
  k.cost AS cost_freight,  -- Kickstart uses cost directly (no separate freight)
  NULL::integer AS zone,
  si.product_name,
  si.buyer_paid,
  si.coupon_code,
  si.coupon_amount,
  si.original_hammer,
  si.status AS item_status,
  CASE WHEN k.id IS NULL THEN true ELSE false END AS is_bad_barcode,
  -- Fees on buyer_paid (what Whatnot actually charges on)
  ROUND(si.buyer_paid * 0.072, 2) AS commission,
  ROUND(si.buyer_paid * 0.029 + 0.30, 2) AS processing_fee,
  ROUND(si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30, 2) AS total_fees,
  -- Net payout
  ROUND(si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30), 2) AS net_payout,
  -- Profit = net payout minus cost
  ROUND(
    si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30) - COALESCE(k.cost, 0),
    2
  ) AS profit,
  -- Margin (avoid divide by zero)
  CASE
    WHEN si.buyer_paid > 0 THEN
      ROUND(
        ((si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30) - COALESCE(k.cost, 0))
         / si.buyer_paid) * 100,
        1
      )
    ELSE 0
  END AS margin
FROM kickstart_sold_scans s
JOIN show_items si ON s.show_id = si.show_id AND s.listing_number = si.listing_number
JOIN shows sh ON s.show_id = sh.id
LEFT JOIN (
  SELECT DISTINCT ON (upc) *
  FROM kickstart_intake
  ORDER BY upc, id
) k ON s.barcode = k.upc
WHERE si.status = 'valid';

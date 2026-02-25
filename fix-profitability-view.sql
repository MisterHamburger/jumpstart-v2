-- FIX: Profitability view to include 100% coupon orders
-- Run this in Supabase Dashboard → SQL Editor
-- Date: 2026-02-25

-- Must drop first because column types are changing
DROP VIEW IF EXISTS profitability CASCADE;

CREATE VIEW profitability AS
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
WHERE si.status = 'valid';

-- Landed-only pool WAC + fold new J.Crew/Madewell loads into the JCM blend.
--
-- Background (Josh, 2026-07-22):
--   1) New "Unmanifested J.Crew"/"RDM" loads were still being tagged UJC/RDM (the
--      old, now-blended pools) instead of JCM. Load 21 (8,587 units, in transit)
--      landed in a resurrected UJC pool. Re-tag it into JCM so it blends. (The
--      derivePoolTag code fix stops this recurring.)
--   2) Pool WAC now counts LANDED loads only ("don't cost profits on inventory we
--      can't sell yet"). pool_wac gains `AND l.landed = true`. An in-transit load
--      contributes to the WAC only once it's marked landed.
--
-- History note: the ONLY past figure this moves is the 2026-07-15 UJC show
-- (780 units), whose COGS drops $8.33 -> $8.20 because it was being costed partly
-- on the in-transit Load 21 — a correction toward the landed rule. Everything
-- older is untouched (all their loads are landed and predate Load 21).
--
-- Verify: JCM WAC stays $6.1124 (Load 21 excluded while in transit); it becomes
-- $7.28 once Load 21 is marked landed. Re-run the channel-totals check to see the
-- single ~$106 shift on Jumpstart from the 07-15 correction.
--
-- CREATE OR REPLACE (RPC untouched). Run in Supabase Dashboard > SQL Editor.
-- Date: 2026-07-22

-- Fold Load 21 into the J.Crew/Madewell blend.
UPDATE loads SET pool_tag = 'JCM' WHERE id = 'Load 21';

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
   AND l.quantity <> 0
   AND l.landed = true
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

NOTIFY pgrst, 'reload schema';

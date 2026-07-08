-- Backfill: convert the 6/5 and 6/6 Jumpstart "Set COGS" placeholder scans
-- (barcode = 'CUSTOM') to 'UJC' so they deduct the Unmanifested J.Crew pool.
--
-- Background:
--   The first UJC shows (2026-06-05, 2026-06-06) were finished with the
--   "Set COGS" button, which inserts jumpstart_sold_scans rows with
--   barcode = 'CUSTOM' and sets shows.custom_item_cost = 7.38.
--
--   • COGS was correct — the profitability view resolves 'CUSTOM' scans to
--     sh.custom_item_cost ($7.38).
--   • Inventory was NOT deducted — JumpstartInventory.jsx skips barcode
--     'CUSTOM' (line ~84) and only counts barcode 'UJC' against the
--     unmanifested pool (line ~86). So the UJC in-stock count was overstated
--     by the number of these placeholder scans.
--
-- Converting 'CUSTOM' -> 'UJC' on these shows:
--   • Deducts the UJC pool correctly (counts as poolScanCounts.unmanifested).
--   • Keeps COGS at $7.38 — barcode 'UJC' resolves to the UJC WAC pool
--     (SUM(total_cost)/SUM(quantity) over loads WHERE kind='unmanifested'),
--     which equals $7.38 as long as that load was entered at $7.38/unit.
--   • shows.custom_item_cost is left in place as a harmless safety net: the
--     view's COALESCE prefers the UJC WAC, falling back to custom_item_cost
--     only if the WAC fails to resolve.
--
-- Scoped to Jumpstart shows on these two dates, barcode = 'CUSTOM' only, so
-- real manifest-barcode scans are untouched. Safe to re-run (idempotent —
-- after the first run there are no 'CUSTOM' rows left to convert).
--
-- Run in Supabase Dashboard > SQL Editor
-- Date: 2026-06-07

-- ---------------------------------------------------------------------------
-- 1. Pre-check: see exactly what will be converted, per show.
-- ---------------------------------------------------------------------------
SELECT sh.id AS show_id, sh.name, sh.date,
       COUNT(*) FILTER (WHERE s.barcode = 'CUSTOM') AS custom_scans_to_convert,
       sh.custom_item_cost
FROM shows sh
JOIN jumpstart_sold_scans s ON s.show_id = sh.id
WHERE sh.channel = 'Jumpstart'
  AND sh.date IN ('2026-06-05', '2026-06-06')
GROUP BY sh.id, sh.name, sh.date, sh.custom_item_cost
ORDER BY sh.date;

-- ---------------------------------------------------------------------------
-- 2. The backfill.
-- ---------------------------------------------------------------------------
UPDATE jumpstart_sold_scans s
SET barcode = 'UJC'
FROM shows sh
WHERE s.show_id = sh.id
  AND sh.channel = 'Jumpstart'
  AND sh.date IN ('2026-06-05', '2026-06-06')
  AND s.barcode = 'CUSTOM';

-- ---------------------------------------------------------------------------
-- 3. Post-check: UJC scan counts on these shows (should now be non-zero),
--    and the live UJC pool basis used for COGS.
-- ---------------------------------------------------------------------------
SELECT sh.date,
       COUNT(*) FILTER (WHERE s.barcode = 'UJC')    AS ujc_scans,
       COUNT(*) FILTER (WHERE s.barcode = 'CUSTOM') AS leftover_custom
FROM shows sh
JOIN jumpstart_sold_scans s ON s.show_id = sh.id
WHERE sh.channel = 'Jumpstart'
  AND sh.date IN ('2026-06-05', '2026-06-06')
GROUP BY sh.date
ORDER BY sh.date;

SELECT ROUND(SUM(total_cost) / NULLIF(SUM(quantity), 0), 4) AS ujc_wac_unit_cost,
       SUM(quantity) AS ujc_units_purchased
FROM loads
WHERE kind = 'unmanifested';

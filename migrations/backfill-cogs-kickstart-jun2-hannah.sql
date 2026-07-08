-- Backfill: set whole-show COGS to $18.85 for the Jun 2 Kickstart (Hannah) show.
--
-- The wrong per-item COGS was applied to this show. For Kickstart, the
-- profitability view resolves cost as:
--   intake true_cost/cost  ->  si.custom_item_cost  ->  sh.custom_item_cost  ->  per-show WAC
-- so writing shows.custom_item_cost = 18.85 overrides the WAC for every item
-- in the show that isn't individually intake-costed.
--
-- NOTE: message said "5/2" but the screenshot showed "Jun 2 - Kickstart -
-- Hannah", so this targets 2026-06-02. Confirm the pre-check row before running
-- the UPDATE. If it's actually a different date, change the date below.
--
-- Run in Supabase Dashboard > SQL Editor
-- Date: 2026-06-08

-- ---------------------------------------------------------------------------
-- 1. Pre-check: confirm the show + its current cost basis.
-- ---------------------------------------------------------------------------
SELECT id, name, date, channel, custom_item_cost AS current_custom_cost,
       (SELECT COUNT(*) FROM kickstart_sold_scans s WHERE s.show_id = sh.id) AS scans
FROM shows sh
WHERE channel = 'Kickstart'
  AND date = '2026-06-02'
  AND name ILIKE '%Hannah%';

-- ---------------------------------------------------------------------------
-- 2. The update.
-- ---------------------------------------------------------------------------
UPDATE shows
SET custom_item_cost = 18.85
WHERE channel = 'Kickstart'
  AND date = '2026-06-02'
  AND name ILIKE '%Hannah%';

-- ---------------------------------------------------------------------------
-- 3. Post-check: effective per-item cost from the live profitability view.
--    avg_cost_per_item should now read ~18.85.
-- ---------------------------------------------------------------------------
SELECT p.show_name,
       COUNT(*)                              AS items,
       ROUND(AVG(p.cost_freight), 2)         AS avg_cost_per_item,
       ROUND(SUM(p.buyer_paid), 2)           AS revenue,
       ROUND(SUM(p.profit), 2)               AS total_profit
FROM profitability p
JOIN shows sh ON sh.name = p.show_name
WHERE sh.channel = 'Kickstart'
  AND sh.date = '2026-06-02'
  AND sh.name ILIKE '%Hannah%'
GROUP BY p.show_name;

-- Fix corrupted UPCs from quantity scans
-- Step 1: Run this to see what WILL be fixed (review first)
-- Step 2: Uncomment the UPDATE section to actually fix the data

WITH photo_groups AS (
  -- Group items by photo + timestamp (within 1 minute)
  SELECT
    photo_data,
    cost,
    brand,
    DATE_TRUNC('minute', created_at) as scan_time,
    COUNT(*) as total_items,
    ARRAY_AGG(id ORDER BY id) as item_ids,
    ARRAY_AGG(upc ORDER BY id) as upcs
  FROM kickstart_intake
  WHERE photo_data IS NOT NULL
    AND status = 'enriched'
    AND upc IS NOT NULL
  GROUP BY photo_data, cost, brand, DATE_TRUNC('minute', created_at)
  HAVING COUNT(DISTINCT upc) > 1  -- Only groups with mismatched UPCs
),
upc_analysis AS (
  -- Analyze each UPC in the group
  SELECT
    pg.*,
    UNNEST(pg.upcs) as upc,
    (SELECT COUNT(*) FROM UNNEST(pg.upcs) u WHERE u = UNNEST(pg.upcs)) as upc_count
  FROM photo_groups pg
),
best_upc AS (
  -- Determine the "correct" UPC for each group
  SELECT DISTINCT ON (photo_data, scan_time)
    photo_data,
    scan_time,
    total_items,
    item_ids,
    upcs,
    upc as correct_upc,
    CASE
      WHEN LENGTH(upc) IN (12, 13) THEN 'proper_length'
      WHEN upc_count > 1 THEN 'majority'
      WHEN LENGTH(upc) = (SELECT MAX(LENGTH(u)) FROM UNNEST(upcs) u) THEN 'longest'
      ELSE 'unclear'
    END as fix_reason
  FROM upc_analysis
  ORDER BY
    photo_data,
    scan_time,
    -- Prioritize: proper length > majority > longest
    (CASE WHEN LENGTH(upc) IN (12, 13) THEN 1 ELSE 0 END) DESC,
    upc_count DESC,
    LENGTH(upc) DESC
)
-- Show summary of what will be fixed
SELECT
  scan_time,
  total_items,
  correct_upc,
  fix_reason,
  upcs as all_upcs_in_group,
  item_ids
FROM best_upc
WHERE fix_reason != 'unclear'
ORDER BY scan_time DESC;

-- STATS SUMMARY
-- Uncomment to see overall stats:
/*
WITH photo_groups AS (
  SELECT
    photo_data,
    cost,
    brand,
    DATE_TRUNC('minute', created_at) as scan_time,
    COUNT(*) as total_items,
    ARRAY_AGG(id ORDER BY id) as item_ids,
    ARRAY_AGG(upc ORDER BY id) as upcs
  FROM kickstart_intake
  WHERE photo_data IS NOT NULL
    AND status = 'enriched'
    AND upc IS NOT NULL
  GROUP BY photo_data, cost, brand, DATE_TRUNC('minute', created_at)
  HAVING COUNT(DISTINCT upc) > 1
),
upc_analysis AS (
  SELECT
    pg.*,
    UNNEST(pg.upcs) as upc,
    (SELECT COUNT(*) FROM UNNEST(pg.upcs) u WHERE u = UNNEST(pg.upcs)) as upc_count
  FROM photo_groups pg
),
best_upc AS (
  SELECT DISTINCT ON (photo_data, scan_time)
    photo_data,
    scan_time,
    total_items,
    item_ids,
    upcs,
    upc as correct_upc,
    CASE
      WHEN LENGTH(upc) IN (12, 13) THEN 'proper_length'
      WHEN upc_count > 1 THEN 'majority'
      WHEN LENGTH(upc) = (SELECT MAX(LENGTH(u)) FROM UNNEST(upcs) u) THEN 'longest'
      ELSE 'unclear'
    END as fix_reason
  FROM upc_analysis
  ORDER BY
    photo_data,
    scan_time,
    (CASE WHEN LENGTH(upc) IN (12, 13) THEN 1 ELSE 0 END) DESC,
    upc_count DESC,
    LENGTH(upc) DESC
)
SELECT
  fix_reason,
  COUNT(*) as groups,
  SUM(total_items) as total_items_affected
FROM best_upc
GROUP BY fix_reason
ORDER BY groups DESC;
*/

-- APPLY THE FIX
-- Uncomment this section to actually update the database:
/*
WITH photo_groups AS (
  SELECT
    photo_data,
    cost,
    brand,
    DATE_TRUNC('minute', created_at) as scan_time,
    COUNT(*) as total_items,
    ARRAY_AGG(id ORDER BY id) as item_ids,
    ARRAY_AGG(upc ORDER BY id) as upcs
  FROM kickstart_intake
  WHERE photo_data IS NOT NULL
    AND status = 'enriched'
    AND upc IS NOT NULL
  GROUP BY photo_data, cost, brand, DATE_TRUNC('minute', created_at)
  HAVING COUNT(DISTINCT upc) > 1
),
upc_analysis AS (
  SELECT
    pg.*,
    UNNEST(pg.upcs) as upc,
    (SELECT COUNT(*) FROM UNNEST(pg.upcs) u WHERE u = UNNEST(pg.upcs)) as upc_count
  FROM photo_groups pg
),
best_upc AS (
  SELECT DISTINCT ON (photo_data, scan_time)
    photo_data,
    scan_time,
    total_items,
    item_ids,
    upcs,
    upc as correct_upc,
    CASE
      WHEN LENGTH(upc) IN (12, 13) THEN 'proper_length'
      WHEN upc_count > 1 THEN 'majority'
      WHEN LENGTH(upc) = (SELECT MAX(LENGTH(u)) FROM UNNEST(upcs) u) THEN 'longest'
      ELSE 'unclear'
    END as fix_reason
  FROM upc_analysis
  ORDER BY
    photo_data,
    scan_time,
    (CASE WHEN LENGTH(upc) IN (12, 13) THEN 1 ELSE 0 END) DESC,
    upc_count DESC,
    LENGTH(upc) DESC
),
items_to_fix AS (
  SELECT
    UNNEST(bu.item_ids) as id,
    bu.correct_upc
  FROM best_upc bu
  WHERE bu.fix_reason != 'unclear'
)
UPDATE kickstart_intake
SET upc = items_to_fix.correct_upc
FROM items_to_fix
WHERE kickstart_intake.id = items_to_fix.id
  AND kickstart_intake.upc != items_to_fix.correct_upc;
*/

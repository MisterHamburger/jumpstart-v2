-- Reconcile manifested-load item costs to what was actually paid the vendor.
-- 2026-10-22. Manifest cost_freight came from the liquidator's spreadsheet, which
-- carried a freight estimate; freight is billed separately (Widover/Craneworks)
-- and booked as OPEX, so it was counted twice. Each load's item costs are
-- scaled so they sum to the vendor payment(s) found on the bank/card statements.

-- Safety copy of the rows we touch.
CREATE TABLE IF NOT EXISTS jumpstart_manifest_cost_backup_20261022 AS
SELECT id, load_id, cost_freight FROM jumpstart_manifest
WHERE load_id IN ('1', 'Load 2', 'Load 3', 'Load 4', 'Load 6', 'Load 7');
ALTER TABLE jumpstart_manifest_cost_backup_20261022 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all" ON jumpstart_manifest_cost_backup_20261022;
CREATE POLICY "Allow all" ON jumpstart_manifest_cost_backup_20261022 FOR ALL USING (true) WITH CHECK (true);

WITH f(load_id, paid) AS (VALUES
  ('1',      38716.30),  -- Smartlots 1/20
  ('Load 2', 31383.23),  -- Smartlots 2/19
  ('Load 3',  5132.44),  -- Smartlots 2/11
  ('Load 4',  7617.50),  -- Smartlots 2/17
  ('Load 6', 23261.35),  -- Smartlots 3/17
  ('Load 7', 45721.79)   -- Smartlots 4/1
), s AS (
  SELECT m.load_id, SUM(m.cost_freight) AS manifest_total
  FROM jumpstart_manifest m JOIN f USING (load_id)
  GROUP BY m.load_id
)
UPDATE jumpstart_manifest m
SET cost_freight = ROUND(m.cost_freight * f.paid / s.manifest_total, 4)
FROM f JOIN s USING (load_id)
WHERE m.load_id = f.load_id AND m.cost_freight IS NOT NULL;

UPDATE loads SET total_cost = v.paid,
  notes = COALESCE(NULLIF(notes, '') || ' | ', '') || '[2026-10-22 manifest item costs scaled to vendor payment $' || v.paid || '; freight stays in OPEX]'
FROM (VALUES ('1', 38716.30), ('Load 2', 31383.23), ('Load 3', 5132.44),
             ('Load 4', 7617.50), ('Load 6', 23261.35), ('Load 7', 45721.79)) v(id, paid)
WHERE loads.id = v.id;

-- Check: each load's manifest now sums to the payment (rounding within a few cents).
SELECT load_id, ROUND(SUM(cost_freight), 2) AS manifest_total, COUNT(*) AS rows
FROM jumpstart_manifest
WHERE load_id IN ('1', 'Load 2', 'Load 3', 'Load 4', 'Load 6', 'Load 7')
GROUP BY load_id ORDER BY load_id;

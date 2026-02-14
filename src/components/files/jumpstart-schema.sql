-- ============================================================
-- JUMPSTART DEALS — Database Schema
-- Paste this entire file into Supabase SQL Editor and click "Run"
-- ============================================================

-- ============================================================
-- 1. LOADS — Purchase metadata for each bulk inventory buy
-- ============================================================
CREATE TABLE loads (
  id TEXT PRIMARY KEY,                    -- e.g., 'LOAD-2026-01-15-001'
  date DATE NOT NULL,
  vendor TEXT NOT NULL,                   -- e.g., 'Madewell Returns'
  quantity INTEGER,
  total_cost NUMERIC(10,2),
  freight_per_item NUMERIC(6,2) DEFAULT 0.45,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 2. ITEMS — Every physical item from every manifest
--    One row per item. Barcode is normalized on insert.
-- ============================================================
CREATE TABLE items (
  id BIGSERIAL PRIMARY KEY,
  barcode TEXT NOT NULL,                  -- Normalized: leading zeros stripped
  barcode_raw TEXT,                       -- Original barcode from manifest
  description TEXT,                       -- Product name from manifest
  zone INTEGER,                          -- 1, 2, or 3
  bundle_number TEXT,                     -- For zone 3 items (e.g., '5', 'Leftover')
  msrp NUMERIC(8,2),
  category TEXT,                          -- e.g., 'W KNITS', 'M SHIRTS'
  subclass TEXT,
  size TEXT,
  color TEXT,
  color_code TEXT,
  vendor TEXT,                            -- e.g., 'Madewell', 'J Crew Factory'
  part_number TEXT,                       -- Item code from label (e.g., 'NY338')
  cost NUMERIC(8,2),                      -- What we paid per item
  cost_freight NUMERIC(8,2),              -- cost + freight per item
  load_id TEXT REFERENCES loads(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for barcode lookups (the most common operation)
CREATE INDEX idx_items_barcode ON items(barcode);
CREATE INDEX idx_items_zone ON items(zone);
CREATE INDEX idx_items_load ON items(load_id);

-- ============================================================
-- 3. SHOWS — Metadata for each Whatnot live show
-- ============================================================
CREATE TABLE shows (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,              -- e.g., '2026-02-10-Jumpstart-evening'
  date DATE NOT NULL,
  time_of_day TEXT NOT NULL CHECK (time_of_day IN ('morning', 'evening')),
  channel TEXT NOT NULL CHECK (channel IN ('Jumpstart', 'Kickstart')),
  total_items INTEGER DEFAULT 0,          -- Scannable items (excludes cancelled/failed)
  scanned_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'scanning', 'completed')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Prevent duplicate shows for same slot
CREATE UNIQUE INDEX idx_shows_slot ON shows(date, time_of_day, channel);

-- ============================================================
-- 4. SHOW_ITEMS — Individual listings from Whatnot CSV upload
--    One row per listing number per show
-- ============================================================
CREATE TABLE show_items (
  id BIGSERIAL PRIMARY KEY,
  show_id BIGINT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  listing_number INTEGER NOT NULL,
  product_name TEXT,                       -- Original from CSV, e.g., 'J.Crew & Madewell! #7'
  buyer_paid NUMERIC(8,2) DEFAULT 0,      -- Post-coupon price (what buyer actually paid)
  coupon_code TEXT,
  coupon_amount NUMERIC(8,2) DEFAULT 0,
  original_hammer NUMERIC(8,2) DEFAULT 0, -- buyer_paid + coupon_amount
  status TEXT DEFAULT 'valid' CHECK (status IN ('valid', 'failed', 'cancelled')),
  placed_at TIMESTAMPTZ,
  whatnot_order_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- One listing per show — prevents duplicate uploads
CREATE UNIQUE INDEX idx_show_items_unique ON show_items(show_id, listing_number);
CREATE INDEX idx_show_items_show ON show_items(show_id);

-- ============================================================
-- 5. SCANS — The bridge table. Links barcode → listing number
--    This is where sorting scans AND sales scans live
-- ============================================================
CREATE TABLE scans (
  id BIGSERIAL PRIMARY KEY,
  show_id BIGINT NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,                   -- Normalized barcode
  listing_number INTEGER NOT NULL,
  scanned_by TEXT,                         -- Device/user identifier
  scanned_at TIMESTAMPTZ DEFAULT now()
);

-- Prevent scanning same listing twice for a show
CREATE UNIQUE INDEX idx_scans_unique ON scans(show_id, listing_number);
CREATE INDEX idx_scans_show ON scans(show_id);
CREATE INDEX idx_scans_barcode ON scans(barcode);

-- ============================================================
-- 6. SORT_LOG — Records from general/bundle sorting
--    Separate from sales scans — this is the intake process
-- ============================================================
CREATE TABLE sort_log (
  id BIGSERIAL PRIMARY KEY,
  barcode TEXT NOT NULL,
  zone INTEGER,
  bundle_number TEXT,
  sort_type TEXT CHECK (sort_type IN ('general', 'bundle')),
  session_name TEXT,                       -- e.g., 'LOAD-2026-01-15-001'
  sorted_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sort_log_barcode ON sort_log(barcode);

-- ============================================================
-- 7. EXPENSES — Operating expenses from finance CSV
-- ============================================================
CREATE TABLE expenses (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  description TEXT,
  amount NUMERIC(10,2) NOT NULL,
  category TEXT DEFAULT 'EXPENSES',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 8. PROFITABILITY VIEW — Replaces the 200-line JS function
--    This is a live view that always shows current data
-- ============================================================
CREATE OR REPLACE VIEW profitability AS
SELECT
  s.id AS scan_id,
  i.barcode,
  i.description,
  i.category,
  i.size,
  i.color,
  i.vendor,
  i.msrp,
  i.zone,
  i.cost,
  i.cost_freight,
  i.load_id,
  sh.name AS show_name,
  sh.date AS show_date,
  sh.time_of_day,
  sh.channel,
  si.listing_number,
  si.product_name,
  si.buyer_paid,
  si.coupon_code,
  si.coupon_amount,
  si.original_hammer,
  -- Fee calculation: 7.2% commission + 2.9% processing + $0.30
  ROUND(si.buyer_paid * 0.072, 2) AS commission,
  ROUND(si.buyer_paid * 0.029 + 0.30, 2) AS processing_fee,
  ROUND(si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30, 2) AS total_fees,
  -- Net payout after Whatnot takes their cut
  ROUND(si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30), 2) AS net_payout,
  -- Profit = what we keep minus what we paid
  ROUND(
    si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30) - COALESCE(i.cost_freight, 0),
    2
  ) AS profit,
  -- Margin percentage
  CASE 
    WHEN si.buyer_paid > 0 THEN 
      ROUND(
        ((si.buyer_paid - (si.buyer_paid * 0.072 + si.buyer_paid * 0.029 + 0.30) - COALESCE(i.cost_freight, 0)) 
         / si.buyer_paid) * 100,
        1
      )
    ELSE 0 
  END AS margin
FROM scans s
JOIN items i ON s.barcode = i.barcode
JOIN show_items si ON s.show_id = si.show_id AND s.listing_number = si.listing_number
JOIN shows sh ON s.show_id = sh.id
WHERE si.status = 'valid'
  AND (si.buyer_paid > 0 OR si.original_hammer > 0);

-- ============================================================
-- 9. DASHBOARD SUMMARY VIEW — Aggregate metrics
-- ============================================================
CREATE OR REPLACE VIEW dashboard_summary AS
SELECT
  channel,
  COUNT(*) AS items_sold,
  ROUND(AVG(original_hammer), 2) AS avg_hammer,
  ROUND(AVG(net_payout), 2) AS avg_net,
  ROUND(SUM(net_payout), 2) AS total_net_revenue,
  ROUND(SUM(profit), 2) AS total_profit,
  ROUND(AVG(profit), 2) AS avg_profit_per_item,
  ROUND(AVG(margin), 1) AS avg_margin
FROM profitability
GROUP BY channel;

-- ============================================================
-- 10. ROW LEVEL SECURITY (RLS)
--     For now, allow all access via anon key.
--     We can add proper auth later.
-- ============================================================
ALTER TABLE loads ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shows ENABLE ROW LEVEL SECURITY;
ALTER TABLE show_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE sort_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Allow full access for now (anon key)
CREATE POLICY "Allow all" ON loads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON shows FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON show_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON scans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON sort_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON expenses FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 11. HELPER FUNCTION: Normalize barcode
--     Strips leading zeros, whitespace, apostrophes
-- ============================================================
CREATE OR REPLACE FUNCTION normalize_barcode(raw TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN LTRIM(REGEXP_REPLACE(TRIM(COALESCE(raw, '')), '^[''\\s]+', '', 'g'), '0');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- 12. TRIGGER: Auto-normalize barcodes on insert/update
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_normalize_barcode()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'items' THEN
    NEW.barcode_raw := NEW.barcode;
    NEW.barcode := normalize_barcode(NEW.barcode);
  ELSIF TG_TABLE_NAME = 'scans' THEN
    NEW.barcode := normalize_barcode(NEW.barcode);
  ELSIF TG_TABLE_NAME = 'sort_log' THEN
    NEW.barcode := normalize_barcode(NEW.barcode);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER normalize_items_barcode
  BEFORE INSERT OR UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION trigger_normalize_barcode();

CREATE TRIGGER normalize_scans_barcode
  BEFORE INSERT OR UPDATE ON scans
  FOR EACH ROW EXECUTE FUNCTION trigger_normalize_barcode();

CREATE TRIGGER normalize_sort_log_barcode
  BEFORE INSERT OR UPDATE ON sort_log
  FOR EACH ROW EXECUTE FUNCTION trigger_normalize_barcode();

-- ============================================================
-- 13. AUTO-CALCULATE cost_freight ON INSERT
-- ============================================================
CREATE OR REPLACE FUNCTION calc_cost_freight()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cost IS NOT NULL AND NEW.cost_freight IS NULL THEN
    NEW.cost_freight := NEW.cost + COALESCE(
      (SELECT freight_per_item FROM loads WHERE id = NEW.load_id), 0.45
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_cost_freight
  BEFORE INSERT OR UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION calc_cost_freight();

-- ============================================================
-- DONE! Your database is ready.
-- ============================================================

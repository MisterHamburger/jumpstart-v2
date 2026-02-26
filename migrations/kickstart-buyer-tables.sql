-- Kickstart Buyer Intake Overhaul — 4 new tables
-- Run in Supabase SQL Editor

-- 1. Buyers — simple name list
CREATE TABLE IF NOT EXISTS kickstart_buyers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed buyers
INSERT INTO kickstart_buyers (name) VALUES
  ('Laura'),
  ('Bri'),
  ('Jer')
ON CONFLICT (name) DO NOTHING;

-- RLS
ALTER TABLE kickstart_buyers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON kickstart_buyers FOR ALL USING (true) WITH CHECK (true);

-- 2. Trips — one row per shopping trip
CREATE TABLE IF NOT EXISTS kickstart_trips (
  id BIGSERIAL PRIMARY KEY,
  buyer_id BIGINT REFERENCES kickstart_buyers(id),
  buyer_name TEXT NOT NULL,
  receipt_photo TEXT,            -- base64 JPEG of receipt
  status TEXT DEFAULT 'scanning', -- scanning | submitted | enriching | enriched | matched | finalized
  tag_count INT DEFAULT 0,
  total_cost NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE kickstart_trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON kickstart_trips FOR ALL USING (true) WITH CHECK (true);

-- 3. Receipt items — parsed from receipt photo by AI
CREATE TABLE IF NOT EXISTS kickstart_receipt_items (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT REFERENCES kickstart_trips(id) ON DELETE CASCADE,
  style_number TEXT,
  description TEXT,
  qty INT DEFAULT 1,
  price_each NUMERIC,
  line_total NUMERIC,
  matched BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE kickstart_receipt_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON kickstart_receipt_items FOR ALL USING (true) WITH CHECK (true);

-- 4. Tag photos — one per tag scanned by buyer
CREATE TABLE IF NOT EXISTS kickstart_tag_photos (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT REFERENCES kickstart_trips(id) ON DELETE CASCADE,
  photo_data TEXT,               -- base64 JPEG of tag
  -- AI-extracted fields (filled by enrich-kickstart-v2)
  upc TEXT,
  style_number TEXT,
  brand TEXT,
  description TEXT,
  color TEXT,
  size TEXT,
  msrp NUMERIC,
  -- Cost from receipt matching
  cost NUMERIC,
  receipt_item_id BIGINT REFERENCES kickstart_receipt_items(id),
  status TEXT DEFAULT 'pending_enrichment', -- pending_enrichment | enriched | enrichment_failed | needs_manual
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE kickstart_tag_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON kickstart_tag_photos FOR ALL USING (true) WITH CHECK (true);

-- Index for enrichment queries
CREATE INDEX IF NOT EXISTS idx_tag_photos_status ON kickstart_tag_photos(status);
CREATE INDEX IF NOT EXISTS idx_tag_photos_trip ON kickstart_tag_photos(trip_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_trip ON kickstart_receipt_items(trip_id);

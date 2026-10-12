-- Accounting foundation (Phase 1 of the 2026 books-in-the-app project).
--
-- Goal: the app becomes the system of record for the official 2026 books
-- (income-tax basis, same chart of accounts as the 2025 bookkeeper), with two
-- views of the same numbers: management (net-of-fees, goals/progress) and tax
-- (gross revenue that ties to the Whatnot 1099-Ks).
--
--   1. whatnot_statements: one row per ACCOUNT per period (jumpstartdeals /
--      kickstartdeals were colliding on the period-only unique key), plus the
--      fields needed for the books; seeded with Dec 2025 – Sep 2026 for both
--      accounts (verified: fees sum, opening+earnings−fees−payouts=closing,
--      month-to-month continuity).
--   2. OWNER_DRAW expense category: 2026 transfers to Josh (Regions) and
--      Wesley (Wells Fargo) were categorized PAYROLL. With two members in
--      2026 those are owner draws (or guaranteed payments — accountant to
--      confirm), not W-2 payroll. Reclassified; dashboard PAYROLL drops.
--   3. Tax chart of accounts + gl_rules (description pattern → account) +
--      expenses.gl_account (manual override) + expenses_gl view that resolves
--      every expense to a tax account. Unmatched OPEX lands in 7099 for review.
--   4. Month-end inventory valuation: pool_inventory_at(date) replays the same
--      perpetual-WAC engine as pool_wac_schedule() up to any date;
--      in_transit_inventory_at(date) and manifested_inventory_at(date) cover
--      paid-but-not-landed loads and unsold manifested stock.
--
-- Run in Supabase Dashboard > SQL Editor (one transaction).
-- Date: 2026-10-12

BEGIN;

-- ── 1. Whatnot statements per account ───────────────────────────────────────
ALTER TABLE whatnot_statements
  ADD COLUMN IF NOT EXISTS account TEXT NOT NULL DEFAULT 'jumpstartdeals',
  ADD COLUMN IF NOT EXISTS referral_credits NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_income NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_surcharges NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS order_refunds NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closing_balance NUMERIC(12,2) DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE whatnot_statements
    ADD CONSTRAINT whatnot_statements_account_check
    CHECK (account IN ('jumpstartdeals', 'kickstartdeals'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP INDEX IF EXISTS whatnot_statements_period_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS whatnot_statements_account_period_uniq
  ON whatnot_statements (account, period_start, period_end);

COMMENT ON COLUMN whatnot_statements.account IS
  'Whatnot username the statement belongs to. jumpstartdeals → Sales-JumpStartDeals (4000), kickstartdeals → Sales-KickStartDeals (4001).';
COMMENT ON COLUMN whatnot_statements.total_income IS
  'Whatnot "Total income" = earnings (sales + tips + other adj +) + buyer referral credits. Equals the 1099-K monthly amount — this is gross revenue for the tax books.';
COMMENT ON COLUMN whatnot_statements.other_adjustments IS
  'Whatnot "Other adjustments (-)" (a cost). Fees & costs = commission + processing + show_boost + seller_shipping + shipping_surcharges + order_refunds + other_adjustments.';

INSERT INTO whatnot_statements
  (account, period_start, period_end, period_label, statement_number,
   sales, tips, referral_credits, total_income,
   commission, processing, show_boost, seller_shipping,
   shipping_surcharges, order_refunds, other_adjustments,
   payouts, opening_balance, closing_balance, uploaded_filename, notes)
SELECT v.account, v.period_start::date, v.period_end::date, v.period_label, v.statement_number,
       v.sales, v.tips, v.referral_credits, v.total_income,
       v.commission, v.processing, v.show_boost, v.seller_shipping,
       v.shipping_surcharges, v.order_refunds, v.other_adjustments,
       v.payouts, v.opening_balance, v.closing_balance,
       'Whatnot Seller Hub (captured 2026-10-12)', NULL
FROM (VALUES
('jumpstartdeals','2025-12-01','2025-12-31','December 2025','1548273',57099.45,46.00,15.00,57160.45,4111.09,3183.07,845.48,254.85,0.00,59.94,0.00,48663.88,0.00,27.14),
('jumpstartdeals','2026-01-01','2026-01-31','January 2026',NULL,72299.60,56.00,0.00,72355.60,5206.30,4024.46,1162.58,697.27,0.00,0.00,77.84,61214.29,27.14,0.00),
('jumpstartdeals','2026-02-01','2026-02-28','February 2026',NULL,60415.65,83.00,5.00,60503.65,4196.63,3276.40,605.90,564.47,0.00,0.00,0.00,51855.25,0.00,0.00),
('jumpstartdeals','2026-03-01','2026-03-31','March 2026',NULL,94603.80,68.00,0.00,94671.80,6810.34,4848.29,889.58,614.88,0.00,0.00,67.83,81440.88,0.00,0.00),
('jumpstartdeals','2026-04-01','2026-04-30','April 2026',NULL,124497.50,33.00,0.00,124534.13,8962.16,7168.75,1870.39,631.78,0.00,0.00,55.18,105845.87,0.00,0.00),
('jumpstartdeals','2026-05-01','2026-05-31','May 2026',NULL,63947.80,36.00,0.00,63983.80,4603.39,3977.69,1055.81,400.30,0.00,0.00,4.19,53899.02,0.00,43.40),
('jumpstartdeals','2026-06-01','2026-06-30','June 2026',NULL,159777.00,26.00,0.00,159803.00,10923.62,9274.17,2057.48,610.05,4.15,0.00,14.49,136962.44,43.40,0.00),
('jumpstartdeals','2026-07-01','2026-07-31','July 2026',NULL,202664.40,228.00,0.00,202892.40,14589.22,11449.50,2821.82,1301.43,18.42,21.00,25.58,172678.84,0.00,-13.41),
('jumpstartdeals','2026-08-01','2026-08-31','August 2026',NULL,156273.60,76.00,0.00,156349.60,10743.59,9680.74,2629.46,1331.94,0.00,0.00,18.95,131931.51,-13.41,0.00),
('jumpstartdeals','2026-09-01','2026-09-30','September 2026',NULL,188651.40,60.00,0.00,188711.40,12051.24,10273.18,2392.27,1384.26,0.00,0.00,226.65,162383.80,0.00,0.00),
('kickstartdeals','2025-12-01','2025-12-31','December 2025','1561547',79624.80,67.00,0.00,79691.80,5733.51,3733.30,1003.79,449.70,0.00,57.86,0.00,68746.26,0.00,-32.62),
('kickstartdeals','2026-01-01','2026-01-31','January 2026',NULL,46760.85,2.00,0.00,46762.85,3367.02,2093.97,441.57,202.62,0.00,0.00,30.92,40594.13,-32.62,0.00),
('kickstartdeals','2026-02-01','2026-02-28','February 2026',NULL,12049.95,5.00,0.00,12054.95,867.34,578.73,154.68,71.21,0.00,0.00,0.00,10382.99,0.00,0.00),
('kickstartdeals','2026-03-01','2026-03-31','March 2026',NULL,14605.45,5.00,0.00,14610.45,1051.40,710.89,178.11,124.40,0.00,0.00,40.79,12504.86,0.00,0.00),
('kickstartdeals','2026-04-01','2026-04-30','April 2026',NULL,18304.00,2.00,5.00,18311.00,848.56,812.97,212.32,63.06,0.00,0.00,0.00,16369.09,0.00,0.00),
('kickstartdeals','2026-05-01','2026-05-31','May 2026',NULL,25936.00,0.00,0.00,25936.00,2046.81,1141.56,301.66,162.98,0.00,46.00,42.32,22194.67,0.00,0.00),
('kickstartdeals','2026-06-01','2026-06-30','June 2026',NULL,46422.00,16.00,0.00,46438.00,3353.82,2393.80,475.44,119.48,0.00,33.00,9.34,40053.12,0.00,0.00),
('kickstartdeals','2026-07-01','2026-07-31','July 2026',NULL,19911.00,0.00,0.00,19911.00,1463.85,901.29,159.52,59.41,0.00,0.00,0.00,17326.93,0.00,0.00),
('kickstartdeals','2026-08-01','2026-08-31','August 2026',NULL,5628.00,0.00,0.00,5628.00,405.25,332.23,90.29,35.76,0.00,0.00,38.02,4726.45,0.00,0.00),
('kickstartdeals','2026-09-01','2026-09-30','September 2026',NULL,3713.00,0.00,0.00,3713.00,267.31,173.98,38.11,26.82,0.00,0.00,0.00,3206.78,0.00,0.00)
) AS v(account, period_start, period_end, period_label, statement_number,
       sales, tips, referral_credits, total_income,
       commission, processing, show_boost, seller_shipping,
       shipping_surcharges, order_refunds, other_adjustments,
       payouts, opening_balance, closing_balance)
ON CONFLICT (account, period_start, period_end) DO UPDATE SET
  period_label = EXCLUDED.period_label, statement_number = COALESCE(EXCLUDED.statement_number, whatnot_statements.statement_number),
  sales = EXCLUDED.sales, tips = EXCLUDED.tips, referral_credits = EXCLUDED.referral_credits, total_income = EXCLUDED.total_income,
  commission = EXCLUDED.commission, processing = EXCLUDED.processing, show_boost = EXCLUDED.show_boost,
  seller_shipping = EXCLUDED.seller_shipping, shipping_surcharges = EXCLUDED.shipping_surcharges,
  order_refunds = EXCLUDED.order_refunds, other_adjustments = EXCLUDED.other_adjustments,
  payouts = EXCLUDED.payouts, opening_balance = EXCLUDED.opening_balance, closing_balance = EXCLUDED.closing_balance;

-- ── 2. Owner draws ──────────────────────────────────────────────────────────
-- The dashboard RPC aggregates expenses by exact category, so OWNER_DRAW (like
-- TRANSFER) is automatically excluded from OpEx/Payroll/net profit.
UPDATE expenses SET category = 'OWNER_DRAW'
WHERE date >= DATE '2026-01-01'
  AND category = 'PAYROLL'
  AND (description ILIKE '%Regions Bank - Josh Sizemore%'
       OR description ILIKE '%Wesley Teague%');

-- ── 3. Chart of accounts, mapping rules, resolved view ──────────────────────
CREATE TABLE IF NOT EXISTS gl_accounts (
  code TEXT PRIMARY KEY,           -- '7050'
  name TEXT NOT NULL,              -- 'Rent'
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','cogs','expense','other')),
  section TEXT,                    -- income-statement grouping: Sales / Cost of Sales / Labor / Operating / Other
  sort INT NOT NULL DEFAULT 0
);

INSERT INTO gl_accounts (code, name, type, section, sort) VALUES
  ('1000','Checking-Amex Profit','asset',NULL,1000), ('1001','Checking-Operating','asset',NULL,1001),
  ('1002','Checking-COGS','asset',NULL,1002), ('1003','Checking-Regions Profit','asset',NULL,1003),
  ('1004','Checking-Amex Owners Pay','asset',NULL,1004), ('1011','Undeposited Funds','asset',NULL,1011),
  ('1012','Venmo Balance','asset',NULL,1012), ('1015','Inventory-Jumpstart','asset',NULL,1015),
  ('1016','Inventory-Kickstart','asset',NULL,1016),
  ('2001','Credit Card Payable-Amex Gold','liability',NULL,2001), ('2002','Credit Card Payable-Amex Blue','liability',NULL,2002),
  ('2003','Credit Card Payable-Chase','liability',NULL,2003), ('2500','Jeremiah Sizemore-Note Payable','liability',NULL,2500),
  ('3000','Equity-Owner Investment','equity',NULL,3000), ('3002','Retained Earnings','equity',NULL,3002),
  ('3010','Owner Draws','equity',NULL,3010),
  ('4000','Sales-JumpStartDeals','revenue','Sales',4000), ('4001','Sales-KickStartDeals','revenue','Sales',4001),
  ('4002','Sales-PayPal','revenue','Sales',4002), ('4004','Sales-Wholesale','revenue','Sales',4004),
  ('4005','Refunds','revenue','Sales',4005),
  ('5000','Cost of Goods Sold','cogs','Cost of Sales',5000),
  ('6000','Wages','expense','Labor',6000), ('6005','Payroll Taxes','expense','Labor',6005),
  ('6050','Contract Labor','expense','Labor',6050), ('6060','Payroll Processing Fees','expense','Labor',6060),
  ('7000','Bank Fees and Service Charges','expense','Operating',7000), ('7005','Dues & Subscriptions','expense','Operating',7005),
  ('7010','Electronics','expense','Operating',7010), ('7012','Finance Charges','expense','Operating',7012),
  ('7015','Insurance','expense','Operating',7015), ('7020','Legal & Accounting Fees','expense','Operating',7020),
  ('7025','Licenses & Fees','expense','Operating',7025), ('7030','Marketing Expense','expense','Operating',7030),
  ('7035','Meals & Entertainment','expense','Operating',7035), ('7040','Office Expenses','expense','Operating',7040),
  ('7045','Office Supplies','expense','Operating',7045), ('7050','Rent','expense','Operating',7050),
  ('7055','Shipping','expense','Operating',7055), ('7060','Shipping Supplies','expense','Operating',7060),
  ('7065','Supplies & Materials','expense','Operating',7065), ('7070','Travel','expense','Operating',7070),
  ('7075','Utilities','expense','Operating',7075),
  ('7080','Whatnot-Commission Fees','expense','Operating',7080), ('7085','Whatnot-Pmt Processing Fees','expense','Operating',7085),
  ('7090','Whatnot-Seller S&H','expense','Operating',7090), ('7095','Whatnot-Show Boost & Promote','expense','Operating',7095),
  ('7099','Unmapped Operating (review)','expense','Operating',7099),
  ('8000','Contract Labor-Executive','other','Other',8000), ('8005','Credit Card Rewards','other','Other',8005),
  ('8010','Interest Income','other','Other',8010), ('8020','Other Income - Card Reconciliation','other','Other',8020)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type, section = EXCLUDED.section, sort = EXCLUDED.sort;

CREATE TABLE IF NOT EXISTS gl_rules (
  id BIGSERIAL PRIMARY KEY,
  priority INT NOT NULL DEFAULT 100,       -- lower wins
  category TEXT,                           -- NULL = any expense category
  pattern TEXT NOT NULL,                   -- ILIKE pattern on expenses.description
  gl_account TEXT NOT NULL REFERENCES gl_accounts(code),
  note TEXT,
  UNIQUE NULLS NOT DISTINCT (category, pattern)
);

-- Category defaults (priority 1000) + vendor rules. Conventions follow the
-- 2025 bookkeeper, updated for 2026 decisions: Pirate Ship/UPS → Shipping
-- (accountant, 2026-05-06), sourcing-team Venmo → Contract Labor, Craneworks
-- (forklift unloading inventory trucks) → Shipping, Ever Lesli (payroll-only
-- service in 2026) → Payroll Processing Fees.
INSERT INTO gl_rules (priority, category, pattern, gl_account, note) VALUES
  (1000,'INVENTORY','%','5000','Inventory purchases (periodic method: COGS = purchases ± inventory change)'),
  (1000,'SOURCING','%','5000','Kickstart sourcing purchases'),
  (1000,'PAYROLL','%','6000','Intuit payroll cash (net pay + taxes); split to taxes/contractors at month close'),
  (1000,'PAYROLL_SOURCING','%','6050','Sourcing team (Venmo)'),
  (1000,'OWNER_DRAW','%','3010','Owner draws (accountant: draws vs guaranteed payments)'),
  (1000,'TRANSFER','%','3000','Owner capital contribution'),
  (1000,'OPEX','%','7099','Unmapped — assign a rule or override'),
  (10,NULL,'%3720 4th ave%','7050','Warehouse rent'),
  (10,NULL,'%irondale micro%','7050','YSI Irondale Microflex rent'),
  (10,NULL,'%craneworks%','7055','Forklift unloading of inventory trucks'),
  (20,NULL,'%pirate ship%','7055',NULL), (20,NULL,'ups%','7055',NULL), (20,NULL,'%usps%','7055',NULL), (20,NULL,'%fedex%','7055',NULL),
  (20,NULL,'%ever lesli%','6060','Payroll service (2026)'),
  (30,'OPEX','%intuit%','6060',NULL), (30,NULL,'%qbooks payroll%','6060',NULL),
  (30,NULL,'%chubb%','7015',NULL), (30,NULL,'%state farm%','7015',NULL),
  (30,NULL,'%alabama power%','7075',NULL), (30,NULL,'%spectrum%','7075','Internet'),
  (30,NULL,'%interest charge%','7012',NULL),
  (30,NULL,'%membership fee%','7000','Card annual/renewal fee'), (30,NULL,'%ach fee%','7000',NULL),
  (30,NULL,'%wire transfer fee%','7000',NULL), (30,NULL,'%transaction fee%','7000',NULL),
  (30,NULL,'%bill.com%','7000',NULL),
  (40,'OPEX','%whatnot%','7030','Whatnot card charges (boosts/promotions)'),
  (40,NULL,'%indeed%','7030','Job ads'),
  (40,NULL,'%7shifts%','7040',NULL),
  (40,NULL,'%anthropic%','7005',NULL), (40,NULL,'%claude.ai%','7005',NULL), (40,NULL,'%netlify%','7005',NULL),
  (40,NULL,'%shopify%','7005',NULL), (40,NULL,'%apple.com%','7005',NULL), (40,NULL,'%juniper%','7005',NULL),
  (50,NULL,'%amazon%','7045',NULL), (50,NULL,'%home depo%','7045',NULL), (50,NULL,'%lowe''s%','7045',NULL),
  (50,NULL,'%walmart%','7045',NULL), (50,NULL,'%wal-mart%','7045',NULL), (50,NULL,'%target%','7045',NULL),
  (50,NULL,'%dollar general%','7045',NULL), (50,NULL,'%alibaba%','7045',NULL),
  (60,NULL,'%wynn%','7070',NULL), (60,NULL,'%airline%','7070',NULL), (60,NULL,'%dollar rent a car%','7070',NULL),
  (60,NULL,'%delta air%','7070',NULL), (60,NULL,'%southwest%','7070',NULL), (60,NULL,'%marriott%','7070',NULL),
  (60,NULL,'%rwlv%','7070','Resorts World Las Vegas'),
  (70,NULL,'%coffee%','7035',NULL), (70,NULL,'%starbucks%','7035',NULL), (70,NULL,'%uber eats%','7035',NULL),
  (70,NULL,'%doordash%','7035',NULL), (70,NULL,'dd %','7035',NULL), (70,NULL,'aplpay dd%','7035',NULL),
  (70,NULL,'%kroger%','7035',NULL), (70,NULL,'%publix%','7035',NULL), (70,NULL,'%piggly wiggly%','7035',NULL),
  (70,NULL,'%joyland%','7035',NULL), (70,NULL,'%edible.com%','7035',NULL)
ON CONFLICT (category, pattern) DO UPDATE SET priority = EXCLUDED.priority, gl_account = EXCLUDED.gl_account, note = EXCLUDED.note;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS gl_account TEXT REFERENCES gl_accounts(code);
COMMENT ON COLUMN expenses.gl_account IS 'Manual tax-account override. NULL = resolved by gl_rules (see expenses_gl).';

-- Capital from Jeremiah Sizemore: the 2024-10-22 $30,000 is the note payable;
-- the 2026 wires ($500 + $29,500 in Feb, $70,000 in Mar) are an equity
-- investment (Josh, 2026-10-12).
UPDATE expenses SET gl_account = '2500'
WHERE category = 'TRANSFER' AND date < DATE '2025-01-01' AND description ILIKE '%jeremiah sizem%';
UPDATE expenses SET gl_account = '3000'
WHERE category = 'TRANSFER' AND date >= DATE '2026-01-01' AND description ILIKE '%jeremiah sizemore%';

CREATE OR REPLACE VIEW expenses_gl AS
SELECT e.*,
       COALESCE(e.gl_account, r.gl_account) AS gl_code,
       CASE WHEN e.gl_account IS NOT NULL THEN 'override' ELSE 'rule' END AS gl_source,
       r.id AS gl_rule_id
FROM expenses e
LEFT JOIN LATERAL (
  SELECT gr.id, gr.gl_account
  FROM gl_rules gr
  WHERE (gr.category IS NULL OR gr.category = e.category)
    AND e.description ILIKE gr.pattern
  ORDER BY gr.priority, gr.id
  LIMIT 1
) r ON true;

-- ── 4. Month-end inventory valuation ────────────────────────────────────────
-- Same arrivals/sales/blend rules as pool_wac_schedule(), replayed through
-- p_date (inclusive). Returns units on hand and the running WAC at end of day.
CREATE OR REPLACE FUNCTION pool_inventory_at(p_date date)
RETURNS TABLE (pool_tag text, units numeric, avg_cost numeric, value numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  r record; cur_tag text := NULL; q numeric := 0; w numeric := NULL;
BEGIN
  FOR r IN
    WITH tags AS (SELECT DISTINCT l.pool_tag AS tag FROM loads l WHERE l.pool_tag IS NOT NULL),
    arrivals AS (
      SELECT l.pool_tag AS tag, COALESCE(l.landed_at, l.date) AS d,
             SUM(l.quantity)::numeric AS qty, SUM(l.total_cost)::numeric AS cost
      FROM loads l
      WHERE l.pool_tag IS NOT NULL AND l.date IS NOT NULL AND l.quantity IS NOT NULL
        AND l.quantity <> 0 AND l.landed = true AND COALESCE(l.landed_at, l.date) <= p_date
      GROUP BY 1, 2
    ),
    sales AS (
      SELECT x.tag, x.d, SUM(x.n)::numeric AS n FROM (
        SELECT s.barcode AS tag, sh.date AS d, COUNT(*) AS n
        FROM jumpstart_sold_scans s JOIN shows sh ON sh.id = s.show_id
        WHERE s.barcode IN (SELECT tag FROM tags) AND sh.date <= p_date AND COALESCE(sh.is_test, false) = false
        GROUP BY 1, 2
        UNION ALL
        SELECT s.barcode, sh.date, COUNT(*)
        FROM kickstart_sold_scans s JOIN shows sh ON sh.id = s.show_id
        WHERE s.barcode IN (SELECT tag FROM tags) AND sh.date <= p_date AND COALESCE(sh.is_test, false) = false
        GROUP BY 1, 2
        UNION ALL
        SELECT bs.barcode, bb.sold_at::date, COUNT(*)
        FROM jumpstart_bundle_scans bs JOIN jumpstart_bundle_boxes bb ON bb.box_number = bs.box_number
        WHERE bs.barcode IN (SELECT tag FROM tags) AND bb.sold_at::date <= p_date AND bb.sale_price IS NOT NULL
        GROUP BY 1, 2
        UNION ALL
        SELECT COALESCE(rb.pool_tag, 'RDM'), rb.sold_at::date, SUM(rb.quantity)
        FROM rdm_bundle_sales rb
        WHERE rb.sold_at::date <= p_date AND rb.quantity > 0
        GROUP BY 1, 2
      ) x GROUP BY x.tag, x.d
    )
    SELECT a.tag, a.d, 0 AS ord, a.qty, a.cost, 0::numeric AS sold FROM arrivals a
    UNION ALL
    SELECT sa.tag, sa.d, 1, 0::numeric, 0::numeric, sa.n FROM sales sa
    UNION ALL
    SELECT t.tag, p_date, 2, 0::numeric, 0::numeric, 0::numeric FROM tags t   -- end-of-day marker
    ORDER BY 1, 2, 3
  LOOP
    IF cur_tag IS DISTINCT FROM r.tag THEN cur_tag := r.tag; q := 0; w := NULL; END IF;
    IF r.ord = 0 THEN
      IF q > 0 AND q + r.qty > 0 THEN w := (q * w + r.cost) / (q + r.qty);
      ELSIF r.qty > 0 THEN w := r.cost / r.qty; END IF;
      q := q + r.qty;
    ELSIF r.ord = 1 THEN
      q := q - r.sold;
    ELSE
      pool_tag := r.tag; units := q; avg_cost := ROUND(COALESCE(w, 0), 4);
      value := ROUND(GREATEST(q, 0) * COALESCE(w, 0), 2);
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;

-- Paid-for pool loads not yet landed at p_date (owned, in transit), at cost.
CREATE OR REPLACE FUNCTION in_transit_inventory_at(p_date date)
RETURNS TABLE (load_id text, pool_tag text, units numeric, value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT l.id, l.pool_tag, l.quantity::numeric, l.total_cost::numeric
  FROM loads l
  WHERE l.pool_tag IS NOT NULL AND COALESCE(l.is_opening, false) = false
    AND l.date <= p_date
    AND (l.landed = false OR COALESCE(l.landed_at, l.date) > p_date);
$$;

-- Manifested (per-barcode) loads: landed manifest cost less the cost of
-- manifested items sold through p_date. Floors at zero per load family; the
-- app treats manifested stock as fully depleted once the pools took over.
CREATE OR REPLACE FUNCTION manifested_inventory_at(p_date date)
RETURNS TABLE (landed_cost numeric, sold_cost numeric, value numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH landed AS (
    SELECT COALESCE(SUM(m.cost_freight), 0)::numeric AS c
    FROM jumpstart_manifest m JOIN loads l ON l.id = m.load_id
    WHERE l.kind = 'manifested' AND COALESCE(l.landed_at, l.date) <= p_date
  ),
  sold AS (
    SELECT COALESCE(SUM(p.cost_freight), 0)::numeric AS c
    FROM profitability p
    WHERE p.show_date <= p_date AND p.item_status = 'valid'
      AND COALESCE(p.is_wac_cost, false) = false AND COALESCE(p.is_custom_cost, false) = false
      AND p.barcode IN (SELECT barcode FROM jumpstart_manifest)
  )
  SELECT landed.c, sold.c, GREATEST(landed.c - sold.c, 0) FROM landed, sold;
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';

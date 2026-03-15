# CLAUDE.md — Jumpstart V2

## What is Jumpstart?

Jumpstart is a livestream liquidation business that buys retail inventory loads (J.Crew, Madewell, Free People, Urban Outfitters, Anthropologie) and sells them through live auctions on Whatnot. This app manages inventory scanning, sorting, sales tracking, and profitability analysis.

**Maintained by:** Jer (Jeremy Carter) — Operations Consultant
**GitHub:** https://github.com/MisterHamburger/jumpstart-v2
**Live URL:** https://jumpstartscanner.netlify.app
**Supabase:** https://dqilknhyevkecjnmnumx.supabase.co

---

## Tech Stack

- **Frontend:** React 19 + Vite 6 + Tailwind CSS 3.4
- **Backend:** Supabase (PostgreSQL)
- **Hosting:** Netlify (static site + serverless functions)
- **AI:** Anthropic Claude API (tag photo enrichment)
- **Email:** Resend API (automated monthly reports)
- **Barcode scanning:** Html5-qrcode library (in-browser camera)
- **External scanner:** CodeREADr (for sort scanning)
- **PDF generation:** jsPDF + jspdf-autotable
- **CSV parsing:** PapaParse
- **Icons:** Iconify (Lucide icon set via CDN)
- **Fonts:** Cabinet Grotesk (headings) + Satoshi (body) via Fontshare

### Environment Variables

**Frontend (.env file):**
```
VITE_SUPABASE_URL=https://dqilknhyevkecjnmnumx.supabase.co
VITE_SUPABASE_ANON_KEY=<key>
```

**Netlify Functions (set in Netlify dashboard):**
```
ANTHROPIC_API_KEY=<key>
SUPABASE_URL=<same as above>
SUPABASE_ANON_KEY=<same as above>
RESEND_API_KEY=<key>
REPORT_TO_EMAIL=jeremydcarter@gmail.com
```

**CRITICAL:** VITE_ prefixed env vars in Netlify must NOT be marked as "Contains secret values" — secrets don't get passed to the Vite build process, causing "Invalid supabaseUrl" errors in production.

---

## Deploy Command

```bash
cd ~/Desktop/jumpstart-v2 && npm run build && echo '/* /index.html 200' > dist/_redirects && npx netlify deploy --prod --dir=dist --functions=netlify/functions
```

Always add the `_redirects` file — it enables client-side routing.

---

## Two Channels

The business runs two channels with separate inventory and barcode systems:

| | Jumpstart | Kickstart |
|---|---|---|
| **Brands** | J.Crew, Madewell | Free People, Urban Outfitters, Anthropologie |
| **Barcode prefix** | 099 (normalized to 99) | 198 |
| **Sales scan table** | `jumpstart_sold_scans` | `kickstart_sold_scans` |
| **Intake table** | `jumpstart_manifest` | `kickstart_intake` |
| **Sort table** | `jumpstart_sort_log` | — |

Channel-aware barcode filtering prevents cross-contamination during scanning.

---

## Data Flow (CRITICAL — Read This First)

### 1. How Data Gets Populated

**Load arrives (bulk inventory purchase):**
- `loads` — manually entered (cost of the load, date, supplier)
- `jumpstart_manifest` — imported from liquidator CSV/Excel. Contains every physical item: barcode, description, color, style, size, category, vendor, MSRP, cost_freight. ALWAYS has duplicate barcodes (multiple physical items share same barcode).

**Sorting inventory (warehouse):**
- `jumpstart_sort_log` — GeneralSort scanner. Scan barcode → lookup zone by MSRP → save barcode + zone.
- `jumpstart_bundle_scans` — BundleSort scanner. Scan items into numbered boxes. Save barcode + box_number.
- `kickstart_intake` — KickstartSort scanner. Select bin price → brand → photo tag → quantity → save. AI enrichment extracts details. **NO BARCODE SCANNING** — Kickstart items use photo + details form, not barcodes.

**Show setup (before Whatnot live):**
- `shows` — manually created. Name, date, channel, total_items, status.
- `show_items` — imported from Whatnot listing CSV. Each row = listing_number + barcode + price. Status = valid/invalid.

**During live show (scanning sales):**
- `jumpstart_sold_scans` — SalesScanner. Scan barcode → enter yellow sticker listing number → save. One row per item sold.
- `kickstart_sold_scans` — same for Kickstart shows.

**After show:**
- `profitability` view — joins show_items → manifest to calculate per-item profit. Includes Whatnot sales (both channels) + bundle sales (both channels) via UNION ALL. Bundles have 0% fees (sold outside Whatnot). Each bundle item gets proportional share of box sale_price.
- `profitability_summary` view — aggregates by show

### 2. Table Relationships

```
loads (1) ──→ jumpstart_manifest (many) via load_id
shows (1) ──→ show_items (many) via show_id
shows (1) ──→ jumpstart_sold_scans (many) via show_id
show_items ──→ jumpstart_manifest via barcode (MUST use DISTINCT ON)
jumpstart_sold_scans ──→ jumpstart_manifest via barcode (MUST use DISTINCT ON)
jumpstart_bundle_scans ──→ jumpstart_manifest via barcode (through bundle_manifest view)
kickstart_sold_scans ──→ kickstart_intake via intake_id or barcode
```

### 3. Source of Truth for Each Data Point

| Data Point | Source of Truth | Table/Column |
|---|---|---|
| Item cost (what we paid) | Liquidator manifest | `jumpstart_manifest.cost_freight` |
| Item MSRP | Liquidator manifest | `jumpstart_manifest.msrp` |
| Item description/details | Liquidator manifest | `jumpstart_manifest.*` |
| Revenue (what it sold for) | Whatnot CSV | `show_items.buyer_paid` |
| What sold (item count) | Whatnot CSV | `show_items WHERE status='valid'` — NOT scans table |
| Barcode scanned during sale | SalesScanner | `jumpstart_sold_scans.barcode` |
| Fees | Calculated | 7.2% commission + 2.9% + $0.30 (see `src/lib/fees.js`) |
| Profit | Calculated | Revenue - cost - fees (`profitability` view) |

### 4. Why Counts Can Differ

| Table | What It Counts |
|---|---|
| `show_items WHERE status='valid'` | Items listed and sold on Whatnot (source of truth for revenue) |
| `jumpstart_sold_scans` unique listings | Items physically scanned during the show |

These can differ because:
- Some items sell without being scanned (scanner missed, no barcode on item)
- Some scanned items get cancelled/failed after scanning
- `show_items` may have empty barcodes if the Whatnot CSV didn't include them

**For profitability:** Use `show_items` as source of truth (has revenue data)
**For unsold inventory:** Use `jumpstart_sold_scans` (has barcode data for cost lookup)

### 5. Important Data Rules

- **Business start date:** 2026-02-07. All date ranges must clamp to this. Expenses table has years of old data that must be excluded.
- **Dashboard RPC:** net_revenue and gross_profit must be DERIVED (revenue - fees, net_revenue - cogs) not independently summed, to avoid per-row rounding mismatches.
- **Kickstart "bad barcode" items:** These are OLD items from before the workflow change. They were sold via Whatnot shows but the scan barcode didn't match intake records. The 534 bad barcode items are historical — new Kickstart items use intake_id matching, not barcodes.

---

## File Structure

```
src/
├── App.jsx                    # Routes
├── main.jsx                   # Entry point
├── index.css                  # Design system: CSS vars, glass-card, glows, blobs
├── lib/
│   ├── supabase.js            # Supabase client init
│   ├── barcodes.js            # normalizeBarcode(), isLiquidatorBarcode()
│   ├── fees.js                # calculateFees(), calculateProfit()
│   ├── kickstartPdf.js        # PDF generation for Kickstart
│   └── photos.js              # Photo compression utilities
├── pages/
│   ├── Home.jsx               # Homepage with navigation (glass cards, iconify icons)
│   ├── SortingSelect.jsx      # Choose sort type
│   ├── GeneralSort.jsx        # Jumpstart sort scanner
│   ├── KickstartSort.jsx      # Kickstart intake: bin→brand→photo→qty→save
│   ├── KickstartBuyer.jsx     # Kickstart buyer management
│   ├── BundleSort.jsx         # Bundle scanning
│   ├── SalesSetup.jsx         # Pick show to scan for sales
│   ├── SalesScanner.jsx       # Live show barcode scanning
│   ├── ItemLookup.jsx         # Item lookup (accessible via long-press on Home title)
│   └── Admin.jsx              # Admin panel router
├── components/
│   ├── AdminDashboard.jsx     # P&L dashboard with channel tabs
│   ├── AdminInputs.jsx        # Data input management (loads, shows, manifests)
│   ├── AdminInventory.jsx     # Inventory views
│   ├── AdminProfitability.jsx # Per-item profitability analysis
│   ├── AdminAnalytics.jsx     # Analytics: Category, Zone, MSRP Tier, Bundle Candidates, Inventory Aging, Load ROI, Show Performance
│   ├── AdminDataCheck.jsx     # 18 data integrity cross-checks
│   ├── AdminScans.jsx         # Scan monitoring
│   ├── AdminKickstartHauls.jsx # Kickstart haul tracking
│   └── AdminUnknownItems.jsx  # Unknown item management
└── components/files/          # Legacy/unused components

netlify/functions/
├── enrich-kickstart.js        # AI tag photo enrichment (original)
├── enrich-kickstart-v2.js     # AI tag photo enrichment (v2)
├── monthly-report.js          # Monthly email report (callable via HTTP)
├── monthly-report-scheduled.js # Scheduled wrapper — runs 1st of each month at 9am ET
├── match-kickstart-trip.js    # Kickstart trip matching
├── parse-receipt.js           # Receipt parsing
└── read-tags.js               # Legacy/unused

migrations/                    # SQL migration files (keep in sync with Supabase)
├── add-bundle-shipping-fields.sql
├── add-bundles-to-profitability.sql
├── create-dashboard-summary-rpc.sql
├── fix-kickstart-true-cost.sql
├── kickstart-buyer-tables.sql
├── rename-expenses-to-opex.sql
└── restore-profitability-summary-function.sql
```

---

## Admin Panel Tabs

The Admin page (`/admin`) has a sidebar with these tabs:

| Tab | Component | Description |
|---|---|---|
| Dashboard | AdminDashboard.jsx | P&L overview by channel, date range filtering |
| Inputs | AdminInputs.jsx | Upload loads, shows, manifests, Whatnot CSVs |
| Inventory | AdminInventory.jsx | Browse manifest items, filter/search |
| Profitability | AdminProfitability.jsx | Per-item profit breakdown by show |
| Analytics | AdminAnalytics.jsx | 7 sub-tabs: Category, Zone, MSRP Tier, Bundle Candidates, Inventory Aging, Load ROI, Show Performance |
| Data Check | AdminDataCheck.jsx | 18 automated data integrity checks |
| Scans | AdminScans.jsx | View/monitor barcode scans |
| Kickstart | AdminKickstartHauls.jsx | Kickstart haul tracking |

### Analytics Sub-tabs (AdminAnalytics.jsx)

- **Inventory Aging** — Groups unsold items by age/category/zone/load. KPIs: unsold count, capital tied up, sell-through rate, avg unsold cost. Lazy-loaded.
- **Load ROI** — Maps sold items to loads via barcode→manifest→load_id. Shows per-load cost, sold count, revenue, profit, ROI%, margin. Lazy-loaded.
- **Show Performance** — Groups profitability items by show_name. Per-show metrics: items, revenue, profit, margin.

### Data Checks (AdminDataCheck.jsx)

18 checks including cross-checks:
- Check 15: Inventory Accounting (sold + unsold = total manifest)
- Check 16: Analytics Sold = Dashboard Items (JS)
- Check 17: Analytics Profit = Dashboard GP (JS) — tolerance is 0.1% of GP
- Check 18: Load Items Sum = Manifest Total

---

## Database Tables (Supabase)

### Core Tables

**`shows`** — Each Whatnot live show
- id, name, date, channel (Jumpstart/Kickstart), total_items, status

**`show_items`** — Items assigned to a show
- id, show_id, listing_number, barcode, status (valid/invalid)

**`jumpstart_manifest`** — J.Crew/Madewell inventory from load manifests
- barcode, description, category, cost, msrp, etc.
- **⚠️ ALWAYS has duplicate barcodes** — multiple physical items share the same barcode. Any JOIN to this table MUST use `DISTINCT ON (barcode)` or a subquery with `LIMIT 1` to avoid row multiplication.

**`kickstart_intake`** — Free People/UO/Anthro inventory
- id, upc, style_number, brand, description, color, size, msrp, cost, photo_data, status (pending_enrichment/enriched/needs_manual/enrichment_failed)

**`jumpstart_sold_scans`** — Barcodes scanned during Jumpstart shows
- id, show_id, barcode, listing_number, scanned_at
- **⚠️ COUNTING SOLD ITEMS:** Count unique `listing_number` per show, NOT row count.

**`kickstart_sold_scans`** — Barcodes scanned during Kickstart shows
- id, show_id, barcode, listing_number, scanned_at, intake_id
- Same counting rule as above

**`jumpstart_sort_log`** — Sort scanner results
- id, barcode, zone, timestamp

**`jumpstart_bundle_boxes`** / **`jumpstart_bundle_scans`** — Bundle tracking
- `jumpstart_bundle_scans` has: id, box_number, barcode, scanned_at

**`loads`** — Inventory load purchases
**`expenses`** — Business expenses (filter to >= 2026-02-07 to exclude old data)

### Views (read-only)

- `dashboard_summary` — Aggregated dashboard stats
- `load_summary` — Load-level summaries
- `profitability` — Item-level profitability joining scans + manifest + show data (includes bundles via UNION ALL)
- `profitability_summary` — Show-level profitability aggregation
- `unique_items` — Deduplicated inventory
- `bundle_manifest` — Joins `jumpstart_bundle_scans` to `jumpstart_manifest` via `DISTINCT ON (barcode)`

### RPC Functions

- `get_dashboard_summary(date_cutoff, date_end)` — Returns per-channel revenue, fees, net_revenue, cogs, gross_profit. Net revenue and gross profit are DERIVED (not independently summed) to avoid rounding mismatches.

### Database Triggers

**Universal barcode normalization** — `normalize_barcode_universal()` strips leading zeros via `LTRIM(barcode, '0')`. Applied on INSERT and UPDATE to:

- `jumpstart_bundle_scans`
- `jumpstart_sold_scans`
- `jumpstart_sort_log`
- `kickstart_sold_scans`

### RLS (Row Level Security)

All tables have RLS enabled with "Allow all" policies. Private app — RLS policies grant full access to the anon key.

---

## Barcode Normalization (CRITICAL)

⚠️ **This is the #1 recurring issue in the system.** Barcodes from liquidator loads start with `099` prefix. The manifest stores them normalized (no leading zeros: `99107871955`). If barcodes aren't normalized before saving, JOINs fail and data shows as NULL.

### Three layers of protection (all must remain in place):

**1. Client-side:** `normalizeBarcode()` in `src/lib/barcodes.js` strips leading zeros, quotes, whitespace.

**2. Database triggers:** `normalize_barcode_universal()` on ALL barcode tables. Fires on INSERT and UPDATE.

**3. Emergency fix SQL:** If NULL/unmatched data appears:
```sql
UPDATE jumpstart_bundle_scans SET barcode = LTRIM(barcode, '0') WHERE barcode LIKE '0%';
UPDATE jumpstart_sold_scans SET barcode = LTRIM(barcode, '0') WHERE barcode LIKE '0%';
UPDATE jumpstart_sort_log SET barcode = LTRIM(barcode, '0') WHERE barcode LIKE '0%';
UPDATE kickstart_sold_scans SET barcode = LTRIM(barcode, '0') WHERE barcode LIKE '0%';
```

### When adding new tables with barcode columns:

ALWAYS add the normalization trigger:
```sql
CREATE TRIGGER normalize_barcode_trigger
BEFORE INSERT OR UPDATE ON <new_table_name>
FOR EACH ROW EXECUTE FUNCTION normalize_barcode_universal();
```

### Manifest duplicate barcodes:

`jumpstart_manifest` ALWAYS has duplicate barcodes. Any query that JOINs to it MUST deduplicate:
```sql
-- CORRECT: Use DISTINCT ON in a subquery
LEFT JOIN (
  SELECT DISTINCT ON (barcode) *
  FROM jumpstart_manifest
  ORDER BY barcode, id
) m ON m.barcode = bs.barcode

-- WRONG: Direct join (will multiply rows)
LEFT JOIN jumpstart_manifest m ON m.barcode = bs.barcode
```

---

## UI Design System

### Color Palette
- **Primary Teal:** #20b2aa (mapped to Tailwind `cyan-*` classes)
- **Primary Magenta:** #dd33a7 (mapped to Tailwind `pink-*` classes)
- **Background:** #0f101f (navy)
- **Surface:** #1e293b
- **Success:** Emerald/green
- **Error:** Red

### Design Patterns
- **Glassmorphism:** `.glass-card` class — `rgba(30, 41, 59, 0.4)` bg, `backdrop-filter: blur(16px)`, white/10 border
- **Glow effects:** `.glow-cyan`, `.glow-magenta`, `.glow-green`, `.glow-red`, `.glow-amber`
- **Background blobs:** `.bg-blob-cyan` (top-left) and `.bg-blob-magenta` (bottom-right), hidden on mobile via `.blob-hide-mobile`
- **Fonts:** Cabinet Grotesk for headings (`font-heading`), Satoshi for body (`font-body`)
- **Icons:** Iconify Lucide set via `<iconify-icon icon="lucide:icon-name">`
- **Buttons:** `rounded-2xl` with `hover:scale-105 active:scale-95 transition-all` and shadow/glow
- **Cards:** `rounded-3xl` with glass-card styling

### Tailwind Color Overrides (tailwind.config.js)
Instead of renaming hundreds of class references, `cyan` and `pink` color shades are overridden to map to teal/magenta:
```js
cyan: { 300: '#5cd4cc', 400: '#3ac3ba', 500: '#20b2aa', 600: '#1a9690', 700: '#147a76', 900: '#0a3d3b' }
pink: { 300: '#ec78c8', 400: '#e555b7', 500: '#dd33a7', 600: '#c42d95', 700: '#a12579', 900: '#51133d' }
```

---

## Monthly Email Report

Automated monthly P&L report sent via Resend API.

**Two functions:**
- `monthly-report.js` — The actual report logic. Callable via HTTP for manual testing: `curl https://jumpstartscanner.netlify.app/.netlify/functions/monthly-report`
- `monthly-report-scheduled.js` — Cron wrapper. Runs `0 13 1 * *` (1st of each month, 9am ET). Calls the main function via HTTP.

**Report contents:** Per-channel (Jumpstart + Kickstart) revenue, fees, net revenue, COGS, gross profit, items sold, inventory on hand. Plus combined summary.

**Resend setup:** Currently using `onboarding@resend.dev` as sender (test mode). Test mode only delivers to account owner email (jeremydcarter@gmail.com). To send to others, need to verify a business domain at resend.com/domains.

---

## Key Workflows

### 1. Kickstart Intake (KickstartSort.jsx)

**Flow:** Select bin price → Select brand (FP/UO/Anthro) → Take photo of tag → Set quantity → Save

- **NO BARCODE SCANNING** — Kickstart uses photo + details form
- Photos compressed client-side (max 1200px wide, 70% JPEG) before saving
- Saves to `kickstart_intake` with status `pending_enrichment`
- Immediately triggers AI enrichment via Netlify function
- Cost per item = bin price selected

### 2. Sales Scanning (SalesScanner.jsx)

**Flow:** Select show → Scan barcode → Enter yellow sticker number → Save → Next

- Camera-based barcode scanning using html5-qrcode
- Channel-aware: filters barcodes by prefix (099=Jumpstart, 198=Kickstart)
- Barcodes normalized before saving
- Duplicate listing numbers prevented per show
- "No Barcode" button for manual entry
- Multi-device support: polls scanned count every 5 seconds

### 3. AI Tag Enrichment (enrich-kickstart.js)

- Netlify serverless function
- Fetches items with `status = 'pending_enrichment'` from `kickstart_intake`
- Sends photo_data (base64) to Claude API
- Extracts: UPC, style_number, brand, description, color, size, MSRP
- Style numbers: OB, C, or CS prefixes (NOT V vendor codes or S codes)
- MSRP: uses USD price when both USD and CAD on tag
- Processes 5 items per invocation to avoid timeout

### 4. Bundle Manifest (bundle_manifest view)

- Database view joining `jumpstart_bundle_scans` to `jumpstart_manifest`
- Uses `DISTINCT ON (barcode)` to prevent row multiplication
- Query by box: `SELECT * FROM bundle_manifest WHERE box_number = 11 ORDER BY scanned_at;`

---

## Development Conventions

- **Git:** Commit frequently with descriptive messages. Always `git push` after committing.
- **Multi-machine:** Jer works on Mac Mini (home) and MacBook Air (office). Always `git pull` when switching machines.
- **Deploy:** Always deploy before testing. The deploy command includes the _redirects file for SPA routing.
- **Testing:** Test on actual mobile devices — scanner features require camera access.
- **SQL changes:** Always save SQL changes from Supabase SQL Editor back to local migration files — stale local files have caused bugs.
- **Handoffs:** When hitting message limits, provide a summary of what was done and what's pending.

---

## Common Issues & Fixes

| Issue | Cause | Fix |
|---|---|---|
| NULL data in views/joins | Leading zeros on barcodes (099 vs 99) | Check triggers exist; run emergency LTRIM SQL |
| Duplicate rows in query results | Joining directly to jumpstart_manifest | Use DISTINCT ON (barcode) subquery |
| "Bad Barcode" in profitability | Leading zeros in scans | `UPDATE jumpstart_sold_scans SET barcode = LTRIM(barcode, '0') WHERE barcode LIKE '0%';` |
| Enrichment not running | Items stuck in pending_enrichment | `curl -s https://jumpstartscanner.netlify.app/.netlify/functions/enrich-kickstart` |
| Colors not changing after Tailwind config update | Dev server cache | Kill and restart `npm run dev` |
| Old version cached on device | Browser cache | Hard refresh or scan QR code for fresh load |
| Netlify scheduled function returns "Internal Error" via curl | Scheduled functions can't be invoked via HTTP | Use separate callable function + scheduled wrapper pattern |
| Resend 403 on email send | Test mode / unverified domain | Use `onboarding@resend.dev` sender; send only to account owner email |
| "Invalid supabaseUrl" in production | VITE_ env vars marked as secrets in Netlify | Unmark "Contains secret values" for VITE_ vars |

---

## Current TODOs

- [ ] Verify business domain in Resend for production email sending (currently test-only)
- [ ] Profitability page: fix 1000-item display limit (need server-side aggregation)
- [ ] Zone assignments based on MSRP thresholds
- [ ] Kickstart enrichment: UO tags have unreadable barcodes — UPC will be blank for UO items
- [ ] Add way to upload and track manifested bulk sales
- [ ] Kickstart analytics (currently Jumpstart-only)
- [ ] Interactive AI chat for data questions on Data Check page

---

## Key People

- **Josh** — Owner
- **Wesley** — Co-owner
- **Jer** (Jeremy Carter) — Operations consultant, manages tech infrastructure
- **Laura** — Scanning operations
- **Bri** — Scanner operator (uses iPad)

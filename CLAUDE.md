# CLAUDE.md — Jumpstart V2

## What is Jumpstart?

Jumpstart is a livestream liquidation business that buys retail inventory loads (J.Crew, Madewell, Free People, Urban Outfitters, Anthropologie) and sells them through live auctions on Whatnot. This app manages inventory scanning, sorting, sales tracking, and profitability analysis.

**Maintained by:** Jer (Jeremy Carter) — Operations Consultant
**GitHub:** https://github.com/MisterHamburger/jumpstart-v2
**Live URL:** https://jumpstartscanner.netlify.app
**Supabase:** https://dqilknhyevkecjnmnumx.supabase.co

---

## Tech Stack

- **Frontend:** React + Vite + Tailwind CSS
- **Backend:** Supabase (PostgreSQL)
- **Hosting:** Netlify (static site + serverless functions)
- **AI:** Anthropic Claude API (tag photo enrichment)
- **Barcode scanning:** Html5-qrcode library (in-browser camera)
- **External scanner:** CodeREADr (for sort scanning)

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
```

---

## Deploy Command

```bash
cd ~/Downloads/jumpstart-v2 && npm run build && echo '/* /index.html 200' > dist/_redirects && npx netlify deploy --prod --dir=dist --functions=netlify/functions
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
- `kickstart_intake` — KickstartSort scanner. Select bin price → brand → photo tag → quantity → save. AI enrichment extracts details.

**Show setup (before Whatnot live):**
- `shows` — manually created. Name, date, channel, total_items, status.
- `show_items` — imported from Whatnot listing CSV. Each row = listing_number + barcode + price. Status = valid/invalid.

**During live show (scanning sales):**
- `jumpstart_sold_scans` — SalesScanner. Scan barcode → enter yellow sticker listing number → save. One row per item sold.
- `kickstart_sold_scans` — same for Kickstart shows.

**After show:**
- `profitability` view — joins show_items → manifest to calculate per-item profit
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

---

## File Structure

```
src/
├── App.jsx                    # Routes
├── main.jsx                   # Entry point
├── lib/
│   ├── supabase.js            # Supabase client init
│   ├── barcodes.js            # normalizeBarcode(), isLiquidatorBarcode()
│   └── fees.js                # calculateFees(), calculateProfit()
├── pages/
│   ├── Home.jsx               # Homepage with navigation
│   ├── SortingSelect.jsx      # Choose sort type
│   ├── GeneralSort.jsx        # Jumpstart sort scanner
│   ├── KickstartSort.jsx      # Kickstart intake: bin→brand→photo→qty→save
│   ├── BundleSort.jsx         # Bundle scanning
│   ├── SalesSetup.jsx         # Pick show to scan for sales
│   ├── SalesScanner.jsx       # Live show barcode scanning
│   └── Admin.jsx              # Admin panel router
├── components/
│   ├── Admin.jsx              # Admin layout/nav
│   ├── AdminDashboard.jsx     # Dashboard overview
│   ├── AdminInputs.jsx        # Data input management
│   ├── AdminInventory.jsx     # Inventory views
│   ├── AdminProfitability.jsx # Profitability analysis
│   └── AdminScans.jsx         # Scan monitoring
└── components/files/          # Legacy/unused components
    ├── Admin.jsx
    ├── AdminInputs.jsx
    ├── AdminInventory.jsx
    ├── App.jsx
    └── migrate.js

netlify/functions/
├── enrich-kickstart.js        # AI tag photo enrichment
└── read-tags.js               # Legacy/unused
```

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
- **⚠️ COUNTING SOLD ITEMS:** Count unique `listing_number` per show, NOT row count. Listing numbers are unique per show (1-150 = 150 items sold). The same barcode can appear with different listing numbers when you sell multiple physical items of the same SKU (e.g., two pairs of identical pants sold as listing #2 and #4).

**`kickstart_sold_scans`** — Barcodes scanned during Kickstart shows
- id, show_id, barcode, listing_number, scanned_at, intake_id
- Same counting rule as above

**`jumpstart_sort_log`** — Sort scanner results
- id, barcode, zone, timestamp

**`jumpstart_bundle_boxes`** / **`jumpstart_bundle_scans`** — Bundle tracking
- `jumpstart_bundle_scans` has: id, box_number, barcode, scanned_at

**`loads`** — Inventory load purchases
**`expenses`** — Business expenses

### Views (read-only)

- `dashboard_summary` — Aggregated dashboard stats
- `load_summary` — Load-level summaries
- `profitability` — Item-level profitability joining scans + manifest + show data
- `profitability_summary` — Show-level profitability aggregation
- `unique_items` — Deduplicated inventory
- `bundle_manifest` — Joins `jumpstart_bundle_scans` to `jumpstart_manifest` via `DISTINCT ON (barcode)` to show enriched bundle data (description, color, style, size, category, vendor, MSRP, cost) without row duplication

### Database Triggers

**Universal barcode normalization** — A single function `normalize_barcode_universal()` strips leading zeros via `LTRIM(barcode, '0')`. This trigger is applied on BOTH INSERT and UPDATE to ALL barcode tables:

- `jumpstart_bundle_scans`
- `jumpstart_sold_scans`
- `jumpstart_sort_log`
- `kickstart_sold_scans`

This prevents the recurring issue where 099-prefix barcodes don't match the manifest (which stores them as 99-prefix).

### RLS (Row Level Security)

All tables have RLS enabled with "Allow all" policies. This is a private app with no public users — RLS policies grant full access to the anon key.

---

## Barcode Normalization (CRITICAL)

⚠️ **This is the #1 recurring issue in the system.** Barcodes from liquidator loads start with `099` prefix. The manifest stores them normalized (no leading zeros: `99107871955`). If barcodes aren't normalized before saving, JOINs fail and data shows as NULL.

### Three layers of protection (all must remain in place):

**1. Client-side:** `normalizeBarcode()` in `src/lib/barcodes.js` strips leading zeros, quotes, whitespace. This is the first line of defense.

**2. Database triggers:** `normalize_barcode_universal()` function with triggers on ALL barcode tables (jumpstart_bundle_scans, jumpstart_sold_scans, jumpstart_sort_log, kickstart_sold_scans). Fires on INSERT and UPDATE. This catches anything the client misses (e.g., cached old app versions, direct API inserts, CodeREADr imports).

**3. Emergency fix SQL:** If NULL/unmatched data appears despite the above, run:
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

`jumpstart_manifest` ALWAYS has duplicate barcodes — multiple physical items share the same barcode. This is expected and will happen on every future load. Any query that JOINs to `jumpstart_manifest` MUST deduplicate:

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

## Key Workflows

### 1. Kickstart Intake (KickstartSort.jsx)

**Flow:** Select bin price → Select brand (FP/UO/Anthro) → Take photo of tag → Set quantity → Save

- Photos are compressed client-side (max 1200px wide, 70% JPEG quality) before saving
- Saves to `kickstart_intake` with status `pending_enrichment`
- Immediately after save, fires `fetch('/.netlify/functions/enrich-kickstart')` to trigger AI enrichment
- Enrichment reads the tag photo via Claude API and extracts: UPC, style_number, brand, description, color, size, MSRP
- Brand is set by user selection, not AI detection (AI fallback to "Free People" if empty)
- Cost per item is the bin price selected

### 2. Sales Scanning (SalesScanner.jsx)

**Flow:** Select show → Scan barcode → Enter yellow sticker number → Save → Next

- Camera-based barcode scanning using html5-qrcode
- Channel-aware: filters barcodes by prefix (099=Jumpstart, 198=Kickstart)
- Barcodes normalized (leading zeros stripped) before saving
- Duplicate listing numbers prevented per show
- "No Barcode" button for items without scannable barcodes (manual text entry)
- "Scans" button opens modal showing all scans with delete capability
- Scans persist in Supabase — refreshing the page doesn't lose data
- Header shows: Scanned (green) / Total (white) → Remaining (violet)
- Auto-completion detection when scanned count reaches total
- Multi-device support: polls scanned count every 5 seconds

### 3. Profitability (AdminProfitability.jsx)

- Joins sold scans → manifest to calculate per-item profit
- Whatnot fees: 7.2% commission + 2.9% + $0.30 processing
- Sticky table headers (requires overflow-auto container with max-height)
- Filters by show, date range, search
- "Bad Barcode" = scan barcode doesn't match any manifest entry (usually a normalization issue)
- Profitability calculation: sold items = COUNT from show_items WHERE status='valid', NOT from scans table

### 4. AI Tag Enrichment (enrich-kickstart.js)

- Netlify serverless function
- Fetches items with `status = 'pending_enrichment'` from `kickstart_intake`
- Sends photo_data (base64) to Claude API (claude-sonnet-4-20250514)
- Extracts: UPC, brand, style_number, description, color, size, MSRP
- Prompt is tuned for Free People, Urban Outfitters, and Anthropologie tags
- Style numbers: look for OB, C, or CS prefixes (NOT V vendor codes or S codes)
- MSRP: uses USD price when both USD and CAD are on tag
- UPC: reads digits below barcode lines; returns empty if not visible
- Processes 5 items per invocation to avoid Netlify timeout
- Auto-triggered after each Kickstart save; can also be triggered manually via curl

### 5. Bundle Manifest (bundle_manifest view)

- Database view that joins `jumpstart_bundle_scans` to `jumpstart_manifest`
- Uses `DISTINCT ON (barcode)` to prevent row multiplication from manifest duplicates
- Automatically enriches bundle scans with item details (description, color, style, size, category, vendor, MSRP, cost)
- No maintenance needed — new scans auto-populate when queried
- Query by box: `SELECT * FROM bundle_manifest WHERE box_number = 11 ORDER BY scanned_at;`

---

## UI Design

- Dark theme with glassmorphism (gradients, backdrop-blur, border-white/10)
- Fuchsia/pink gradient accents for Kickstart
- Cyan/teal accents for dashboard
- Emerald for success states
- Mobile-first design (scanners used on iPad/phone)
- Cache-busting meta tags in index.html to prevent stale versions

---

## Development Conventions

- **File editing:** Use `python3 << 'EOF'` scripts with pathlib for reliable string replacements. Avoid sed/heredoc due to quote escaping issues.
- **Git:** Commit frequently with descriptive messages. Always `git push` after committing.
- **Multi-machine:** Jer works on Mac Mini (home) and MacBook Air (office). Always `git pull` when switching machines.
- **Deploy:** Always deploy before testing. The deploy command includes the _redirects file for SPA routing.
- **Testing:** Test on actual mobile devices — scanner features require camera access.
- **Handoffs:** When hitting message limits, provide a summary of what was done and what's pending.

---

## Common Issues & Fixes

| Issue | Cause | Fix |
|---|---|---|
| NULL data in views/joins | Leading zeros on barcodes (099 vs 99) | Check triggers exist; run emergency LTRIM SQL on all barcode tables |
| Duplicate rows in query results | Joining directly to jumpstart_manifest | Use DISTINCT ON (barcode) subquery — manifest ALWAYS has duplicate barcodes |
| "Bad Barcode" in profitability | Leading zeros in scans | Run SQL: `UPDATE jumpstart_sold_scans SET barcode = LTRIM(barcode, '0') WHERE barcode LIKE '0%';` |
| Scans list empty after refresh | Old code used React state | Now loads from Supabase; should persist |
| Enrichment not running | Items stuck in pending_enrichment | `curl -s https://jumpstartscanner.netlify.app/.netlify/functions/enrich-kickstart` |
| Build fails with JSX error | Bad string replacement | Check the file for duplicate lines or syntax issues |
| Camera stuck on mobile | Browser camera lock | Refresh the page; scans persist |
| Sticky headers not working | Parent has overflow-hidden | Table wrapper needs `overflow-auto` + `max-height` |
| Old version cached on device | Browser cache | Hard refresh or scan QR code for fresh load |
| New table has barcode column | Missing normalization trigger | Add trigger: `CREATE TRIGGER normalize_barcode_trigger BEFORE INSERT OR UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION normalize_barcode_universal();` |

---

## Current TODOs

- [ ] Profitability page: fix 1000-item display limit (need server-side aggregation via `get_profitability_summary()`)
- [ ] Remove left-border UI accent from all pages
- [ ] Zone assignments based on MSRP thresholds
- [ ] Kickstart enrichment: UO tags have unreadable barcodes (no printed UPC digits) — UPC will be blank for UO items
- [ ] AdminScans.jsx needs to be verified in git
- [ ] Add way to upload and track manifested bulk sales
- [ ] Create scanner to pull up item info (MSRP, COGS, etc) on the fly
- [ ] Explore adding stock photos to manifests when scanning into bulk boxes

---

## Key People

- **Josh** — Owner
- **Wesley** — Co-owner
- **Jer** (Jeremy Carter) — Operations consultant, manages tech infrastructure
- **Laura** — Scanning operations
- **Bri** — Scanner operator (uses iPad)

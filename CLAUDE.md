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

## Deploy Command

```bash
cd ~/Desktop/jumpstart-v2 && npm run build && echo '/* /index.html 200' > dist/_redirects && npx netlify deploy --prod --dir=dist --functions=netlify/functions
```

Always include the `_redirects` file — required for SPA client-side routing.

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

## Database Tables (Supabase)

### Critical Table Rules

**`jumpstart_manifest`** — ⚠️ ALWAYS has duplicate barcodes. Any JOIN MUST use `DISTINCT ON (barcode)`:
```sql
LEFT JOIN (
  SELECT DISTINCT ON (barcode) * FROM jumpstart_manifest ORDER BY barcode, id
) m ON m.barcode = t.barcode
-- NEVER: LEFT JOIN jumpstart_manifest m ON m.barcode = t.barcode  (multiplies rows)
```

**`expenses`** — Categories: `OPEX`, `PAYROLL` (Intuit only), `INVENTORY` (Venmo sourcing payments), `SOURCING` (direct sourcing)
- **⚠️ Venmo = INVENTORY, NOT PAYROLL.** When importing expenses, Venmo transactions must be `INVENTORY`. Dashboard RPC sums `category = 'PAYROLL'` for payroll and `category IN ('SOURCING', 'INVENTORY')` for Kickstart sourcing.

### Barcode Normalization (CRITICAL — #1 recurring issue)

Jumpstart barcodes start with `099`; the manifest stores them without leading zeros (`99...`). Mismatches cause NULL joins.

**Three layers of protection:**
1. `normalizeBarcode()` in `src/lib/barcodes.js` — client-side, first line of defense
2. `normalize_barcode_universal()` DB trigger on ALL barcode tables (jumpstart_bundle_scans, jumpstart_sold_scans, jumpstart_sort_log, kickstart_sold_scans) — fires on INSERT and UPDATE
3. Emergency fix: `UPDATE <table> SET barcode = LTRIM(barcode, '0') WHERE barcode LIKE '0%'`

**New tables with barcode columns** must get the trigger:
```sql
CREATE TRIGGER normalize_barcode_trigger
BEFORE INSERT OR UPDATE ON <table>
FOR EACH ROW EXECUTE FUNCTION normalize_barcode_universal();
```

---

## Key Workflows

### Profitability
- Whatnot fees: 8% commission + 2.9% + $0.30 processing
- Sold item count = `show_items WHERE status='valid'`, NOT from scans table
- "Bad Barcode" = scan doesn't match any manifest entry (barcode normalization issue)

### Kickstart Intake (v1 — KickstartSort.jsx)
- Saves to `kickstart_intake`, auto-triggers `enrich-kickstart.js`
- Style numbers: OB, C, or CS prefixes only (not V vendor codes)
- MSRP: USD price when both USD and CAD on tag; UPC blank for UO items (no printed digits)
- Manual trigger: `curl -s https://jumpstartscanner.netlify.app/.netlify/functions/enrich-kickstart`

### Kickstart Sourcing Trips (v2 — KickstartBuyer.jsx)
- Separate from v1. Saves to `kickstart_trips` / `kickstart_tag_photos` / `kickstart_receipt_items`
- Receipt parsed via `parse-receipt.js`, tags matched via `match-kickstart-trip.js`
- Enrichment via `enrich-kickstart-v2.js`

### Dashboard RPC
- `get_dashboard_summary(date_cutoff, date_end)` — Payroll = `category = 'PAYROLL'`; Sourcing = `category IN ('SOURCING', 'INVENTORY')` excluding UPS/Pirate Ship

### Kickstart COGS vs Jumpstart COGS
- **Jumpstart:** uses `cost_freight` from `jumpstart_manifest`. When importing a load manifest, set `cost_freight` = COGS directly from the liquidator's spreadsheet — freight is already baked into their COGS formula. `cost` is left NULL. Do NOT add $0.45 or any additional freight on top.
- **Kickstart:** uses `true_cost` = cost + $1 sourcing fee + $1.50 shipping + 10% sales tax. Shipping already in COGS — do NOT also count UPS/Pirate Ship expenses or it double-counts
- **RDM (Load 5):** Random mystery lot — no manifest, no barcodes. Profitability view uses hardcoded cost of $3.41 for RDM items.

---

## UI Design

Match the patterns in `src/pages/Home.jsx` and `src/index.css` exactly. Key rules:

**Fonts:** `font-heading` (Cabinet Grotesk) for headings, Satoshi for body — both loaded via `index.css`

**Cards:** `glass-card rounded-3xl p-6` — the `.glass-card` class is defined in `index.css` (blur, border, dark bg)

**Buttons:**
- Jumpstart action: `bg-cyan-600 text-white hover:bg-cyan-500 hover:scale-105 active:scale-95 rounded-2xl font-bold shadow-lg shadow-cyan-600/30`
- Kickstart action: `bg-pink-500 text-white hover:bg-pink-400 hover:scale-105 active:scale-95 rounded-2xl font-bold shadow-lg shadow-pink-500/30 glow-magenta`
- Secondary/neutral: `glass-card hover:bg-white/10 hover:scale-[1.02] active:scale-[0.98] rounded-3xl`

**Icons:** Iconify via `<iconify-icon icon="lucide:name">`. Icon containers: `w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20`

**Colors:**
- Jumpstart accent: `cyan-400 / cyan-600`
- Kickstart accent: `pink-500` + `glow-magenta`
- Success: `emerald`
- Muted text: `text-slate-500`
- Borders: `border-white/10`

**Background:** `bg-blob-cyan` + `bg-blob-magenta` fixed blobs (defined in `index.css`). Content sits in `relative z-10`.

**Layout:** `max-w-md` centered column, `space-y-4` between cards, mobile-first.

---

## Development Conventions

- **Git:** Commit with descriptive messages. Always `git push` after committing.
- **Deploy:** Always deploy before testing. See deploy command above.

---

## Common Issues

| Issue | Cause | Fix |
|---|---|---|
| NULL data in joins | Leading zeros on barcodes (099 vs 99) | Check triggers exist; run `UPDATE <table> SET barcode = LTRIM(barcode, '0') WHERE barcode LIKE '0%'` on all barcode tables |
| Duplicate rows in results | Direct JOIN to jumpstart_manifest | Use DISTINCT ON (barcode) subquery — manifest always has duplicate barcodes |
| "Bad Barcode" in profitability | Leading zeros in scans | Run LTRIM fix on jumpstart_sold_scans |
| New table has barcode column | Missing normalization trigger | `CREATE TRIGGER normalize_barcode_trigger BEFORE INSERT OR UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION normalize_barcode_universal();` |

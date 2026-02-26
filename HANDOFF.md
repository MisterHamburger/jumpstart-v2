# Handoff — Session Feb 26, 2026

## What was fixed this session
- Profitability page stats were broken because `get_profitability_summary` DB function got dropped with CASCADE
- Fixed by computing stats client-side instead of relying on DB function
- Restored pagination (100 items/page) that was accidentally removed
- Verified all numbers against database:
  - Summary: 3,868 items, $26,740.19 profit
  - Jumpstart: 3,604 items, $23,016.69 profit (accurate)
  - Kickstart: 264 items, $3,723.50 profit (INFLATED — see below)
  - Bundles: 7 boxes sold, $850.04 profit (accurate)

## Open problem: Kickstart profitability is inflated

### The issue
Only 94 of 264 Kickstart sold items have real cost data. The other 170 items show $0 cost and ~89% margins, inflating profit by $3,745.

**Real Kickstart profit (good data only): -$21.74**

### Root cause
The AI tag enrichment (enrich-kickstart.js) reads garbled UPCs from tag photos:
- Scanner reads clean 12-digit barcodes during shows: `198451888633`
- AI reads from photos and stores wrong UPCs: `984518886333` (shifted), `1984516292627` (13 digits), `19879351641` (11 digits)
- These don't match → no cost data → profit looks fake

### Why 94 items DO work
Those 94 scans have `intake_id` set in `kickstart_sold_scans` — a direct link to the intake record that bypasses barcode matching entirely.

### Fix path
- Figure out how to always set `intake_id` during sales scanning so we don't rely on UPC matching
- Or improve the barcode matching logic to be fuzzy / partial match
- The AI UPC reading may be unfixable (especially UO tags with no printed digits)

### Breakdown by show
- Bri's show (Feb 24): 144 items, only 81 matched (63 bad)
- Hannah's show (Feb 26): 120 items, only 13 matched (107 bad)

## What to do on Mac Mini
1. `cd` to the jumpstart-v2 folder
2. `git pull`
3. `npm install` if needed
4. Start working on the Kickstart barcode matching fix

Delete this file when done — it's just for handoff context.

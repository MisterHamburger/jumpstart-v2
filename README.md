# Jumpstart V2 — Inventory Management System

Rebuilt from scratch. Replaces the Google Sheets + 110 Netlify Functions architecture with **Supabase (PostgreSQL) + React**.

## Architecture

```
React (Vite + Tailwind)  →  Supabase (PostgreSQL)
    Static site                Real database
    Hosted on Netlify          Hosted on Supabase
    No serverless functions    Views handle profitability calc
```

## What Changed

| Before (V1) | After (V2) |
|---|---|
| Google Sheets as database | Supabase PostgreSQL |
| 110 Netlify serverless functions | 0 functions — direct DB queries |
| 5-second polling for multi-device sync | Supabase Realtime subscriptions |
| No auth — anyone with URL has access | Supabase RLS (ready to enable) |
| Barcode normalization in ~10 different files | Single `normalize_barcode()` DB trigger |
| 200-line JS profitability calculation | SQL VIEW (`profitability`) |
| No offline resilience | localStorage fallback (planned) |

## Setup

1. Clone this repo
2. Copy `.env.example` to `.env` and fill in your Supabase credentials
3. `npm install`
4. `npm run dev`

## Deploy

```bash
npm run build
netlify deploy --prod
```

Set these env vars in Netlify:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Project Structure

```
src/
  lib/
    supabase.js        — Supabase client (single instance)
    barcodes.js        — Barcode normalization (matches DB trigger)
    fees.js            — Whatnot fee calculation (7.2% + 2.9% + $0.30)
  pages/
    Home.jsx           — Landing (Sorting / Sales Scanner / Admin)
    SortingSelect.jsx  — General Sort vs Bundle Sort
    GeneralSort.jsx    — Scan → zone assignment
    BundleSort.jsx     — Scan → box number
    SalesSetup.jsx     — Select show for scanning
    SalesScanner.jsx   — Scan barcode → enter sticker# → log
    Admin.jsx          — Admin shell with tab nav
  components/
    AdminDashboard.jsx — P&L metrics from profitability view
    AdminInputs.jsx    — Upload manifests, shows, expenses, manage loads
    AdminInventory.jsx — Browse inventory by zone
    AdminProfitability.jsx — Item-level profit/loss table
```

## Database Schema

See `jumpstart-schema.sql` — run in Supabase SQL Editor.

Key tables: `loads`, `items`, `shows`, `show_items`, `scans`, `sort_log`, `expenses`
Key views: `profitability` (the 3-way join), `dashboard_summary`

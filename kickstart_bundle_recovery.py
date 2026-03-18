#!/usr/bin/env python3
"""
Kickstart Bundle Box 2 Recovery Script
Matches PDF manifest rows to kickstart_intake records and generates SQL.

Matching strategy:
  Primary key: brand (case-insensitive) + msrp + size (case-insensitive) + color (case-insensitive)
  Description is NOT used because the intake stores AI-enriched category names,
  not the full product names from the liquidator PDF.

  Each PDF row consumes a distinct intake ID from the matched pool.
  Pool is sorted by id ascending and consumed one-at-a-time per PDF row.
  This handles the case where 10 PDF rows for the same item should get
  10 distinct intake IDs.
"""

import pdfplumber
import json
import urllib.request
import ssl
from collections import defaultdict

PDF_PATH = "/Users/jeremycarter/Library/Mobile Documents/com~apple~CloudDocs/Kickstart Free People Pallet #1.pdf"
SUPABASE_URL = "https://dqilknhyevkecjnmnumx.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxaWxrbmh5ZXZrZWNqbm1udW14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MzUxNjAsImV4cCI6MjA4NjUxMTE2MH0.lV5gZZaDySePekWRqNq_9SGGp0yJ5S2B9VGjGKAhwrw"

BOX_NUMBER = 2
SALE_PRICE = 5758.00
SOLD_AT = "2026-03-17"
SHIPPING_CHARGED = 248.37

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

# ---------------------------------------------------------------------------
# Step 1: Extract PDF rows
# ---------------------------------------------------------------------------

def parse_pdf_rows(path):
    raw_rows = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    raw_rows.append(row)

    header_idx = None
    headers = []
    for i, row in enumerate(raw_rows):
        cells = [str(c).strip() if c else "" for c in row]
        lower = [c.lower() for c in cells]
        if "brand" in lower and "msrp" in lower:
            header_idx = i
            headers = cells
            break

    if header_idx is None:
        print("ERROR: No header row found in PDF")
        return []

    col_map = {}
    for j, h in enumerate(headers):
        hl = h.lower().strip()
        for field in ["brand", "category", "description", "condition", "color", "size", "msrp"]:
            if field in hl:
                col_map[field] = j

    print(f"Header found at row {header_idx}: {headers}")
    print(f"Column map: {col_map}")

    parsed = []
    for row in raw_rows[header_idx + 1:]:
        cells = [str(c).strip() if c else "" for c in row]
        if all(c == "" for c in cells):
            continue

        def gc(f):
            idx = col_map.get(f)
            return cells[idx] if idx is not None and idx < len(cells) else ""

        # Skip repeated header rows embedded in the table
        if gc("brand").lower() == "brand" or gc("msrp").lower() == "msrp":
            continue
        # Skip blank brand rows
        if not gc("brand"):
            continue

        msrp_raw = gc("msrp")
        msrp_val = None
        if msrp_raw:
            try:
                msrp_val = float(msrp_raw.replace("$", "").replace(",", "").strip())
            except ValueError:
                pass

        parsed.append({
            "brand": gc("brand"),
            "category": gc("category"),
            "description": gc("description"),
            "condition": gc("condition"),
            "color": gc("color"),
            "size": gc("size"),
            "msrp": msrp_val,
            "msrp_raw": msrp_raw,
        })

    return parsed


# ---------------------------------------------------------------------------
# Step 2: Fetch kickstart_intake from Supabase
# ---------------------------------------------------------------------------

def fetch_kickstart_intake():
    url = (f"{SUPABASE_URL}/rest/v1/kickstart_intake"
           f"?select=id,brand,description,color,size,msrp,cost"
           f"&limit=10000&order=id.asc")
    req = urllib.request.Request(url, headers={
        "apikey": ANON_KEY,
        "Authorization": f"Bearer {ANON_KEY}",
    })
    with urllib.request.urlopen(req, context=SSL_CTX) as resp:
        data = json.loads(resp.read().decode())
    print(f"Fetched {len(data)} kickstart_intake records")
    return data


# ---------------------------------------------------------------------------
# Step 3: Match PDF rows to intake records
# ---------------------------------------------------------------------------

def norm(s):
    return str(s).strip().lower() if s is not None else ""


def build_intake_pool(intake_records):
    """
    Build a pool keyed by (brand, msrp, size, color).
    Value is a deque of intake IDs sorted by id ascending.
    Each PDF row that matches a key will pop (consume) the next available ID.
    """
    from collections import deque
    pool = defaultdict(list)
    for rec in intake_records:
        key = (
            norm(rec.get("brand")),
            rec.get("msrp"),  # float or None — exact match
            norm(rec.get("size")),
            norm(rec.get("color")),
        )
        pool[key].append(rec["id"])

    # Sort each bucket by id ascending and convert to deque
    return {k: deque(sorted(v)) for k, v in pool.items()}


def match_rows(pdf_rows, intake_records):
    pool = build_intake_pool(intake_records)

    # Track how many IDs are available per key before we start consuming
    pool_counts_original = {k: len(v) for k, v in pool.items()}

    matched = []
    no_match = []
    pool_exhausted = []

    for i, row in enumerate(pdf_rows):
        row_num = i + 1
        key = (
            norm(row.get("brand")),
            row.get("msrp"),
            norm(row.get("size")),
            norm(row.get("color")),
        )

        bucket = pool.get(key)
        if bucket is None or len(bucket) == 0:
            if bucket is not None and len(bucket) == 0:
                # Pool was exhausted — more PDF rows than intake records for this key
                pool_exhausted.append((row_num, row, pool_counts_original.get(key, 0)))
            else:
                no_match.append((row_num, row))
            continue

        intake_id = bucket.popleft()  # consume lowest id
        matched.append({
            "pdf_row_num": row_num,
            "pdf_row": row,
            "intake_id": intake_id,
            "pool_total": pool_counts_original.get(key, 0),
        })

    return matched, no_match, pool_exhausted


# ---------------------------------------------------------------------------
# Step 4: Generate SQL
# ---------------------------------------------------------------------------

def generate_sql(matched, no_match, pool_exhausted):
    total_items = len(matched) + len(no_match) + len(pool_exhausted)
    lines = []
    lines.append("-- Recovery SQL for Kickstart Bundle Box 2")
    lines.append(f"-- Sold: {SOLD_AT}, Sale price: ${SALE_PRICE:.2f}, Shipping: ${SHIPPING_CHARGED:.2f}")
    lines.append(f"-- Items: {total_items} total | {len(matched)} matched | {len(no_match)} unmatched | {len(pool_exhausted)} pool-exhausted")
    lines.append("")
    lines.append("-- Step 1: Restore box record")
    lines.append("INSERT INTO kickstart_bundle_boxes (box_number, status, sale_price, sold_at, shipping_charged)")
    lines.append(f"VALUES ({BOX_NUMBER}, 'complete', {SALE_PRICE:.2f}, '{SOLD_AT}', {SHIPPING_CHARGED:.2f});")
    lines.append("")
    lines.append(f"-- Step 2: Restore scan records ({len(matched)} matched rows)")

    if matched:
        lines.append("INSERT INTO kickstart_bundle_scans (box_number, intake_id)")
        lines.append("VALUES")
        for idx, m in enumerate(matched):
            intake_id = m["intake_id"]
            note = f"  -- Row {m['pdf_row_num']}: {m['pdf_row']['brand']} | {m['pdf_row']['description']} | {m['pdf_row']['color']} | {m['pdf_row']['size']} | {m['pdf_row']['msrp_raw']}"
            sep = "," if idx < len(matched) - 1 else ";"
            lines.append(f"({BOX_NUMBER}, {intake_id}){sep}{note}")
    else:
        lines.append("-- (no matched rows)")

    lines.append("")

    if pool_exhausted:
        lines.append(f"-- POOL-EXHAUSTED ITEMS ({len(pool_exhausted)} rows — more PDF rows than intake records for this key):")
        for row_num, row, original_count in pool_exhausted:
            lines.append(f"-- Row {row_num}: {row.get('brand','')} | {row.get('description','')} | {row.get('color','')} | {row.get('size','')} | {row.get('msrp_raw','')} (intake had {original_count})")
        lines.append("")

    if no_match:
        lines.append(f"-- UNMATCHED ITEMS ({len(no_match)} rows had no intake match):")
        for row_num, row in no_match:
            lines.append(f"-- Row {row_num}: {row.get('brand','')} | {row.get('description','')} | {row.get('color','')} | {row.get('size','')} | {row.get('msrp_raw','')}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 70)
    print("STEP 1: Extracting PDF rows")
    print("=" * 70)
    pdf_rows = parse_pdf_rows(PDF_PATH)
    print(f"Parsed data rows: {len(pdf_rows)}")
    print("\nFirst 5 rows:")
    for r in pdf_rows[:5]:
        print(f"  {r}")

    print("\n" + "=" * 70)
    print("STEP 2: Fetching kickstart_intake")
    print("=" * 70)
    intake_records = fetch_kickstart_intake()

    print("\n" + "=" * 70)
    print("STEP 3: Matching (key: brand + msrp + size + color)")
    print("=" * 70)
    matched, no_match, pool_exhausted = match_rows(pdf_rows, intake_records)
    print(f"Matched:         {len(matched)}")
    print(f"No match:        {len(no_match)}")
    print(f"Pool exhausted:  {len(pool_exhausted)}")

    print("\n" + "=" * 70)
    print("STEP 4: Generating SQL")
    print("=" * 70)
    sql = generate_sql(matched, no_match, pool_exhausted)

    sql_path = "/Users/jeremycarter/Projects/jumpstart-v2/kickstart_box2_recovery.sql"
    with open(sql_path, "w") as f:
        f.write(sql)
    print(f"SQL written to: {sql_path}")

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    total = len(pdf_rows)
    print(f"PDF rows extracted:      {total}")
    print(f"Intake records fetched:  {len(intake_records)}")
    print(f"Matched:                 {len(matched)}")
    print(f"Pool exhausted:          {len(pool_exhausted)}")
    print(f"Unmatched:               {len(no_match)}")
    print(f"Match rate:              {len(matched)/total*100:.1f}%")

    if no_match or pool_exhausted:
        print("\nItems that could not be matched:")
        from collections import Counter
        all_unmatched = [(r, "no_match") for _, r in no_match] + [(r, "exhausted") for _, r, _ in pool_exhausted]
        by_key = Counter()
        for row, reason in all_unmatched:
            key = f"{row.get('brand','')} | {row.get('color','')} | {row.get('size','')} | {row.get('msrp_raw','')} [{reason}]"
            by_key[key] += 1
        for k, cnt in by_key.most_common(20):
            print(f"  {cnt}x {k}")

    print("\n" + "=" * 70)
    print("FULL SQL OUTPUT")
    print("=" * 70)
    print(sql)


if __name__ == "__main__":
    main()

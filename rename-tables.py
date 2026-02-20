#!/usr/bin/env python3
import os

REPLACEMENTS = {
    "from('items')": "from('jumpstart_manifest')",
    "from('scans')": "from('jumpstart_sold_scans')",
    "from('sort_log')": "from('jumpstart_sort_log')",
    "from('bundle_boxes')": "from('jumpstart_bundle_boxes')",
    "from('bundle_scans')": "from('jumpstart_bundle_scans')",
    "from('kickstart_items')": "from('kickstart_intake')",
}

FILES = [
    "src/components/AdminDashboard.jsx",
    "src/components/AdminInventory.jsx",
    "src/components/files/AdminInputs.jsx",
    "src/pages/KickstartSort.jsx",
    "src/pages/GeneralSort.jsx",
    "src/pages/BundleSort.jsx",
    "src/pages/SalesScanner.jsx",
]

for filepath in FILES:
    if not os.path.exists(filepath):
        print(f"SKIP: {filepath}")
        continue
    with open(filepath, 'r') as f:
        content = f.read()
    original = content
    for old, new in REPLACEMENTS.items():
        content = content.replace(old, new)
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"UPDATED: {filepath}")
    else:
        print(f"NO CHANGE: {filepath}")

print("Done!")

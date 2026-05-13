/**
 * Jumpstart bulk-listing CSV export.
 *
 * Maps `jumpstart_manifest` rows (from a manifested load like a J.Crew or
 * Madewell pallet) to Whatnot's seller-hub CSV format. Mirrors the Kickstart
 * version (src/lib/whatnotCsv.js) but with manifest-specific grouping, title
 * cleanup, and gender-aware category mapping.
 */

// Whatnot category / sub-category pairs.
//   Csv "Category"     = parent group  (e.g. "Women's Fashion")
//   Csv "Sub Category" = leaf          (e.g. "Women's Contemporary")
const WOMENS = { category: "Women's Fashion", sub: "Women's Contemporary" }
const MENS   = { category: "Men's Fashion",   sub: "Men's Modern" }

const CONDITION = 'New With Defects'
const SHIPPING_PROFILE = '8 Items Per Box: 10oz Per Item'

const HEADERS = [
  'Category', 'Sub Category', 'Title', 'Description', 'Quantity', 'Type',
  'Price', 'Shipping Profile', 'Offerable', 'Hazmat', 'Condition',
  'Cost Per Item', 'SKU',
  'Image URL 1', 'Image URL 2', 'Image URL 3', 'Image URL 4',
  'Image URL 5', 'Image URL 6', 'Image URL 7', 'Image URL 8',
]

function escapeCsvField(value) {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

// Strip J.Crew / Madewell manifest cruft from the description. The DESCRIPTION
// column on those manifests follows "NAME, COLORCODE, SIZE" and the NAME is
// often truncated to fit the column (e.g. "LUDLOW JAPANESE CHINO J" where the
// trailing "J" is what's left of "JACKET"). We pull off the last two
// comma-separated segments, drop any 1-letter trailing fragment, and
// title-case the result so "LUDLOW JAPANESE CHINO" → "Ludlow Japanese Chino"
// (manifests come in ALL CAPS, which looks shouty on Whatnot).
export function cleanTitle(description) {
  if (!description) return ''
  const parts = String(description).split(',').map(p => p.trim()).filter(Boolean)
  let name
  if (parts.length >= 3) {
    name = parts.slice(0, -2).join(', ')
  } else {
    name = parts.join(', ')
  }
  // Drop single-letter trailing word (truncation artifact)
  name = name.replace(/\s+[A-Z]$/i, '').trim()
  return titleCase(name)
}

// Title-case for ALL-CAPS manifest descriptions. Capitalize the first letter
// of each whitespace-separated word, lowercase the rest. Punctuation inside
// a word (slashes, apostrophes) is preserved.
function titleCase(s) {
  return s.split(/(\s+)/).map(part => {
    if (/^\s+$/.test(part) || !part) return part
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
  }).join('')
}

function pickCategory(row) {
  const g = (row.gender || '').toLowerCase()
  if (g.startsWith('men')) return MENS
  return WOMENS
}

// Brand prefix for the title — "J.Crew Factory" → "Factory" (short for the
// outlet line), "J Crew" → "J.Crew", "Madewell" → "Madewell". Anything else
// falls back to the raw vendor string. Returned without the trailing dash.
function brandPrefix(vendor) {
  const v = (vendor || '').toLowerCase()
  if (v.includes('factory')) return 'Factory'
  if (v.includes('madewell')) return 'Madewell'
  if (v.includes('crew')) return 'J.Crew'
  return (vendor || '').trim()
}

/**
 * Group key: identical manifest units → one Whatnot listing.
 * Manifest rows that lack the basics (description / size) are skipped.
 */
function groupKey(row) {
  const desc = (row.description || '').trim()
  if (!desc) return null
  return [
    desc,
    (row.color || '').trim(),
    (row.size || '').trim(),
    (row.vendor || '').trim(),
    Number(row.msrp || 0).toFixed(2),
    Number(row.cost_freight || 0).toFixed(2),
    pickCategory(row).category,
  ].join('|||')
}

function buildRow(group) {
  const first = group[0]
  const cat = pickCategory(first)

  const cleanedName = cleanTitle(first.description)
  const brand = brandPrefix(first.vendor)
  const brandPart = brand ? `${brand} ` : ''
  const sizeStr = (first.size || '').trim()
  const msrp = Number(first.msrp || 0)
  const sizeSuffix = sizeStr ? ` - ${sizeStr}` : ''
  const msrpSuffix = msrp > 0 ? ` - $${msrp.toFixed(0)} MSRP` : ''
  const title = `${brandPart}${cleanedName}${sizeSuffix}${msrpSuffix}`

  // Description column on Whatnot — same body as title but without
  // size/MSRP since those are already in the title.
  const longDesc = `${brandPart}${cleanedName}`

  // SKU = the unmodified UPC printed on the tag (barcode_raw, e.g.
  // "099107632646"). jumpstart_manifest.barcode is normalized for our own
  // matching (leading zeros stripped to "99107632646"), but the physical
  // scanner reads the original 12-digit form, so SKU must match that.
  const sku = String(first.barcode_raw || first.barcode || first.id || '')

  return [
    cat.category,
    cat.sub,
    title,
    longDesc,
    group.length,                                        // Quantity
    'Auction',                                           // Type
    1,                                                    // Starting bid
    SHIPPING_PROFILE,
    'FALSE',                                             // Offerable
    'Not Hazmat',
    CONDITION,
    Number(first.cost_freight || 0).toFixed(2),
    sku,                                                 // SKU = UNIVERSAL ID
    first.photo_url || '',
    '', '', '', '', '', '', '',
  ]
}

/**
 * Generate a CSV string from a list of manifest rows.
 * Returns `{ csv, included, skipped, groups, skuByManifestId, listings }`.
 *   skuByManifestId: Map(manifest.id -> sku) for every unit in any group.
 *   listings:        Array of { sku, title, quantity, ... } — one per listing.
 */
export function generateJumpstartWhatnotCsv(manifestRows) {
  const groups = new Map()
  let skipped = 0
  for (const r of manifestRows) {
    const key = groupKey(r)
    if (!key) { skipped++; continue }
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  const lines = [HEADERS.join(',')]
  const skuByManifestId = new Map()
  const listings = []
  for (const group of groups.values()) {
    group.sort((a, b) => (a.id || 0) - (b.id || 0))
    const first = group[0]
    const sku = String(first.barcode_raw || first.barcode || first.id || '')
    for (const u of group) skuByManifestId.set(u.id, sku)
    listings.push({
      sku,
      title: cleanTitle(first.description),
      brand: brandPrefix(first.vendor),
      size: first.size || '',
      color: first.color || '',
      quantity: group.length,
      photo_url: first.photo_url || '',
    })
    lines.push(buildRow(group).map(escapeCsvField).join(','))
  }

  return {
    csv: lines.join('\n'),
    included: manifestRows.length - skipped,
    skipped,
    groups: groups.size,
    skuByManifestId,
    listings,
  }
}
